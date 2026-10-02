// The device's own voice (window.speechSynthesis): in a call it stands in
// for a piece of Luna's voice the server couldn't make — its TTS was busy,
// refused the text or never answered — so she never goes silent halfway
// (lib/voicePlayer.js). It sounds different from her voice, but the words
// keep coming, in order.
//
// - unlockBrowserVoice(): inside a tap (opening the call). iOS lets a page
//   speak without a tap only once it has spoken from one.
// - sayWithBrowser(): one piece, said as a few utterances of at most
//   PART_MAX characters (Chrome's network voices stop after ~15 s of one
//   utterance and never report its end), each with a watchdog (some engines
//   lose "start" or "end" now and then).

const PART_MAX = 160;
const CHARS_PER_SECOND = 14; // her own voice's pace (lib/speechChunks.js)
const START_TIMEOUT_MS = 4000;
const RESPEAK_DELAY_MS = 250;
// macOS / iOS list joke voices among the English ones.
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|princess)\b/i;

function engine() {
  try {
    const s = window.speechSynthesis;
    return s && window.SpeechSynthesisUtterance ? s : null;
  } catch (_) {
    return null;
  }
}

export const browserVoiceSupported = () => !!engine();

// Voices arrive asynchronously in Chrome: the first getVoices() is often
// empty, "voiceschanged" brings them.
let voices = [];
let watchingVoices = false;
function knownVoices() {
  const s = engine();
  if (!s) return voices;
  const refresh = () => {
    try {
      const list = s.getVoices();
      if (list?.length) voices = list;
    } catch (_) {}
  };
  refresh();
  if (!watchingVoices && typeof s.addEventListener === "function") {
    watchingVoices = true;
    try { s.addEventListener("voiceschanged", refresh); } catch (_) {}
  }
  return voices;
}

// The best installed voice for `tag` ("tr-TR", "en-US"): its exact language,
// on the device rather than over the network, the user's default. null:
// the engine picks one by the utterance's lang.
function pickVoice(tag) {
  const want = tag.toLowerCase();
  const base = want.split("-")[0];
  let best = null;
  let bestScore = -Infinity;
  for (const v of knownVoices()) {
    const l = (v.lang || "").replace(/_/g, "-").toLowerCase();
    if (l !== base && !l.startsWith(`${base}-`)) continue;
    const score = (l === want ? 4 : 0) + (v.localService ? 2 : 0) + (v.default ? 1 : 0)
      - (NOVELTY.test(v.name || "") ? 10 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

// Inside a tap: a silent, empty utterance — from then on the page may speak
// without one (iOS). Also starts loading the voice list.
export function unlockBrowserVoice() {
  const s = engine();
  if (!s) return;
  knownVoices();
  try {
    if (s.speaking || s.pending) return; // speaking already: unlocked
    const u = new window.SpeechSynthesisUtterance("");
    u.volume = 0;
    s.speak(u);
  } catch (_) {}
}

// text[from…] as utterances: sentences joined up to PART_MAX characters, a
// longer sentence cut between words. { at: index in text, text }.
function partsOf(text, from) {
  const spans = [];
  const end = /[.!?…]+["'”’)\]]*\s+/g;
  end.lastIndex = from;
  let a = from;
  let m;
  while ((m = end.exec(text)) !== null) {
    spans.push([a, m.index + m[0].length]);
    a = m.index + m[0].length;
  }
  if (a < text.length) spans.push([a, text.length]);

  const parts = [];
  let cur = null;
  for (const [start, stop] of spans) {
    let s0 = start;
    while (stop - s0 > PART_MAX) {
      let cut = text.lastIndexOf(" ", s0 + PART_MAX);
      if (cut <= s0) cut = text.indexOf(" ", s0 + PART_MAX);
      if (cut <= s0 || cut >= stop - 1) break; // one enormous "word": say it whole
      if (cur) parts.push(cur);
      cur = null;
      parts.push([s0, cut]);
      s0 = cut + 1;
    }
    if (cur && stop - cur[0] <= PART_MAX) {
      cur[1] = stop;
    } else {
      if (cur) parts.push(cur);
      cur = [s0, stop];
    }
  }
  if (cur) parts.push(cur);
  return parts
    .map(([x, y]) => {
      let at = x;
      while (at < y && text[at] === " ") at += 1;
      return { at, text: text.slice(at, y).trim() };
    })
    .filter((p) => p.text);
}

// Say text[from…] in the device's voice. lang: "tr-TR" | "en-US".
// Callbacks, never called synchronously: onStart() when it is first heard,
// onEnd() after its last word, onError(code) — "not-allowed" means it wants
// a tap first. Returns null when the device can't speak at all, otherwise
// { cancel(), position(), resumeAt() }: position() is how far into `text`
// it has got (by its word boundaries where the engine reports them, else
// estimated from the time), resumeAt() where to start again after a pause
// (the word or sentence being said).
export function sayWithBrowser(text, { lang = "tr-TR", from = 0, onStart, onEnd, onError } = {}) {
  const s = engine();
  if (!s) return null;
  const parts = partsOf(text, from);
  const voice = pickVoice(lang);
  let k = 0;              // the part being said
  let utterance = null;   // ...its utterance (also keeps it from being garbage collected: Chrome then never fires "end")
  let over = false;
  let started = false;
  let heardAt = 0;        // when the current part began to be heard
  let mark = null;        // its last word boundary: { at, len, time }
  let timer = null;
  let respoken = false;

  const finish = (fn, arg) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    utterance = null;
    fn?.(arg);
  };

  // Drop the current utterance without its "error"/"end" counting.
  const drop = () => {
    utterance = null;
    try { s.cancel(); } catch (_) {}
  };

  const nextPart = () => {
    k += 1;
    if (k >= parts.length) finish(onEnd);
    else sayPart();
  };

  const heard = () => {
    heardAt = Date.now();
    clearTimeout(timer);
    // Well past the time the part takes, carry on as if it had ended.
    const ms = Math.max(4000, (parts[k].text.length / CHARS_PER_SECOND) * 2500 + 3000);
    timer = setTimeout(() => {
      if (over) return;
      drop();
      nextPart();
    }, ms);
    if (!started) {
      started = true;
      onStart?.();
    }
  };

  // Not a word within START_TIMEOUT_MS. (An engine that can't speak may
  // still report "speaking" — only its start or a word boundary counts.)
  const noStart = () => {
    if (over) return;
    if (!respoken && knownVoices().length) {
      // Once more: an engine that has voices dropped the utterance. (One
      // without any — a desktop Linux without speech packages — never speaks.)
      // Not right after the cancel: Safari drops an utterance spoken then.
      respoken = true;
      drop();
      timer = setTimeout(() => {
        if (!over) sayPart();
      }, RESPEAK_DELAY_MS);
      return;
    }
    drop();
    finish(onError, "no-start");
  };

  function sayPart() {
    const part = parts[k];
    let u;
    try {
      u = new window.SpeechSynthesisUtterance(part.text);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;
    } catch (_) {
      utterance = null;
      clearTimeout(timer);
      timer = setTimeout(() => finish(onError, "synthesis-failed"), 0);
      return;
    }
    const mine = () => !over && utterance === u;
    u.onstart = () => {
      if (mine() && !heardAt) heard();
    };
    u.onboundary = (e) => {
      if (!mine() || (e.name && e.name !== "word")) return;
      if (!heardAt) heard(); // (an engine that skips "start")
      mark = { at: part.at + (e.charIndex || 0), len: e.charLength || 0, time: Date.now() };
    };
    u.onend = () => {
      if (!mine()) return;
      clearTimeout(timer);
      nextPart();
    };
    u.onerror = (e) => {
      if (mine()) finish(onError, e?.error || "synthesis-failed");
    };
    utterance = u;
    heardAt = 0;
    mark = null;
    clearTimeout(timer);
    timer = setTimeout(noStart, START_TIMEOUT_MS);
    try {
      // Never queued behind anything else. (Only before the first part: a
      // part that just ended may still count as "speaking", and Safari now
      // and then drops an utterance spoken right after a cancel.)
      if (k === 0 && (s.speaking || s.pending)) s.cancel();
      if (s.paused) s.resume(); // (Chrome can be left paused)
      s.speak(u);
    } catch (_) {
      setTimeout(() => {
        if (mine()) finish(onError, "synthesis-failed");
      }, 0);
    }
  }

  if (parts.length) sayPart(); // synchronously: inside the tap, if there is one
  else setTimeout(() => finish(onEnd), 0);

  return {
    cancel() {
      if (over) return;
      over = true;
      clearTimeout(timer);
      drop();
    },
    position() {
      const part = parts[Math.min(k, parts.length - 1)];
      if (!part) return text.length;
      if (!heardAt) return part.at;
      const now = Date.now();
      let pos;
      if (mark) {
        // Through the word being said, at her usual pace.
        const space = text.indexOf(" ", mark.at);
        const len = mark.len || (space > mark.at ? space - mark.at : text.length - mark.at);
        pos = mark.at + Math.min(len, ((now - mark.time) / 1000) * CHARS_PER_SECOND);
      } else {
        pos = part.at + ((now - heardAt) / 1000) * CHARS_PER_SECOND;
      }
      return Math.min(pos, part.at + part.text.length);
    },
    resumeAt() {
      const part = parts[Math.min(k, parts.length - 1)];
      if (!part) return text.length;
      return mark ? mark.at : part.at;
    },
  };
}
