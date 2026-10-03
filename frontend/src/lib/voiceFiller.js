import { contextAlwaysAudible, voiceContext } from "@/lib/voiceAudio";

// Luna's "thinking" sounds in a call — "Hmm, bakalım.", "Bir saniye,
// düşünüyorum."… — short clips in her own voice (public/voice/fillers/),
// said while a spoken turn's reply is still on its way, so the wait before
// her first word isn't dead silence (hooks/useVoiceCall.js decides when).
//
// They play straight through the shared audio context (lib/voiceAudio.js,
// started inside the tap that opened the call) — never through her reply's
// <audio> element, so the reply's playback is untouched and iOS needs no
// extra unlock. Anything off (no context, a context that isn't running, the
// clips didn't load) simply means no filler. Never on iOS: there the
// ring/silent switch mutes the context (lib/voiceAudio.js) — the "hmm" would
// be silent while her first word still waited for it.

const CLIP_COUNT = { tr: 4, en: 5 }; // public/voice/fillers/<lang>-<n>.mp3
const FADE_S = 0.06;                 // a filler cut short fades out instead of clicking
const LOAD_TIMEOUT_MS = 15000;       // a clip stuck loading counts as failed (the next call tries again)

// Decoded clips per language, kept for the page session.
const decoded = new Map();
const loading = new Set();

const now = () => (window.performance?.now ? window.performance.now() : Date.now());

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    // (Older Safari has only the callback form; the others also return a
    // promise.)
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

// Fetch and decode one clip — given up on after LOAD_TIMEOUT_MS, so a
// request that hangs can't keep the language "loading" for the whole session.
function loadClip(ctx, url) {
  const ctl = window.AbortController ? new window.AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctl?.abort();
      reject(new Error("filler clip: timeout"));
    }, LOAD_TIMEOUT_MS);
  });
  const load = (async () => {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) throw new Error(`filler clip: HTTP ${res.status}`);
    return decode(ctx, await res.arrayBuffer());
  })();
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer));
}

// Fetch and decode the clips of a language (when the call opens). A clip
// that fails is left out; if none loaded, the next call tries again.
export function preloadFillers(lang) {
  const count = CLIP_COUNT[lang];
  const ctx = voiceContext();
  if (!count || !ctx || !contextAlwaysAudible() || decoded.has(lang) || loading.has(lang)) return;
  loading.add(lang);
  const base = `${process.env.PUBLIC_URL || ""}/voice/fillers/${lang}-`;
  const clips = Array.from({ length: count }, (_, i) => loadClip(ctx, `${base}${i + 1}.mp3`).catch(() => null));
  Promise.all(clips).then((list) => {
    loading.delete(lang);
    const ok = list.filter(Boolean);
    if (ok.length) decoded.set(lang, ok);
  });
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createVoiceFiller() {
  let cur = null;  // the filler sounding now (or fading out)
  let last = null; // the clip said last
  let bag = [];    // clips still to come before any of them repeats
  let endedAt = -Infinity; // when the last one went quiet (see whenDone)

  // Every clip once in a random order, then a new round — never the same
  // one twice in a row, also where two rounds meet.
  const pick = (clips) => {
    bag = bag.filter((c) => clips.includes(c)); // (the call's language changed)
    if (!bag.length) {
      bag = shuffled(clips);
      if (bag.length > 1 && bag[0] === last) bag.push(bag.shift());
    }
    last = bag.shift();
    return last;
  };

  // It is over (said to its end, faded out, or given up on): silent for
  // sure, and whoever waits for it goes on.
  const finish = (f) => {
    if (f.over) return;
    f.over = true;
    clearTimeout(f.timer);
    if (cur === f) {
      cur = null;
      endedAt = now();
    }
    try { f.source.stop(0); } catch (_) {}
    try {
      f.source.disconnect();
      f.gain.disconnect();
    } catch (_) {}
    f.resolve();
  };

  const ready = (lang) => {
    const ctx = voiceContext();
    return contextAlwaysAudible() && !!decoded.get(lang)?.length && !!ctx && ctx.state === "running";
  };

  return {
    // Whether a filler in this language could be said right now.
    ready,

    // Say one (replacing any still sounding). Returns whether it started.
    play(lang) {
      if (!ready(lang)) return false;
      if (cur) finish(cur);
      const ctx = voiceContext();
      const buffer = pick(decoded.get(lang));
      const f = { over: false, timer: null, source: null, gain: null, resolve: null, done: null };
      f.done = new Promise((resolve) => { f.resolve = resolve; });
      try {
        f.source = ctx.createBufferSource();
        f.gain = ctx.createGain();
        f.source.buffer = buffer;
        f.source.connect(f.gain);
        f.gain.connect(ctx.destination);
        f.source.onended = () => finish(f);
        f.source.start(0); // (older WebKit requires the time)
      } catch (_) {
        if (f.source) finish(f);
        return false;
      }
      // "ended" never comes while the context is stopped (the system took
      // the audio): after its length it counts as over anyway.
      f.timer = setTimeout(() => finish(f), buffer.duration * 1000 + 300);
      cur = f;
      return true;
    },

    // Stop it now, with a short fade.
    stop() {
      const f = cur;
      if (!f || f.fading) return;
      f.fading = true;
      try {
        const t0 = voiceContext().currentTime;
        const g = f.gain.gain;
        g.cancelScheduledValues(t0);
        g.setValueAtTime(g.value, t0);
        g.linearRampToValueAtTime(0, t0 + FADE_S);
        f.source.stop(t0 + FADE_S);
      } catch (_) {
        finish(f);
        return;
      }
      clearTimeout(f.timer);
      f.timer = setTimeout(() => finish(f), FADE_S * 1000 + 150);
    },

    // A filler can be heard (until it has fully faded out).
    audible: () => !!cur,

    // A promise that resolves gapMs after the filler is over — her reply's
    // first piece waits for it. Also when it ended less than gapMs ago (the
    // clips are trimmed tight: without the breath her answer would run
    // straight on from the "hmm"). null when there is nothing to wait for.
    whenDone(gapMs = 0) {
      const f = cur;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      if (f) return f.done.then(() => wait(gapMs));
      const left = endedAt + gapMs - now();
      return left > 0 ? wait(left) : null;
    },
  };
}
