import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { transcribeAudio } from "@/lib/api";
import { createMicRecorder, newTurnId, recorderAvailable } from "@/lib/recorderStt";

// Speech recognition (TR/EN) behind one API, with two engines:
//   "native"   the browser's Web Speech API (Chrome, Edge, Safari): live
//              interim words, nothing to pay
//   "recorder" each utterance is recorded on the device and transcribed by
//              the server (lib/recorderStt.js + api.transcribeAudio) — for
//              browsers without the Web Speech API (Firefox, in-app web
//              views), and after the native one fails in a way the user
//              can't fix (SWITCH_ERRORS). No interim words; `transcribing`
//              covers the wait for the text, and onResult's meta.turnId
//              ties that transcription to the reply's voice (one voice use).
// Callers don't need to know which one runs: start/stop/abort, onResult and
// onEnd behave the same.
//
// Native engine:
//
// `continuous: true` is the key fix here: with it `false` (the old
// setting), Chrome/Safari silently end the session after the FIRST short
// pause in speech — not just at the end of a sentence, mid-sentence too —
// firing `onend` with whatever partial transcript it had. The caller
// (onResult) then sends that half-sentence to Luna as if it were the whole
// message: a wasted, confusing turn that still costs real quota/tokens.
// `continuous: true` keeps the recognizer open across natural pauses; the
// browser still marks each completed utterance `isFinal` on its own, so
// onResult still fires per-utterance exactly as before — it just doesn't
// tear down the whole session after the first one.
//
// Some browsers still end a `continuous` session on their own after a
// longer silence or a background/tab-visibility change. `autoRestart`
// (opt-in, used by the voice-call flow) makes `onend` restart listening
// on its own unless `stop()` was called deliberately — so an accidental
// engine-side stop is invisible to the user instead of silently ending
// the call.

// Native errors that mean "this recognizer can't work here" — its speech
// servers are out of reach (Brave ships the API without them; some networks
// block them), dictation is off (iOS), there's no model for the language —
// rather than something the user can fix (mic permission, no mic). After one
// of them the page uses the recorder for the rest of its life: retrying a
// recognizer that just said it can't serve us only fails the next turn too.
const SWITCH_ERRORS = ["network", "service-not-allowed", "language-not-supported"];
let nativeUnusable = false; // module-level: outlives remounts of the page

const nativeRecognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const initialEngine = () => (nativeRecognition() && !nativeUnusable ? "native" : "recorder");

const STT_RETRY_DELAY_MS = 700;
// A transcription that hangs (a stalled upload, a stuck server) would keep
// the call on "thinking" with nothing to tap: give up and show the
// connection error instead.
const STT_DEADLINE_MS = 30000;

// One recorded utterance -> text. A dropped connection or a server hiccup
// gets one quiet retry (same turn id: still one voice use).
async function transcribe(blob, opts) {
  try {
    return await transcribeAudio(blob, opts);
  } catch (e) {
    const status = e?.response?.status;
    if ((status && status < 500) || opts.signal?.aborted) throw e;
    await new Promise((resolve) => setTimeout(resolve, STT_RETRY_DELAY_MS));
    if (opts.signal?.aborted) throw e;
    return transcribeAudio(blob, opts);
  }
}

// A failed transcription as an error code the screens know.
function sttErrorCode(e) {
  const status = e?.response?.status;
  if (status === 429) return "quota";
  if (!status || status >= 500) return "network";
  return "transcription-failed";
}

export function useSpeechRecognition({ lang, onResult, onEnd, autoRestart = false }) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported] = useState(() => !!nativeRecognition() || recorderAvailable());
  const [engine, setEngine] = useState(initialEngine);
  // Last fatal recognition error ("not-allowed", "audio-capture", ...) so
  // the UI can say what's wrong; cleared on the next start().
  const [error, setError] = useState(null);
  // stop() only ASKS the engine to finish: the last words arrive a moment
  // later via onresult, then onend. `finalizing` covers that gap so a UI
  // doesn't flash back to "ready" in between.
  const [finalizing, setFinalizing] = useState(false);
  // true once the engine is really recording (onaudiostart) — `listening`
  // flips on at start(), a moment before the mic is actually open.
  const [capturing, setCapturing] = useState(false);
  // Recorder only: the utterance is with the server, the text is on its way.
  const [transcribing, setTranscribing] = useState(false);
  const activeRef = useRef(false);
  // What happened in the current session, reported to onEnd.
  const sessionRef = useRef({ heard: false, noSpeech: false, aborted: false });
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const autoRestartRef = useRef(autoRestart);
  autoRestartRef.current = autoRestart;
  const deliberateStopRef = useRef(false);
  const engineRef = useRef(engine);
  // The native engine failed with a SWITCH_ERRORS code: its onend hands the
  // session over to the recorder.
  const switchingRef = useRef(false);
  const micRef = useRef(null); // lib/recorderStt mic, made on first use
  const recRef = useRef(null); // the recorder session running now: { phase, handle, ctrl }
  // A finished recorder session, reported once its state has rendered (see
  // the effect below).
  const deliveryRef = useRef(null);
  const [deliverySeq, setDeliverySeq] = useState(0);
  const startRecorderRef = useRef(() => false);

  // ---------------------------------------------------------------- recorder
  // Closes recorder session `r` the way the native onend does — unless it was
  // aborted (or replaced) meanwhile.
  const endRecorderSession = useCallback((r, { text = "", turnId, noSpeech = false, errorCode = null } = {}) => {
    if (recRef.current !== r) return;
    recRef.current = null;
    activeRef.current = false;
    setListening(false);
    setCapturing(false);
    setFinalizing(false);
    setTranscribing(false);
    setInterim("");
    if (errorCode) {
      deliberateStopRef.current = true;
      setError(errorCode);
    }
    const s = sessionRef.current;
    if (text) s.heard = true;
    if (noSpeech) s.noSpeech = true;
    deliveryRef.current = { text, turnId, info: { ...s } };
    setDeliverySeq((n) => n + 1);
  }, []);

  // Results and the end are reported only after listening=false has
  // rendered: a caller deciding what to do next (reopen the mic after a
  // silent turn) reads the hook's last rendered state. Both engines end this
  // way — the native "end" event often comes right on the heels of its
  // "no-speech" error, or with no error at all, before React has rendered
  // anything: reported straight from there, the caller saw `listening` still
  // true and never reopened the mic. A layout effect, so what the caller does
  // about it (sending the turn, "Mikrofon açılıyor") lands before the browser
  // paints — no "idle" screen flashing in between.
  useLayoutEffect(() => {
    const d = deliveryRef.current;
    if (!d) return;
    deliveryRef.current = null;
    if (d.text) onResultRef.current?.(d.text, { turnId: d.turnId });
    onEndRef.current?.(d.info);
    // (the native engine restarts itself in onend)
    if (!d.native && autoRestartRef.current && !deliberateStopRef.current) startRecorderRef.current();
  }, [deliverySeq]);

  // Records one utterance into the current session (opened by start(), or
  // handed over by the native engine) and has it transcribed.
  const runRecorder = useCallback(() => {
    if (!micRef.current) micRef.current = createMicRecorder();
    const r = { phase: "recording", handle: null, ctrl: null };
    recRef.current = r;
    r.handle = micRef.current.record({
      onCapture: () => { if (recRef.current === r) setCapturing(true); },
    });
    r.handle.done.then((res) => {
      if (recRef.current !== r) return;
      if (res.error) {
        endRecorderSession(r, { errorCode: res.error });
        return;
      }
      // Nothing worth sending (silence, a cough, stop() before any speech)
      // never leaves the device.
      if (!res.blob) {
        endRecorderSession(r, { noSpeech: res.reason === "no-speech" });
        return;
      }
      const turnId = newTurnId();
      r.phase = "transcribing";
      r.ctrl = window.AbortController ? new window.AbortController() : null;
      // Luna's answer comes next: the mic indicator (and the phone's "call"
      // audio mode) must be off before her voice, however fast it is.
      micRef.current?.release();
      setListening(false);
      setCapturing(false);
      setFinalizing(true);
      setTranscribing(true);
      const deadline = r.ctrl ? setTimeout(() => r.ctrl.abort(), STT_DEADLINE_MS) : null;
      const settle = (outcome) => {
        clearTimeout(deadline);
        endRecorderSession(r, outcome);
      };
      transcribe(res.blob, { turnId, signal: r.ctrl?.signal }).then(
        (text) => settle({ text, turnId, noSpeech: !text }),
        // (the deadline's abort ends up here as "network"; an abort() or an
        // unmount has already let go of `r`, so endRecorderSession ignores it)
        (e) => settle({ errorCode: sttErrorCode(e) }),
      );
    });
  }, [endRecorderSession]);

  // Returns false while a session is still recording or being transcribed.
  const startRecorder = useCallback(() => {
    if (activeRef.current || !recorderAvailable()) return false;
    deliberateStopRef.current = false;
    setError(null);
    sessionRef.current = { heard: false, noSpeech: false, aborted: false };
    activeRef.current = true;
    setCapturing(false);
    setFinalizing(false);
    setTranscribing(false);
    setInterim("");
    setListening(true);
    runRecorder();
    return true;
  }, [runRecorder]);
  startRecorderRef.current = startRecorder;

  // The mic and its AudioContext go with the page; an upload in flight is
  // cancelled.
  useEffect(() => () => {
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.handle.abort();
      r.ctrl?.abort();
    }
    micRef.current?.dispose();
    micRef.current = null;
  }, []);

  // ---------------------------------------------------------------- native
  useEffect(() => {
    const SR = nativeRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang === "tr" ? "tr-TR" : "en-US";

    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText || interimText) sessionRef.current.heard = true;
      setInterim(interimText);
      if (finalText) {
        setInterim("");
        onResultRef.current && onResultRef.current(finalText.trim());
      }
    };
    rec.onaudiostart = () => setCapturing(true);
    rec.onend = () => {
      if (switchingRef.current) {
        switchingRef.current = false;
        // Same session, other engine: the caller just keeps seeing
        // "listening" (interim words not yet final are lost with the engine).
        if (activeRef.current && !deliberateStopRef.current) {
          setInterim("");
          setCapturing(false);
          runRecorder();
          return;
        }
      }
      activeRef.current = false;
      setListening(false);
      setFinalizing(false);
      setCapturing(false);
      setInterim("");
      // Reported once this has rendered (the delivery effect above).
      deliveryRef.current = { text: "", info: { ...sessionRef.current }, native: true };
      setDeliverySeq((n) => n + 1);
      // Only the voice-call flow opts into this — a plain single-tap mic
      // press must still behave like a deliberate on/off toggle.
      if (autoRestartRef.current && !deliberateStopRef.current) {
        try {
          rec.start();
          activeRef.current = true;
          setListening(true);
        } catch (_) {
          // Already starting/started, or the mic permission dropped —
          // either way, nothing more to do here; the caller's own state
          // (e.g. the call UI) is the source of truth for whether a retry
          // should happen, not this hook looping on its own.
        }
      }
    };
    rec.onerror = (e) => {
      // Not the user's problem and not worth an error screen: switch engines
      // (onend follows and carries the session on with the recorder).
      // Except a "network" while the device is plainly offline: the recorder
      // couldn't reach the server either, and the native engine (live words,
      // no upload) will work again once the connection is back.
      const offline = e.error === "network" && navigator.onLine === false;
      if (SWITCH_ERRORS.includes(e.error) && !offline && recorderAvailable()) {
        nativeUnusable = true;
        engineRef.current = "recorder";
        setEngine("recorder");
        switchingRef.current = true;
        return;
      }
      // "no-speech"/"aborted" are routine (silence, or we called stop())
      // — onend follows and closes the session (flipping `listening` off
      // here already would show the idle screen until then). Anything else
      // (permission denied, mic hardware gone) should NOT keep retrying.
      if (e.error === "no-speech") {
        sessionRef.current.noSpeech = true;
        return;
      }
      if (e.error === "aborted") return;
      deliberateStopRef.current = true;
      setError(e.error);
      setListening(false);
      setFinalizing(false);
      setCapturing(false);
    };
    recognitionRef.current = rec;

    return () => {
      deliberateStopRef.current = true;
      try { rec.abort(); } catch (_) {}
    };
  }, [lang, runRecorder]);

  // ---------------------------------------------------------------- controls
  // Returns whether a session actually started (false if one is still
  // running or ending — the engine throws InvalidStateError then).
  const start = useCallback(() => {
    if (engineRef.current === "recorder") return startRecorder();
    if (!recognitionRef.current) return false;
    deliberateStopRef.current = false;
    setError(null);
    try {
      recognitionRef.current.start();
      sessionRef.current = { heard: false, noSpeech: false, aborted: false };
      activeRef.current = true;
      setCapturing(false);
      setListening(true);
      return true;
    } catch (_) {
      return false;
    }
  }, [startRecorder]);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (r) {
      // Recorder: end the utterance now and transcribe it, if there was
      // speech in it (a session already being transcribed just finishes).
      deliberateStopRef.current = true;
      if (r.phase === "recording") {
        setFinalizing(true);
        setListening(false);
        r.handle.stop();
      }
      return;
    }
    if (!recognitionRef.current) return;
    deliberateStopRef.current = true;
    // Only a running session ends with onend — never leave finalizing stuck.
    if (activeRef.current) setFinalizing(true);
    try { recognitionRef.current.stop(); } catch (_) {}
    setListening(false);
  }, []);

  // Unlike stop(), which still delivers a final result for the words heard
  // so far, abort() discards them — for hanging up mid-sentence, where the
  // half-spoken fragment must NOT be sent.
  const abort = useCallback(() => {
    // A recorder session that ended but isn't reported yet: report it as
    // aborted, without its words (and don't let autoRestart reopen the mic).
    if (deliveryRef.current) {
      deliveryRef.current = { info: { ...deliveryRef.current.info, aborted: true } };
      deliberateStopRef.current = true;
    }
    const r = recRef.current;
    // Nothing follows an abort right away (hang-up, page hidden, Luna about
    // to speak): the mic indicator goes off now, not after the idle delay.
    const releaseMic = () => micRef.current?.release();
    if (r) {
      // Recorder: drop the recording and cancel its transcription.
      recRef.current = null;
      deliberateStopRef.current = true;
      r.handle.abort();
      r.ctrl?.abort();
      releaseMic();
      activeRef.current = false;
      setListening(false);
      setFinalizing(false);
      setCapturing(false);
      setTranscribing(false);
      setInterim("");
      onEndRef.current?.({ ...sessionRef.current, aborted: true });
      return;
    }
    releaseMic(); // held idle between recorder turns
    if (!recognitionRef.current) return;
    deliberateStopRef.current = true;
    sessionRef.current.aborted = true; // onend still fires; tell onEnd why
    try { recognitionRef.current.abort(); } catch (_) {}
    activeRef.current = false;
    setListening(false);
    setFinalizing(false);
    setCapturing(false);
    setInterim("");
  }, []);

  // Forget an earlier failure (e.g. from the chat mic) before a fresh start.
  const clearError = useCallback(() => setError(null), []);

  return {
    listening, interim, supported, error, finalizing, capturing, transcribing, engine,
    start, stop, abort, clearError,
  };
}
