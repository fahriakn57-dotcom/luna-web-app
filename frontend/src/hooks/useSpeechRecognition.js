import { useEffect, useRef, useState, useCallback } from "react";

// Browser Web Speech API based recognition (TR/EN).
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
export function useSpeechRecognition({ lang, onResult, autoRestart = false }) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(true);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const autoRestartRef = useRef(autoRestart);
  autoRestartRef.current = autoRestart;
  const deliberateStopRef = useRef(false);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
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
      setInterim(interimText);
      if (finalText) {
        setInterim("");
        onResultRef.current && onResultRef.current(finalText.trim());
      }
    };
    rec.onend = () => {
      setListening(false);
      // Only the voice-call flow opts into this — a plain single-tap mic
      // press must still behave like a deliberate on/off toggle.
      if (autoRestartRef.current && !deliberateStopRef.current) {
        try {
          rec.start();
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
      // "no-speech"/"aborted" are routine (silence, or we called stop())
      // — let onend's autoRestart logic handle those. Anything else
      // (permission denied, mic hardware gone) should NOT keep retrying.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        deliberateStopRef.current = true;
      }
      setListening(false);
    };
    recognitionRef.current = rec;

    return () => {
      deliberateStopRef.current = true;
      try { rec.abort(); } catch (_) {}
    };
  }, [lang]);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    deliberateStopRef.current = false;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (_) {}
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    deliberateStopRef.current = true;
    try { recognitionRef.current.stop(); } catch (_) {}
    setListening(false);
  }, []);

  // Unlike stop(), which still delivers a final result for the words heard
  // so far, abort() discards them — for hanging up mid-sentence, where the
  // half-spoken fragment must NOT be sent.
  const abort = useCallback(() => {
    if (!recognitionRef.current) return;
    deliberateStopRef.current = true;
    try { recognitionRef.current.abort(); } catch (_) {}
    setListening(false);
    setInterim("");
  }, []);

  return { listening, interim, supported, start, stop, abort };
}
