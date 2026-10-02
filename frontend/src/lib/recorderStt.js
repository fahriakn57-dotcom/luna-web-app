// The "recorder" speech engine behind hooks/useSpeechRecognition.js: for
// browsers without the Web Speech API (Firefox, in-app web views) or whose
// recognizer can't serve us (Brave and blocked networks: "network"; iOS with
// dictation off: "service-not-allowed"). It opens the mic, records ONE
// utterance at a time with MediaRecorder and decides where that utterance
// ends with a small energy VAD; the hook uploads the result
// (api.transcribeAudio).
//
// There are no live words here — all the VAD can tell is "speech started" and
// "speech ended". It errs on the side of NOT uploading (silence, a cough, a
// click are dropped on the device): every upload is a voice use from the
// user's daily quota.
//
// The mic stream is opened once and reused while turns follow each other
// closely (re-listening after a silent turn, "Tekrar dene"), then let go
// after IDLE_RELEASE_MS without a recording — and at once (release()) when
// an utterance goes off to be transcribed (Luna's answer is next) or after
// an abort (hanging up, the page hidden). So the mic indicator is off while
// Luna talks, even when her answer comes quickly — a held capture stream
// would also switch phones into their quieter, echo-cancelled "call" audio
// mode for her voice.

export const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", ""];

export const VAD_DEFAULTS = {
  calibrateMs: 300,     // a fresh mic: the room's noise floor is measured first
  onsetMs: 120,         // this long above the threshold = speech (a click or a tap is shorter)
  hangoverMs: 900,      // this much quiet after speech = the utterance is over
  minVoicedMs: 200,     // "speech" shorter than this (a cough, a bump) is forgotten; listening goes on
  maxSpeechMs: 25000,   // hard cap of one utterance
  noSpeechMs: 7000,     // nothing said by then: like the native engine's "no-speech"
  floorFactor: 3,       // speech = louder than 3x the room...
  minThreshold: 0.012,  // ...and than about -38 dBFS (RMS of -1..1 samples)...
  maxThreshold: 0.06,   // ...but never asks for more than -24 dBFS, in case the floor was measured while you were already talking
  release: 0.7,         // once talking, softer syllables still count as voice (hysteresis)
};

const FRAME_MS = 40;
const IDLE_RELEASE_MS = 5000;
// The audio graph still isn't running (Safari may keep a context created
// outside a tap suspended): no levels to judge by.
const BLIND_AFTER_MS = 1000;
// MediaRecorder reports its stop within a few hundred ms; one that never does
// (a track the system muted under it) must not leave the session hanging.
const STOP_TIMEOUT_MS = 2500;
const BITRATE = 32000; // plenty for speech; keeps a 25 s upload around 100 KB
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export function recorderAvailable() {
  return !!(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
    && typeof window !== "undefined" && window.MediaRecorder);
}

export function pickMimeType() {
  const MR = window.MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  return RECORDER_MIME_TYPES.find((type) => {
    if (!type) return true;
    try { return MR.isTypeSupported(type); } catch (_) { return false; }
  }) || "";
}

// One id per recorded utterance (the server counts one voice use per turn).
export function newTurnId() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch (_) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- VAD
// Pure, so it can be checked against synthetic level sequences.

// `floor` from an earlier utterance on the same mic skips the calibration.
export function vadInit(now, floor = null) {
  return { start: now, last: now, calSum: 0, calN: 0, floor, aboveSince: null, speechAt: null, lastVoiceAt: null, voicedMs: 0 };
}

export function vadThreshold(floor, o = VAD_DEFAULTS) {
  return Math.min(o.maxThreshold, Math.max(o.minThreshold, floor * o.floorFactor));
}

// One level reading (`rms`) at `now` (ms). Returns { state, event }, event:
//   null
//   "speech"    an utterance began (at state.speechAt)
//   "reset"     what began was too short to be speech — waiting again
//   "end"       the utterance is over (hangoverMs of quiet)
//   "max"       the utterance hit maxSpeechMs
//   "no-speech" noSpeechMs went by without any speech
export function vadStep(prev, rms, now, o = VAD_DEFAULTS) {
  const s = { ...prev, last: now };
  const dt = Math.max(0, now - prev.last);
  if (s.floor === null) {
    s.calSum += rms;
    s.calN += 1;
    if (now - s.start >= o.calibrateMs) s.floor = s.calSum / s.calN;
    return { state: s, event: null };
  }
  const threshold = vadThreshold(prev.floor, o);
  if (s.speechAt === null) {
    if (rms >= threshold) {
      if (s.aboveSince === null) s.aboveSince = now;
      if (now - s.aboveSince >= o.onsetMs) {
        s.speechAt = s.aboveSince;
        s.lastVoiceAt = now;
        s.voicedMs = now - s.aboveSince;
        return { state: s, event: "speech" };
      }
      return { state: s, event: null };
    }
    s.aboveSince = null;
    // Follow the room between words: down fast (the floor was measured on a
    // sound that has stopped), up slowly (speech must not become "the room").
    s.floor += (rms - s.floor) * (rms < s.floor ? 0.3 : 0.02);
    if (now - s.start >= o.noSpeechMs) return { state: s, event: "no-speech" };
    return { state: s, event: null };
  }
  if (rms >= threshold * o.release) {
    s.lastVoiceAt = now;
    s.voicedMs += dt;
  } else {
    // The quiet between and after words is the room too (a floor measured
    // while you were already talking comes down here, not in the next turn).
    s.floor += (rms - s.floor) * (rms < s.floor ? 0.3 : 0.02);
  }
  if (now - s.speechAt >= o.maxSpeechMs) return { state: s, event: "max" };
  if (now - s.lastVoiceAt >= o.hangoverMs) {
    if (s.voicedMs >= o.minVoicedMs) return { state: s, event: "end" };
    s.speechAt = null;
    s.lastVoiceAt = null;
    s.voicedMs = 0;
    // Or the next loud frame (a second cough a second later) would count as
    // an onset that began at the first one — "speech" at once, with the whole
    // gap counted as voice, and the noise uploaded.
    s.aboveSince = null;
    return { state: s, event: "reset" };
  }
  return { state: s, event: null };
}

// ---------------------------------------------------------------- mic

function micErrorCode(e) {
  const name = e && e.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "not-allowed";
  return "audio-capture"; // no mic, held by another app, constraints failed
}

function makeRecorder(stream, mimeType) {
  const MR = window.MediaRecorder;
  try {
    return new MR(stream, mimeType ? { mimeType, audioBitsPerSecond: BITRATE } : { audioBitsPerSecond: BITRATE });
  } catch (_) {
    return new MR(stream); // an engine that rejects the hints still records
  }
}

function readRms(graph) {
  const { analyser, buf, float } = graph;
  let sum = 0;
  if (float) {
    analyser.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  } else {
    analyser.getByteTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
  }
  return Math.sqrt(sum / buf.length);
}

// One per hook instance. record() captures one utterance and returns
//   { done: Promise<{ blob, reason, error? }>, stop(), abort() }
// reason: "end" | "max" | "stop" (blob = the utterance, or null when nothing
// was said) | "no-speech" | "aborted" (blob null) | "error" (error =
// "not-allowed" | "audio-capture" | "recorder-failed").
// release() lets the mic go now; dispose() frees it and the AudioContext for
// good.
export function createMicRecorder() {
  let ctx = null;
  let stream = null;
  let graph = null;
  let graphBroken = false;
  let pending = null;   // getUserMedia in flight
  let current = null;   // { handle, fail } — the utterance being recorded
  let idleTimer = null;
  let lastFloor = null; // the noise floor learnt on this stream
  let disposed = false;
  let dropOnArrival = false; // release() came while getUserMedia was pending

  function resumeContext() {
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }

  // Created on the first record() — inside the user's tap, which is what
  // lets the context start. It is never suspended afterwards (a resume
  // outside a tap may be refused) and is closed in dispose().
  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try { ctx = new AC(); } catch (_) { ctx = null; }
      }
    }
    resumeContext();
  }

  // mic -> analyser -> muted gain -> speakers: some engines only process
  // nodes that lead to the destination; the zero gain keeps it silent.
  function ensureGraph() {
    if (graph || graphBroken || !stream || !ctx || ctx.state === "closed") return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; // ~43 ms at 48 kHz: covers a whole FRAME_MS
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(ctx.destination);
      const float = typeof analyser.getFloatTimeDomainData === "function";
      graph = { source, analyser, sink, float, buf: float ? new Float32Array(analyser.fftSize) : new Uint8Array(analyser.fftSize) };
    } catch (_) {
      graphBroken = true; // recordings go on "blind" (see tick)
    }
  }

  function releaseStream() {
    clearTimeout(idleTimer);
    if (graph) {
      [graph.source, graph.analyser, graph.sink].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
      graph = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.onended = null;
        try { track.stop(); } catch (_) {}
      });
      stream = null;
    }
  }

  function scheduleIdleRelease() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!current && !pending) releaseStream();
    }, IDLE_RELEASE_MS);
  }

  // The mic went away under us (unplugged, permission revoked).
  function onTrackEnded() {
    const c = current;
    releaseStream();
    if (c) c.fail("audio-capture");
  }

  function acquire() {
    if (stream && stream.getAudioTracks().some((t) => t.readyState === "live")) return Promise.resolve(stream);
    if (!pending) {
      releaseStream();
      pending = navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS }).then((s) => {
        pending = null;
        // Hung up (or the page went away) while the permission prompt was up,
        // and nothing wants the mic since: don't hold it.
        const drop = disposed || (dropOnArrival && !current);
        dropOnArrival = false;
        if (drop) {
          s.getTracks().forEach((track) => track.stop());
          throw Object.assign(new Error("released"), { name: "AbortError" });
        }
        stream = s;
        lastFloor = null;
        graphBroken = false;
        s.getAudioTracks().forEach((track) => { track.onended = onTrackEnded; });
        // Its utterance was dropped while the permission prompt was up.
        if (!current) scheduleIdleRelease();
        return s;
      }, (e) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  }

  function record({ onCapture } = {}) {
    if (current) current.handle.abort();
    clearTimeout(idleTimer);
    dropOnArrival = false;
    ensureContext();

    const self = { handle: null, fail: null };
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    let settled = false;
    let phase = "opening"; // -> "recording" -> "stopping"
    let recorder = null;
    let mimeType = "";
    const chunks = [];
    let timer = null;
    let stopTimer = null;
    let vad = null;
    let startedAt = 0;
    let blind = false;
    let stopReason = "";

    const blobType = () => (recorder && recorder.mimeType) || mimeType || "audio/webm";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(stopTimer);
      if (vad && vad.floor !== null) lastFloor = vad.floor;
      if (current === self) {
        current = null;
        scheduleIdleRelease();
      }
      resolveDone(result);
    };
    const discard = () => {
      clearInterval(timer);
      if (!recorder) return;
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch (_) {}
      }
    };
    const fail = (error) => {
      if (settled) return;
      discard();
      finish({ blob: null, reason: "error", error });
    };
    // keep: deliver what was recorded (once MediaRecorder has flushed it).
    const end = (reason, keep) => {
      if (settled || phase === "stopping") return;
      if (phase !== "recording" || !keep) {
        discard();
        finish({ blob: null, reason });
        return;
      }
      phase = "stopping";
      stopReason = reason;
      clearInterval(timer);
      try {
        recorder.stop();
      } catch (_) {
        fail("recorder-failed");
        return;
      }
      stopTimer = setTimeout(() => {
        if (settled) return;
        const blob = chunks.length ? new Blob(chunks, { type: blobType() }) : null;
        discard();
        if (blob) finish({ blob, reason: stopReason });
        else fail("recorder-failed");
      }, STOP_TIMEOUT_MS);
    };
    const onStop = () => {
      // Stopped by itself while we were still recording: the mic went away.
      if (phase !== "stopping") {
        fail("audio-capture");
        return;
      }
      finish({ blob: chunks.length ? new Blob(chunks, { type: blobType() }) : null, reason: stopReason });
    };
    const tick = () => {
      if (phase !== "recording") return;
      const now = performance.now();
      if (!blind) {
        ensureGraph();
        if (graph && ctx.state === "running") {
          if (!vad) vad = vadInit(now, lastFloor);
          const { state, event } = vadStep(vad, readRms(graph), now);
          vad = state;
          if (event === "end" || event === "max") end(event, true);
          else if (event === "no-speech") end("no-speech", false);
          return;
        }
        // Capture has started, which lets some engines (Safari) run audio
        // without a tap — ask again until the context gives in or we go blind.
        resumeContext();
        if (now - startedAt < BLIND_AFTER_MS) return;
        // No levels (the context never started, or was interrupted): speech
        // can't be told from silence any more. Record until stop() or the
        // cap and let the transcription decide.
        blind = true;
      }
      if (now - startedAt >= VAD_DEFAULTS.maxSpeechMs) end("max", true);
    };

    const handle = {
      done,
      // End the utterance now: delivered if speech was heard.
      stop: () => end("stop", blind || (vad !== null && vad.speechAt !== null)),
      // Drop it, even while it is being flushed.
      abort: () => {
        if (settled) return;
        discard();
        finish({ blob: null, reason: "aborted" });
      },
    };
    self.handle = handle;
    self.fail = fail;
    current = self;

    acquire().then((s) => {
      if (settled) return;
      mimeType = pickMimeType();
      try {
        recorder = makeRecorder(s, mimeType);
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = onStop;
        recorder.onerror = () => fail("recorder-failed");
        // One blob at the end: concatenated timeslices are not a valid file
        // in every engine.
        recorder.start();
      } catch (_) {
        fail("recorder-failed");
        return;
      }
      phase = "recording";
      startedAt = performance.now();
      resumeContext(); // a page that is capturing may start audio without a tap
      ensureGraph();
      timer = setInterval(tick, FRAME_MS);
      if (onCapture) onCapture();
    }, (e) => {
      if (!settled) finish({ blob: null, reason: "error", error: micErrorCode(e) });
    });

    return handle;
  }

  // Let the mic go now instead of after IDLE_RELEASE_MS (a stream still
  // being opened is let go when it arrives, see acquire).
  function release() {
    if (current) return;
    if (pending) dropOnArrival = true;
    releaseStream();
  }

  function dispose() {
    disposed = true;
    if (current) current.handle.abort();
    releaseStream();
    if (ctx) {
      const c = ctx;
      ctx = null;
      try {
        const p = c.close();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    }
  }

  return { record, release, dispose };
}
