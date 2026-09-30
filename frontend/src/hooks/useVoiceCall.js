import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTTS } from "@/lib/api";
import { primeVoiceAudio, attachAnalyser, micDelayAfterSpeechMs, playTurnCue } from "@/lib/voiceAudio";
import { toSpoken } from "@/lib/spokenText";

// Everything that makes the voice call a conversation rather than a
// walkie-talkie. Luna.jsx owns the chat (sending messages); this hook owns
// the call around it:
//   - hands-free turns: after Luna finishes speaking the mic reopens on its
//     own (never while she is still audible — the mic would hear her); two
//     silent turns in a row pause it until the next tap
//   - your turn ends after a short silence, not at the first breath
//   - playback: live level for the visuals, resume after an outside pause,
//     replay of the last reply, and the reply as text if her voice fails
//   - phone behaviour: Android Back ends the call, lock-screen/headset
//     controls, a short "moonset" before the screen closes

const ENDPOINT_MS = 1200;        // silence that ends your turn
const CLOSE_ANIMATION_MS = 460;  // matches moonScene exit() / .call-exit
const HANDS_FREE_KEY = "luna_call_handsfree";
const TURNS_SEEN_KEY = "luna_call_turns_seen";
const isAndroid = /Android/i.test(navigator.userAgent);
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function readNumber(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch (_) { return 0; }
}

export function useVoiceCall({ lang, mode, t, quotaMessage, speech, sending, sendTurn }) {
  const [active, setActive] = useState(false);     // screen mounted
  const [closing, setClosing] = useState(false);   // moonset running
  const [handsFree, setHandsFree] = useState(() => {
    try { return localStorage.getItem(HANDS_FREE_KEY) !== "0"; } catch (_) { return true; }
  });
  const [autoPaused, setAutoPaused] = useState(false); // hands-free waits for a tap
  const [playingId, setPlayingId] = useState(null);
  const [pausedId, setPausedId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [reply, setReply] = useState(null);            // {id, text} Luna's latest reply in this call
  const [voiceFailed, setVoiceFailed] = useState(null); // {id, message} her voice didn't come
  const [canReplay, setCanReplay] = useState(false);
  const [pendingText, setPendingText] = useState(""); // your finished phrases in this turn
  const [lastSent, setLastSent] = useState("");
  const [flareKey, setFlareKey] = useState(0);
  const [turnsSeen, setTurnsSeen] = useState(() => readNumber(TURNS_SEEN_KEY));
  const [handoff, setHandoff] = useState(false);         // the mic is about to reopen on its own
  const [sendingSoon, setSendingSoon] = useState(false); // your words are being finalized to send
  const [micCheck, setMicCheck] = useState("idle");      // "idle" | "retrying" | "failed" (see below)

  const liveRef = useRef(false);
  const genRef = useRef(0);            // which call a reply belongs to (bumped on every open)
  const ttsPendingRef = useRef(false); // Luna's voice for a reply is being fetched
  const lastInterimRef = useRef("");   // words heard but not yet final, in case no final comes
  const audioRef = useRef(null);       // the reply element now loaded (for captions)
  const speechRef = useRef(null);      // {audio, release}
  const lastReplyRef = useRef(null);   // {msg, url} kept for "Tekrar dinle"
  const turnRef = useRef({ parts: [], timer: null, flushOnFinal: false });
  const listenTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const silenceRef = useRef(0);

  // Latest values for callbacks that run later (timers, media events).
  const latest = useRef({});
  latest.current = { speech, sending, handsFree, autoPaused, lang, mode, t, quotaMessage, sendTurn };

  // ---------------------------------------------------------------- audio
  const clearMediaSession = useCallback(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = null;
      ms.playbackState = "none";
      ["play", "pause", "stop"].forEach((a) => ms.setActionHandler(a, null));
    } catch (_) {}
  }, []);

  // Stop the loaded reply for good and free its audio graph. (Its blob URL
  // stays alive in lastReplyRef for replay.)
  const dropSpeech = useCallback(() => {
    const s = speechRef.current;
    if (!s) return;
    speechRef.current = null;
    s.audio.onended = s.audio.onerror = s.audio.onpause = s.audio.onplaying = null;
    s.audio.pause();
    s.release();
    setPausedId(null);
  }, []);

  const forgetLastReply = useCallback(() => {
    if (lastReplyRef.current) URL.revokeObjectURL(lastReplyRef.current.url);
    lastReplyRef.current = null;
    setCanReplay(false);
  }, []);

  // ---------------------------------------------------------------- listening
  const cancelListenTimer = useCallback(() => {
    clearTimeout(listenTimerRef.current);
    listenTimerRef.current = null;
    setHandoff(false);
  }, []);

  const clearTurn = useCallback(() => {
    clearTimeout(turnRef.current.timer);
    turnRef.current = { parts: [], timer: null, flushOnFinal: false };
    lastInterimRef.current = "";
    setPendingText("");
    setSendingSoon(false);
  }, []);

  const startListening = useCallback(() => {
    cancelListenTimer();
    const { speech: sp } = latest.current;
    if (!liveRef.current || !sp.supported || sp.listening) return;
    lastInterimRef.current = "";
    if (!sp.start()) {
      // The previous session is still ending — try once more shortly.
      listenTimerRef.current = setTimeout(() => {
        if (liveRef.current && !latest.current.speech.listening) latest.current.speech.start();
      }, 350);
    }
  }, [cancelListenTimer]);

  // Never while Luna is audible or about to be: the mic has no echo
  // cancellation and would send her own words back as yours.
  const canAutoListen = useCallback(() => {
    const { speech: sp, sending: busy, handsFree: hf, autoPaused: paused } = latest.current;
    return liveRef.current && hf && !paused && sp.supported && !sp.error && !sp.listening
      && !busy && !ttsPendingRef.current && !speechRef.current && document.visibilityState === "visible";
  }, []);

  // Hands-free: reopen the mic after `delay` if nothing else is going on.
  // Until then the screen already shows "Mikrofon açılıyor" (handoff) rather
  // than flashing back to the idle screen between turns.
  const listenNext = useCallback((delay, { cue = false } = {}) => {
    cancelListenTimer();
    if (!canAutoListen()) return;
    setHandoff(true);
    listenTimerRef.current = setTimeout(async () => {
      if (!canAutoListen()) {
        setHandoff(false);
        return;
      }
      if (cue && !isAndroid) await playTurnCue(); // Android's recognizer beeps itself
      if (canAutoListen()) startListening();
      else setHandoff(false);
    }, delay);
  }, [cancelListenTimer, canAutoListen, startListening]);

  // ---------------------------------------------------------------- playback
  const playUrl = useCallback((msg, url) => {
    // Luna is about to speak: the mic must be closed (and any half turn
    // dropped) before a single word of hers comes out of the speaker.
    cancelListenTimer();
    if (latest.current.speech.listening) latest.current.speech.abort();
    clearTurn();
    dropSpeech();
    const audio = new Audio(url);
    audioRef.current = audio;
    const { analyser: node, release } = attachAnalyser(audio);
    speechRef.current = { audio, release };
    setAnalyser(node);
    setPlayingId(msg.id);
    setPausedId(null);

    const isCurrent = () => speechRef.current?.audio === audio;
    audio.onended = () => {
      if (!isCurrent()) return;
      dropSpeech();
      setPlayingId(null);
      silenceRef.current = 0;
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
      listenNext(micDelayAfterSpeechMs(), { cue: true });
    };
    audio.onerror = () => {
      if (!isCurrent()) return;
      dropSpeech();
      setPlayingId(null);
      setVoiceFailed({ id: msg.id, message: latest.current.t("Sesim şu an gelmedi, cevabımı yazdım.", "My voice didn't come through, so here's my answer.") });
    };
    // A pause the app didn't make (another app took the audio, a headset
    // button): show "Devam et" instead of pretending she's still talking.
    audio.onpause = () => {
      if (!isCurrent() || audio.ended) return;
      setPlayingId(null);
      setPausedId(msg.id);
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
    };
    audio.onplaying = () => {
      if (!isCurrent() || !liveRef.current) return;
      setPausedId(null);
      setPlayingId(msg.id);
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
    };

    // Lock screen / notification / headset controls (Chrome shows them for
    // clips of 5 s or more).
    const ms = navigator.mediaSession;
    if (ms && window.MediaMetadata) {
      try {
        ms.metadata = new window.MediaMetadata({
          title: "Luna",
          artist: latest.current.t("Sesli görüşme", "Voice call"),
          artwork: [{ src: `${process.env.PUBLIC_URL || ""}/icon-512.png`, sizes: "512x512", type: "image/png" }],
        });
        ms.setActionHandler("play", () => { if (isCurrent()) audio.play().catch(() => {}); });
        ms.setActionHandler("pause", () => { if (isCurrent()) audio.pause(); });
        ms.setActionHandler("stop", () => closeRef.current());
      } catch (_) {}
    }

    audio.play().catch((e) => {
      if (e?.name === "AbortError" || !isCurrent()) return;
      dropSpeech();
      setPlayingId(null);
      setVoiceFailed({ id: msg.id, message: latest.current.t("Sesim şu an gelmedi, cevabımı yazdım.", "My voice didn't come through, so here's my answer.") });
    });
  }, [cancelListenTimer, clearTurn, dropSpeech, listenNext]);

  // Which call is open now — Luna.jsx reads it when a turn is sent and
  // hands it back with the reply, so a reply to an earlier call is ignored.
  const generation = useCallback(() => genRef.current, []);

  // Luna.jsx calls this with each reply that arrives while the call is live.
  const onReply = useCallback(async (msg, gen) => {
    if (!liveRef.current || gen !== genRef.current) return;
    setReply({ id: msg.id, text: msg.text });
    setVoiceFailed(null);
    forgetLastReply(); // "Tekrar dinle" must always belong to this reply
    setLoadingId(msg.id);
    ttsPendingRef.current = true;
    try {
      const url = await fetchTTS({ text: toSpoken(msg.text) || msg.text, mode: latest.current.mode });
      ttsPendingRef.current = false;
      setLoadingId((id) => (id === msg.id ? null : id));
      if (!liveRef.current || gen !== genRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      lastReplyRef.current = { msg, url };
      setCanReplay(true);
      playUrl(msg, url);
    } catch (e) {
      ttsPendingRef.current = false;
      setLoadingId((id) => (id === msg.id ? null : id));
      if (!liveRef.current || gen !== genRef.current) return;
      const { quotaMessage: qm, t: tr } = latest.current;
      setVoiceFailed({
        id: msg.id,
        message: qm(e) || tr("Sesim şu an gelmedi, cevabımı yazdım.", "My voice didn't come through, so here's my answer."),
      });
    }
  }, [forgetLastReply, playUrl]);

  // ---------------------------------------------------------------- your turn
  const flushTurn = useCallback(() => {
    const turn = turnRef.current;
    clearTimeout(turn.timer);
    if (latest.current.sending) {
      // The previous turn is still on its way — send this one right after.
      turn.timer = setTimeout(() => flushTurnRef.current(), 400);
      return;
    }
    const text = turn.parts.join(" ").replace(/\s+/g, " ").trim();
    turnRef.current = { parts: [], timer: null, flushOnFinal: false };
    lastInterimRef.current = "";
    setPendingText("");
    setSendingSoon(false);
    if (!text || !liveRef.current) return;
    const sp = latest.current.speech;
    if (sp.listening) sp.stop();
    silenceRef.current = 0;
    setLastSent(text);
    setVoiceFailed(null);
    setFlareKey((k) => k + 1);
    setTurnsSeen((n) => {
      const next = n + 1;
      try { localStorage.setItem(TURNS_SEEN_KEY, String(next)); } catch (_) {}
      return next;
    });
    latest.current.sendTurn(text);
  }, []);
  const flushTurnRef = useRef(flushTurn);
  flushTurnRef.current = flushTurn;

  // Ask the engine for its last words, then send them together with the
  // turn (handleFinal flushes; handleSpeechEnd covers "no final came").
  const finishTurn = useCallback(() => {
    const turn = turnRef.current;
    clearTimeout(turn.timer);
    turn.flushOnFinal = true;
    setSendingSoon(true);
    setLastSent([turn.parts.join(" "), lastInterimRef.current].filter(Boolean).join(" "));
    latest.current.speech.stop();
  }, []);

  // The silence timer: you stopped talking. If a phrase is still only
  // half-recognised, finish it first instead of sending without it.
  const armEndpoint = useCallback(() => {
    clearTimeout(turnRef.current.timer);
    turnRef.current.timer = setTimeout(() => {
      if (latest.current.speech.interim) finishTurn();
      else flushTurn();
    }, ENDPOINT_MS);
  }, [flushTurn, finishTurn]);

  // From the speech hook: a finished phrase. Returns true when the call took
  // it (otherwise the chat composer handles it as before).
  const handleFinal = useCallback((text) => {
    if (!liveRef.current) return false;
    if (text) turnRef.current.parts.push(text);
    lastInterimRef.current = "";
    setPendingText(turnRef.current.parts.join(" "));
    silenceRef.current = 0;
    if (turnRef.current.flushOnFinal) flushTurn();
    else armEndpoint();
    return true;
  }, [flushTurn, armEndpoint]);

  // Still talking (new interim words) — keep the turn open.
  useEffect(() => {
    if (!liveRef.current || !speech.interim) return;
    lastInterimRef.current = speech.interim;
    if (turnRef.current.parts.length && !turnRef.current.flushOnFinal) armEndpoint();
  }, [speech.interim, armEndpoint]);

  // From the speech hook: a recognition session ended.
  const handleSpeechEnd = useCallback((info) => {
    if (!liveRef.current || info.aborted) return;
    const turn = turnRef.current;
    if (turn.flushOnFinal && !turn.parts.length && lastInterimRef.current) {
      // "Gönder" but the engine never finalized — send what was shown.
      turn.parts.push(lastInterimRef.current);
    }
    if (turn.parts.length) {
      // Android ends the session itself after each utterance — its own
      // endpointer already waited, so send now.
      flushTurn();
      return;
    }
    setSendingSoon(false);
    if (turn.flushOnFinal) {
      // "Durdur" with nothing heard: wait for a tap.
      turn.flushOnFinal = false;
      setAutoPaused(true);
      return;
    }
    if (info.noSpeech || !info.heard) {
      silenceRef.current += 1;
      if (silenceRef.current < 2) listenNext(300);
      else setAutoPaused(true);
    }
  }, [flushTurn, listenNext]);

  // A mic "not-allowed" on Android can also mean "recognizer busy". If the
  // permission is actually granted, retry once — quietly: until that is
  // decided the screen keeps saying "Mikrofon açılıyor" (see `state`).
  useEffect(() => {
    if (!liveRef.current || speech.error !== "not-allowed") return;
    if (micCheck === "retrying") {
      setMicCheck("failed"); // the retry failed too — show the real error
      return;
    }
    if (micCheck !== "idle") return;
    setMicCheck("retrying");
    const giveUp = () => setMicCheck("failed");
    if (!navigator.permissions?.query) {
      giveUp();
      return;
    }
    navigator.permissions.query({ name: "microphone" }).then((p) => {
      if (p.state !== "granted" || !liveRef.current || document.visibilityState !== "visible") {
        giveUp();
        return;
      }
      setTimeout(() => {
        if (!liveRef.current) return;
        latest.current.speech.clearError();
        startListening();
      }, 600);
    }).catch(giveUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.error, startListening]);

  useEffect(() => {
    if (speech.capturing) setMicCheck("idle");
  }, [speech.capturing]);

  // Android stops recognition when the page is hidden; never send half a
  // sentence from there, and pick the conversation up again on return.
  useEffect(() => {
    if (!active) return undefined;
    const onVisibility = () => {
      if (!liveRef.current) return;
      if (document.visibilityState === "hidden") {
        cancelListenTimer();
        if (latest.current.speech.listening) latest.current.speech.abort();
        clearTurn();
      } else {
        listenNext(400);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, listenNext, cancelListenTimer, clearTurn]);

  // ---------------------------------------------------------------- open / close
  const teardown = useCallback(() => {
    if (!liveRef.current) return;
    liveRef.current = false;
    cancelListenTimer();
    clearTurn();
    latest.current.speech.abort();
    dropSpeech();
    forgetLastReply();
    clearMediaSession();
    setPlayingId(null);
    setLoadingId(null);
    setAnalyser(null);
    ttsPendingRef.current = false;
    setClosing(true);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setActive(false);
      setClosing(false);
    }, prefersReducedMotion() ? 0 : CLOSE_ANIMATION_MS);
  }, [dropSpeech, cancelListenTimer, clearTurn, forgetLastReply, clearMediaSession]);

  // Every way out goes through history, so Android Back and the on-screen
  // buttons share one path and no stray history entry is left behind.
  const close = useCallback(() => {
    if (window.history.state?.lunaCall) window.history.back();
    else teardown();
  }, [teardown]);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    // A reload on the call's history entry must not leave its marker behind.
    if (window.history.state?.lunaCall) {
      const { lunaCall, ...rest } = window.history.state; // eslint-disable-line no-unused-vars
      window.history.replaceState(rest, "");
    }
    const onPop = () => {
      if (liveRef.current && !window.history.state?.lunaCall) teardown();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [teardown]);

  const open = useCallback(() => {
    const { speech: sp, handsFree: hf } = latest.current;
    primeVoiceAudio(); // inside the tap: lets audio (and its visuals) run
    clearTimeout(closeTimerRef.current);
    if (sp.listening) sp.abort(); // the chat mic, if it was on
    sp.clearError();
    liveRef.current = true;
    genRef.current += 1;
    silenceRef.current = 0;
    setMicCheck("idle");
    clearTurn();
    setReply(null);
    setVoiceFailed(null);
    setLastSent("");
    setAutoPaused(false);
    setClosing(false);
    setActive(true);
    if (!window.history.state?.lunaCall) {
      // Keep React Router's own state; same URL, just a marker.
      window.history.pushState({ ...window.history.state, lunaCall: true }, "");
    }
    // Hands-free starts listening straight away — still inside the tap, so
    // a first-time mic permission prompt appears right now.
    // (Not while a message sent before the call is still being answered —
    // that reply is ignored, and the mic opens when you tap.)
    if (hf && sp.supported && !latest.current.sending) {
      setTimeout(() => { if (liveRef.current) startListening(); }, 0);
    }
  }, [startListening, clearTurn]);

  useEffect(() => () => {
    clearTimeout(closeTimerRef.current);
    clearTimeout(listenTimerRef.current);
    clearTimeout(turnRef.current.timer); // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- controls
  // A "not-allowed" we're still quietly retrying is not an error yet.
  const micRetrying = speech.error === "not-allowed" && micCheck !== "failed";
  const state = (() => {
    if (!speech.supported) return "error";
    if (speech.error && !speech.listening && !micRetrying) return "error";
    if (speech.listening || handoff || micRetrying) return "listening";
    // (finalizing alone — "Durdur" with nothing heard — is not "thinking")
    if (sending || sendingSoon || (loadingId && loadingId === reply?.id)) return "thinking";
    if (pausedId) return "paused";
    if (playingId) return "speaking";
    if (voiceFailed) return "readout";
    return "idle";
  })();

  const mainAction = useCallback(() => {
    primeVoiceAudio();
    const sp = latest.current.speech;
    setAutoPaused(false);
    silenceRef.current = 0;
    if (state === "thinking") return;
    if (state === "listening") {
      if (!sp.listening) {
        // The mic was only about to reopen: don't — wait for a tap.
        cancelListenTimer();
        setAutoPaused(true);
        return;
      }
      if (turnRef.current.parts.length || sp.interim) {
        // "Gönder": send now, don't wait for the silence timer.
        if (sp.interim) finishTurn();
        else flushTurn();
      } else {
        // "Durdur": nothing heard — stop and wait for a tap.
        clearTimeout(turnRef.current.timer);
        lastInterimRef.current = "";
        turnRef.current.flushOnFinal = true;
        sp.stop();
        setAutoPaused(true);
      }
      return;
    }
    if (state === "paused") {
      speechRef.current?.audio.play().catch(() => {});
      return;
    }
    if (state === "speaking") {
      // Interrupt: Luna stops, you talk.
      dropSpeech();
      setPlayingId(null);
      setAnalyser(null);
    }
    setVoiceFailed(null);
    startListening();
  }, [state, dropSpeech, flushTurn, finishTurn, startListening, cancelListenTimer]);

  // Paused: talk instead of resuming.
  const talkInstead = useCallback(() => {
    primeVoiceAudio();
    dropSpeech();
    setPlayingId(null);
    setAnalyser(null);
    setAutoPaused(false);
    startListening();
  }, [dropSpeech, startListening]);

  const replay = useCallback(() => {
    primeVoiceAudio();
    const last = lastReplyRef.current;
    if (!last || !liveRef.current) return;
    cancelListenTimer();
    if (latest.current.speech.listening) latest.current.speech.abort();
    clearTurn();
    setVoiceFailed(null);
    playUrl(last.msg, last.url);
  }, [playUrl, cancelListenTimer, clearTurn]);

  const toggleHandsFree = useCallback(() => {
    const next = !latest.current.handsFree;
    setHandsFree(next);
    setAutoPaused(false);
    try { localStorage.setItem(HANDS_FREE_KEY, next ? "1" : "0"); } catch (_) {}
    if (next && state === "idle") {
      primeVoiceAudio();
      startListening();
    }
  }, [state, startListening]);

  return {
    active,
    closing,
    isLive: () => liveRef.current,
    generation,
    open,
    close,
    onReply,
    handleFinal,
    handleSpeechEnd,
    modalProps: {
      state,
      capturing: speech.capturing,
      interim: speech.interim,
      pendingText,
      speechError: speech.error,
      supported: speech.supported,
      lastSent,
      replyText: reply?.text || "",
      voiceFailedMessage: voiceFailed?.message || "",
      canReplay,
      handsFree,
      autoPaused,
      coach: turnsSeen < 2,
      audioRef,
      analyser: state === "speaking" ? analyser : null,
      flareKey,
      exiting: closing,
      onMainAction: mainAction,
      onTalkInstead: talkInstead,
      onReplay: replay,
      onToggleHandsFree: toggleHandsFree,
      onClose: close,
    },
  };
}
