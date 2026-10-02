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
