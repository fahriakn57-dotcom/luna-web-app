// Live loudness of Luna's spoken replies for the voice-call visuals.
//
// One shared AudioContext, created/resumed from a user gesture (opening the
// call, tapping the mic) — browsers keep a context suspended until then. The
// call's <audio> element (lib/voicePlayer.js) is routed through an
// AnalyserNode ONCE: an element can be connected to an audio graph only
// once, and from then on it is heard only through that graph. So it is
// attached only while the context is actually running, and before every
// play the player checks the context still runs (isAudible) — a suspended
// context would mean silence. When anything is off, callers get null and the
// audio simply plays the normal way (the visuals then animate without real
// levels).
//
// Never on iOS: there an audio graph can be muted by the ring/silent switch
// (a plain <audio> element is not) and is stopped by every interruption, so
// a routed element could leave Luna silent on a phone in silent mode.
//
// Where the graph is used anyway, a piece of her voice can also be streamed:
// raw PCM played block by block straight through the context as the server
// makes it (createPcmStream), into the element's analyser.

let ctx = null;
const graphs = new WeakMap(); // <audio> -> { source, analyser }

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function primeVoiceAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch (_) {
    ctx = null;
  }
}

// The shared context itself (null until primeVoiceAudio made one), for
// sounds played straight through it — her "hmm" while a reply is on its
// way (lib/voiceFiller.js).
export function voiceContext() {
  return ctx;
}

// Whether a sound played straight through the context is heard for sure —
// not on iOS, where the ring/silent switch mutes it (see above): a "hmm"
// nobody hears would only hold her answer back.
export function contextAlwaysAudible() {
  return !IOS;
}

// The element's analyser — attached on the first call that finds the
// context running, the same one after that. null: the element plays the
// normal way.
export function attachAnalyser(audio) {
  if (!audio) return null;
  const known = graphs.get(audio);
  if (known) return known.analyser;
  if (IOS || !ctx || ctx.state !== "running") return null;
  try {
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    graphs.set(audio, { source, analyser });
    return analyser;
  } catch (_) {
    return null;
  }
}

// Whether `audio` would be heard if it played now: it isn't routed through
// the context, or the context is running.
export function isAudible(audio) {
  return !graphs.has(audio) || ctx?.state === "running";
}

// The system stopped the context (it took the audio for a while): try to
// start it again without a tap. Resolves whether it runs.
export function resumeVoiceAudio(timeoutMs = 500) {
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === "running") return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(ctx?.state === "running");
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      ctx.resume().then(done, done);
    } catch (_) {
      done();
    }
  });
}

// Disconnect the element's graph — only when the element itself is
// discarded (the call ended): once attached it can't be heard without it.
export function releaseAnalyser(audio) {
  const graph = graphs.get(audio);
  if (!graph) return;
  graphs.delete(audio);
  try {
    graph.source.disconnect();
    graph.analyser.disconnect();
  } catch (_) {}
}

// ---- her voice streamed (lib/voicePlayer.js, lib/api.js fetchTTSStream)

// Held before a streamed piece's first sound (and again if it ever runs
// dry): a short pause in the network then costs no gap in her voice. The
// server makes the audio several times faster than she says it, so this
// little is enough.
const STREAM_CUSHION_S = 0.12;
// The first block starts this far ahead of the context's clock: started at
// "now", it could begin a moment late and overlap the block after it.
const STREAM_LEAD_S = 0.03;
// A block due sooner than this is too late to join on seamlessly: the audio
// ran dry, and the cushion is built up again first.
const STREAM_EDGE_S = 0.01;
// A read can end anywhere — a few bytes, one sample. Resampled to the
// context's rate on its own, a block that short is a little off (measured in
// Chrome: ~0.017 on a 0.37 sine, against ~0.002 at an ordinary seam), so it
// waits to join the next read — unless nothing more is coming, or less than
// STREAM_LOW_S is still scheduled ahead.
const STREAM_MIN_BLOCK_S = 0.02;
const STREAM_LOW_S = 0.05;

// When a block is due exactly on one of the context's sample frames (her
// 24 kHz on a 48 kHz context: always), it is started a hair under that
// frame, never a hair over: the sum of the blocks before it drifts by a
// float's last bit, and Chrome starts a block that is a hair late a whole
// frame late, its last frame overlapping the next block's first (a click:
// measured ~0.08 on a 0.37 sine). A due time between two frames (44.1 kHz)
// is left as it is.
function onGrid(t, sampleRate) {
  const f = t * sampleRate;
  const k = Math.round(f);
  return Math.abs(f - k) < 1e-4 ? (k - 1e-6) / sampleRate : t;
}

// A little-endian 16-bit sample's two bytes -> -1..1.
const sample = (lo, hi) => ((((hi << 8) | lo) << 16) >> 16) / 32768;

// Whether her voice can be streamed here: played as it arrives straight
// through the context — running, and never on iOS (see above) — from a
// response whose body can be read as it comes.
export function streamingVoiceSupported() {
  return !IOS && ctx?.state === "running"
    && typeof window.ReadableStream === "function"
    && typeof window.Response === "function" && "body" in window.Response.prototype;
}

// One streamed piece of her voice: push() its bytes as they come — 16-bit
// little-endian mono PCM at `rate`, split anywhere (an odd last byte waits
// for its other half) — and end() it once the stream is complete.
//
// play(output, callbacks) plays it through `output` (her analyser, else the
// speakers): blocks scheduled back to back on the context's clock, gapless.
// onStart: its first sound is scheduled; onEnd: the last block has finished
// and nothing more is coming; onPause: it stopped where it was — pause(), or
// the context stopped under it (the system took the audio) — and the next
// play() goes on from there; onError: it could not be scheduled. stop()
// silences it at once, with no callback. Every sample is kept: pcm16() is
// the whole clip (for "Tekrar dinle").
export function createPcmStream(rate = 24000) {
  let samples = new Float32Array(rate * 2);
  let total = 0;      // samples received
  let carry = -1;     // a chunk's odd last byte: the low half of the next sample
  let ended = false;  // ...and no more are coming
  let from = 0;       // the sample the next play() starts at
  let heard = false;  // a sound of it was ever scheduled
  // While it plays: {c (the context), output, on, blocks: [{src, at, from, n}],
  // live (blocks not ended yet), first (where it started), next (the first
  // sample not scheduled yet), nextAt (when that one is due), started}.
  let p = null;

  const grow = (need) => {
    if (need <= samples.length) return;
    const bigger = new Float32Array(Math.max(need, samples.length * 2));
    bigger.set(samples.subarray(0, total));
    samples = bigger;
  };

  // The sample being heard now, by the context's clock.
  const position = () => {
    if (!p) return from;
    const t = p.c.currentTime;
    for (let k = p.blocks.length - 1; k >= 0; k--) {
      const b = p.blocks[k];
      if (b.at <= t) return Math.min(b.from + Math.round((t - b.at) * rate), b.from + b.n);
    }
    return p.first;
  };

  // Its blocks stop now, and never report an end.
  const silence = () => {
    p.blocks.forEach((b) => {
      b.src.onended = null;
      try { b.src.stop(); } catch (_) {}
      try { b.src.disconnect(); } catch (_) {}
    });
    try { p.c.removeEventListener?.("statechange", p.onState); } catch (_) {}
  };

  // Leave playing; `then` is the callback that says why.
  const leave = (then, ...args) => {
    const on = p.on;
    silence();
    p = null;
    on[then]?.(...args);
  };

  const pause = () => {
    if (!p) return;
    from = position();
    leave("onPause");
  };

  // Schedule what has come since the last block (once the cushion is there),
  // and report the end once all of it has been heard.
  const schedule = () => {
    if (!p) return;
    const left = total - p.next;
    if (left > 0) {
      const now = p.c.currentTime;
      if (p.nextAt < now + STREAM_EDGE_S) {
        if (left < STREAM_CUSHION_S * rate && !ended) return;
        p.nextAt = now + STREAM_LEAD_S;
      } else if (left < STREAM_MIN_BLOCK_S * rate && !ended && p.nextAt - now > STREAM_LOW_S) {
        return;
      }
      const b = { src: null, at: onGrid(p.nextAt, p.c.sampleRate), from: p.next, n: left };
      try {
        const buffer = p.c.createBuffer(1, left, rate);
        buffer.getChannelData(0).set(samples.subarray(p.next, total));
        b.src = p.c.createBufferSource();
        b.src.buffer = buffer;
        b.src.connect(p.output);
        b.src.start(b.at);
      } catch (e) {
        leave("onError", e);
        return;
      }
      const mine = p;
      b.src.onended = () => {
        if (p !== mine) return;
        p.live -= 1;
        schedule();
      };
      p.blocks.push(b);
      p.live += 1;
      p.next = total;
      p.nextAt = b.at + left / rate;
      heard = true;
      if (!p.started) {
        p.started = true;
        p.on.onStart?.();
        if (!p) return; // (it was stopped from there)
      }
    }
    if (ended && p.next >= total && !p.live) {
      from = total;
      leave("onEnd");
    }
  };

  return {
    rate,

    push(chunk) {
      if (ended || !chunk) return;
      const bytes = ArrayBuffer.isView(chunk)
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk);
      if (!bytes.length) return;
      grow(total + ((bytes.length + (carry >= 0 ? 1 : 0)) >> 1));
      let k = 0;
      if (carry >= 0) {
        samples[total++] = sample(carry, bytes[0]);
        carry = -1;
        k = 1;
      }
      for (; k + 1 < bytes.length; k += 2) samples[total++] = sample(bytes[k], bytes[k + 1]);
      if (k < bytes.length) carry = bytes[k];
      schedule();
    },

    // (A last odd byte is half a sample: dropped.)
    end() {
      if (ended) return;
      ended = true;
      carry = -1;
      schedule();
    },

    play(output, on = {}) {
      if (p) return;
      if (!ctx) {
        on.onError?.(new Error("no audio context"));
        return;
      }
      const c = ctx;
      p = {
        c, output: output || c.destination, on, blocks: [], live: 0,
        first: from, next: from, nextAt: -Infinity, started: false, onState: null,
      };
      const mine = p;
      p.onState = () => {
        if (p === mine && c.state !== "running") pause();
      };
      try { c.addEventListener?.("statechange", p.onState); } catch (_) {}
      schedule();
    },

    pause,

    stop() {
      if (!p) return;
      silence();
      p = null;
    },

    // Whether any of it was ever scheduled to be heard.
    started: () => heard,

    // How much of the clip has been heard (0..1). Until all of it has come,
    // of `expectS` seconds (the caller's estimate of the whole clip) or of
    // what has come, whichever is longer: the server sends it several times
    // faster than she says it, so "of what has come" alone runs far ahead
    // early in a piece.
    progress(expectS = 0) {
      const of = ended ? total : Math.max(total, Math.round(expectS * rate));
      return of ? Math.min(1, position() / of) : 0;
    },

    // The whole clip so far as 16-bit little-endian PCM — exactly the bytes
    // received (each sample came from a 16-bit value).
    pcm16() {
      const buf = new ArrayBuffer(total * 2);
      const v = new DataView(buf);
      for (let k = 0; k < total; k++) {
        v.setInt16(k * 2, Math.max(-32768, Math.min(32767, Math.round(samples[k] * 32768))), true);
      }
      return buf;
    },
  };
}

// How long to wait after a reply's 'ended' before opening the mic: the
// output pipeline (and Bluetooth) still holds a little audio, and the mic
// must not hear the tail of Luna's own voice.
export function micDelayAfterSpeechMs() {
  const latency = ctx ? ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000 : 0;
  return Math.max(400, Math.round(latency + 250));
}

// A soft two-note "your turn" chime (desktop only — Android's recognizer
// plays its own start sound). Resolves when it has finished, so the mic can
// open after it without hearing it.
export function playTurnCue() {
  return new Promise((resolve) => {
    if (!ctx || ctx.state !== "running") return resolve();
    try {
      const t0 = ctx.currentTime + 0.01;
      [[659.25, 0], [880, 0.09]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0 + at);
        gain.gain.linearRampToValueAtTime(0.05, t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 0.18);
      });
      setTimeout(resolve, 420);
    } catch (_) {
      resolve();
    }
  });
}

// 0..1 loudness (RMS of the waveform, scaled so normal speech reaches ~0.6-0.9).
export function readLevel(analyser, buffer) {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 3.2);
}
