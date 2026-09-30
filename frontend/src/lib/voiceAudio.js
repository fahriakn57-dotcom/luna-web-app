// Live loudness of Luna's spoken replies for the voice-call visuals.
//
// One shared AudioContext, created/resumed from a user gesture (opening the
// call, tapping the mic) — browsers keep a context suspended until then. A
// reply's <audio> element is routed through an AnalyserNode ONLY while the
// context is actually running: once an element is attached with
// createMediaElementSource its sound goes through the context, so a
// suspended context would mean silence. When anything is off, callers get
// null and the audio simply plays the normal way (the visuals then animate
// without real levels).

let ctx = null;

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

// Returns { analyser, release } — release() disconnects the nodes. Call it
// only when the reply is abandoned for good (ended, replaced, interrupted,
// call closed), never on a mere pause: a paused element the browser later
// resumes would play into a disconnected graph, i.e. silently.
export function attachAnalyser(audio) {
  if (!ctx || ctx.state !== "running" || !audio) return { analyser: null, release: () => {} };
  try {
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try { source.disconnect(); analyser.disconnect(); } catch (_) {}
    };
    return { analyser, release };
  } catch (_) {
    return { analyser: null, release: () => {} };
  }
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
