import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTTS } from "@/lib/api";
import { primeVoiceAudio, micDelayAfterSpeechMs, playTurnCue } from "@/lib/voiceAudio";
import { createVoicePlayer } from "@/lib/voicePlayer";
import { toSpoken } from "@/lib/spokenText";
import { toSpeechPieces } from "@/lib/speechChunks";

// Everything that makes the voice call a conversation rather than a
// walkie-talkie. Luna.jsx owns the chat (sending messages); this hook owns
// the call around it:
//   - hands-free turns: after Luna finishes speaking the mic reopens on its
//     own (never while she is still audible — the mic would hear her); two
//     silent turns in a row pause it until the next tap
//   - your turn ends after a short silence, not at the first breath
//   - her voice: the reply is synthesized and played piece by piece
//     (lib/speechChunks.js, lib/voicePlayer.js), so she starts talking a few
//     seconds after her answer arrives, on one audio element that iOS lets
//     play without a tap; a piece the server's voice can't make is said in
//     the device's own voice (lib/browserVoice.js) instead of going silent
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

// One id per turn: the server counts the turn's speech recognition and every
// piece of the reply's voice as ONE voice use.
function newTurnId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function setPlaybackState(value) {
  try {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = value;
  } catch (_) {}
}

export function useVoiceCall({ lang, t, quotaMessage, speech, sending, sendTurn }) {
  const [active, setActive] = useState(false);     // screen mounted
  const [closing, setClosing] = useState(false);   // moonset running
  const [handsFree, setHandsFree] = useState(() => {
    try { return localStorage.getItem(HANDS_FREE_KEY) !== "0"; } catch (_) { return true; }
  });
  const [autoPaused, setAutoPaused] = useState(false); // hands-free waits for a tap
  const [playingId, setPlayingId] = useState(null);    // her voice is on (or between two pieces)
  const [pausedId, setPausedId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);    // waiting for the first piece of her voice
  const [analyser, setAnalyser] = useState(null);
  const [reply, setReply] = useState(null);            // {id, text} Luna's latest reply in this call
  // {id, kind, message}: her voice didn't come ("voice"), broke off halfway
  // ("cut"), or your turn never reached her ("turn").
  const [voiceFailed, setVoiceFailed] = useState(null);
  const [canReplay, setCanReplay] = useState(false);
  const [pendingText, setPendingText] = useState(""); // your finished phrases in this turn
  const [lastSent, setLastSent] = useState("");
  const [flareKey, setFlareKey] = useState(0);
  const [turnsSeen, setTurnsSeen] = useState(() => readNumber(TURNS_SEEN_KEY));
  const [handoff, setHandoff] = useState(false);         // the mic is about to reopen on its own
  const [sendingSoon, setSendingSoon] = useState(false); // your words are being finalized to send
  const [micCheck, setMicCheck] = useState("idle");      // "idle" | "retrying" | "failed" (see below)
  const [player] = useState(createVoicePlayer);          // her voice (lib/voicePlayer.js)

  const liveRef = useRef(false);
  const genRef = useRef(0);            // which call a reply belongs to (bumped on every open)
  const lastInterimRef = useRef("");   // words heard but not yet final, in case no final comes
  const lastReplyRef = useRef(null);   // {msg, turnId, pieces: [{text, url}]} kept for "Tekrar dinle"
  // Your turn: finished phrases, the silence timer, "send at the next final",
  // and its id (from the server recognizer's first phrase, if it made one).
  const turnRef = useRef({ parts: [], timer: null, flushOnFinal: false, turnId: null });
  const listenTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const silenceRef = useRef(0);
  const closeRef = useRef(() => {});

  // Latest values for callbacks that run later (timers, media events).
  const latest = useRef({});
  latest.current = { speech, sending, handsFree, autoPaused, lang, t, quotaMessage, sendTurn };

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

  // Lock screen / notification / headset controls (Chrome shows them for
  // clips of 5 s or more).
  const showMediaSession = useCallback(() => {
    const ms = navigator.mediaSession;
    if (!ms || !window.MediaMetadata) return;
    try {
      ms.metadata = new window.MediaMetadata({
        title: "Luna",
        artist: latest.current.t("Sesli görüşme", "Voice call"),
        artwork: [{ src: `${process.env.PUBLIC_URL || ""}/icon-512.png`, sizes: "512x512", type: "image/png" }],
      });
      ms.setActionHandler("play", () => player.resume());
      ms.setActionHandler("pause", () => player.pause());
      ms.setActionHandler("stop", () => closeRef.current());
    } catch (_) {}
  }, [player]);

  // Luna stops for good (interrupted, "Bunun yerine konuş", a newer reply,
  // hanging up): pieces still on their way are cancelled. The ones that
  // arrived stay with the reply for "Tekrar dinle" (forgetLastReply frees them).
  const stopSpeaking = useCallback(() => {
    player.stop();
    setPlayingId(null);
    setPausedId(null);
    setLoadingId(null);
    setPlaybackState("none");
  }, [player]);

  const forgetLastReply = useCallback(() => {
    lastReplyRef.current?.pieces.forEach((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      p.url = null;
    });
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
    turnRef.current = { parts: [], timer: null, flushOnFinal: false, turnId: null };
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
  // cancellation and would send her own words back as yours. Nor while your
  // last words are still being transcribed (the fallback recognizer).
  const canAutoListen = useCallback(() => {
    const { speech: sp, sending: busy, handsFree: hf, autoPaused: paused } = latest.current;
    return liveRef.current && hf && !paused && sp.supported && !sp.error && !sp.listening && !sp.transcribing
      && !busy && !player.active() && document.visibilityState === "visible";
  }, [player]);

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

  // A silent turn: listen once more, after the second one wait for a tap.
  const noteSilence = useCallback(() => {
    silenceRef.current += 1;
    if (silenceRef.current < 2) listenNext(300);
    else setAutoPaused(true);
  }, [listenNext]);

  // ---------------------------------------------------------------- playback
  // Speak a reply ({msg, turnId, pieces}) — a new one, or "Tekrar dinle".
  const speak = useCallback((r) => {
    const { msg } = r;
    // Luna is about to speak: the mic must be closed (and any half turn
    // dropped) before a single word of hers comes out of the speaker. The
    // fallback recognizer also holds its mic for a few seconds between turns
    // — let that go now too: a held mic puts phones in their quieter call
    // audio mode, and shows the mic indicator while she talks.
    cancelListenTimer();
    const sp = latest.current.speech;
    if (sp.listening || (sp.engine === "recorder" && !sp.transcribing)) sp.abort();
    clearTurn();
    setVoiceFailed(null);
    setPausedId(null);
    // "thinking" until her first piece is there ("Tekrar dinle" has it
    // already — or the device says it again, see lib/voicePlayer.js).
    const firstReady = !!(r.pieces[0]?.url || r.pieces[0]?.synth);
    setPlayingId(firstReady ? msg.id : null);
    setLoadingId(firstReady ? null : msg.id);
    let heard = false; // has any of it been audible yet
    player.speak({
      pieces: r.pieces,
      fetchPiece: (i, signal) => fetchTTS({ text: r.pieces[i].text, turnId: r.turnId, part: i, signal }),
      // The device's voice, for a piece the server's couldn't make.
      lang: latest.current.lang === "tr" ? "tr-TR" : "en-US",
      onPieceReady: (i) => {
        if (i === 0 && lastReplyRef.current === r) setCanReplay(true);
      },
      onPlaying: () => {
        if (!heard) showMediaSession();
        heard = true;
        setLoadingId(null);
        setPausedId(null);
        setPlayingId(msg.id);
        setAnalyser(player.analyser()); // (none for a piece in the device's voice)
        setPlaybackState("playing");
      },
      // A pause the app didn't make (another app took the audio, a headset
      // button), or the browser wants a tap before it plays: show "Devam et"
      // instead of pretending she's still talking.
      onPaused: () => {
        setLoadingId(null);
        setPlayingId(null);
        setPausedId(msg.id);
        setPlaybackState("paused");
      },
      // Only after her LAST piece does the mic reopen.
      onDone: () => {
        setPlayingId(null);
        setPausedId(null);
        silenceRef.current = 0;
        setPlaybackState("none");
        listenNext(micDelayAfterSpeechMs(), { cue: true });
      },
      onFailed: (_index, error) => {
        setLoadingId(null);
        setPlayingId(null);
        setPausedId(null);
        setPlaybackState("none");
        if (!liveRef.current) return;
        const { quotaMessage: qm, t: tr } = latest.current;
        setVoiceFailed(heard
          ? { id: msg.id, kind: "cut", message: tr("Sesim yarıda kesildi, cevabımın tamamı burada.", "My voice cut off, so here's my whole answer.") }
          : { id: msg.id, kind: "voice", message: qm(error) || tr("Sesim şu an gelmedi, cevabımı yazdım.", "My voice didn't come through, so here's my answer.") });
      },
    });
  }, [player, cancelListenTimer, clearTurn, listenNext, showMediaSession]);

  // Which call is open now — Luna.jsx reads it when a turn is sent and
  // hands it back with the reply, so a reply to an earlier call is ignored.
  const generation = useCallback(() => genRef.current, []);

  // Luna.jsx calls this with each reply that arrives while the call is live.
  // turnId: the turn it answers (its voice counts as that turn).
  const onReply = useCallback((msg, gen, turnId) => {
    if (!liveRef.current || gen !== genRef.current) return;
    stopSpeaking();     // a newer reply replaces anything still being said
    forgetLastReply();  // "Tekrar dinle" must always belong to this reply
    setReply({ id: msg.id, text: msg.text });
    setVoiceFailed(null);
    // (No falling back to the raw text when nothing speakable is left — a
    // reply of only a link or an emoji: the server strips the same things
    // and refuses the empty rest, so it would end as "Sesim şu an gelmedi".)
    const texts = toSpeechPieces(toSpoken(msg.text));
    if (!texts.length) {
      // Nothing to say: hands-free carries on — once this turn has finished
      // sending (Luna.jsx clears `sending` right after this returns). The
      // screen says "Mikrofon açılıyor" meanwhile, not idle for a moment.
      cancelListenTimer();
      const { handsFree: hf, autoPaused: paused } = latest.current;
      if (hf && !paused) setHandoff(true);
      listenTimerRef.current = setTimeout(() => listenNext(0), 300);
      return;
    }
    const r = { msg, turnId: turnId || newTurnId(), pieces: texts.map((text) => ({ text, url: null })) };
    lastReplyRef.current = r;
    speak(r);
  }, [stopSpeaking, forgetLastReply, speak, listenNext, cancelListenTimer]);

  // Luna.jsx calls this when a turn sent from the call failed (network, a
  // usage limit). Returns true when the call showed it (no toast needed).
  const onTurnFailed = useCallback((error, gen) => {
    if (!liveRef.current || gen !== genRef.current) return false;
    cancelListenTimer();
    clearTurn();
    setAutoPaused(true); // no hands-free loop on errors: wait for a tap
    const { quotaMessage: qm, t: tr } = latest.current;
    setVoiceFailed({
      id: null,
      kind: "turn",
      message: qm(error) || tr("Mesajın gitmedi, bağlantını kontrol edip tekrar dene.", "Your message didn't go through. Check your connection and try again."),
    });
    return true;
  }, [cancelListenTimer, clearTurn]);

  // ---------------------------------------------------------------- your turn
  const flushTurn = useCallback(() => {
    const turn = turnRef.current;
    clearTimeout(turn.timer);
    const { sending: busy, speech: sp } = latest.current;
    if (busy || sp.transcribing) {
      // The previous turn is still on its way, or your last words are still
      // being transcribed — send this one right after.
      turn.timer = setTimeout(() => flushTurnRef.current(), busy ? 400 : 250);
      return;
    }
    const text = turn.parts.join(" ").replace(/\s+/g, " ").trim();
    const turnId = turn.turnId || newTurnId();
    turnRef.current = { parts: [], timer: null, flushOnFinal: false, turnId: null };
    lastInterimRef.current = "";
    setPendingText("");
    setSendingSoon(false);
    if (!text || !liveRef.current) return;
    if (sp.listening) sp.stop();
    silenceRef.current = 0;
    setAutoPaused(false); // you're talking — hands-free carries on after her reply
    setLastSent(text);
    setVoiceFailed(null);
    setFlareKey((k) => k + 1);
    setTurnsSeen((n) => {
      const next = n + 1;
      try { localStorage.setItem(TURNS_SEEN_KEY, String(next)); } catch (_) {}
      return next;
    });
    latest.current.sendTurn(text, { turnId });
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
  // it (otherwise the chat composer handles it as before). meta.turnId: the
  // phrase was transcribed by the server (the fallback recognizer) under
  // that id — the turn keeps the first one, so its reply's voice counts as
  // the same use.
  const handleFinal = useCallback((text, meta) => {
    if (!liveRef.current) return false;
    const turn = turnRef.current;
    const sp = latest.current.speech;
    const fromServer = !!meta?.turnId;
    lastInterimRef.current = "";
    if (!text) {
      // The server heard nothing in that recording: a silent turn.
      if (fromServer && !turn.parts.length && !turn.flushOnFinal && !sp.listening) noteSilence();
      else if (turn.flushOnFinal) flushTurn();
      return true;
    }
    if (fromServer && !turn.turnId) turn.turnId = meta.turnId;
    turn.parts.push(text);
    setPendingText(turn.parts.join(" "));
    silenceRef.current = 0;
    // A server-transcribed phrase whose recording is over has had its
    // silence already — send now.
    if (turn.flushOnFinal || (fromServer && !sp.listening)) flushTurn();
    else armEndpoint();
    return true;
  }, [flushTurn, armEndpoint, noteSilence]);

  // Still talking (new interim words) — keep the turn open.
  useEffect(() => {
    if (!liveRef.current || !speech.interim) return;
    lastInterimRef.current = speech.interim;
    if (turnRef.current.parts.length && !turnRef.current.flushOnFinal) armEndpoint();
  }, [speech.interim, armEndpoint]);

  // Your words are being transcribed on the server: the screen says
  // "thinking" — with this turn's words so far, never the previous turn's.
  useEffect(() => {
    if (liveRef.current && speech.transcribing) setLastSent(turnRef.current.parts.join(" "));
  }, [speech.transcribing]);

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
    if (info.noSpeech || !info.heard) noteSilence();
  }, [flushTurn, noteSilence]);

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
  // (Luna's voice is left alone: with the screen off she may finish her
  // answer — the lock-screen controls are for that — and if the system
  // pauses her or won't play the next piece, the call shows "Devam et". A
  // piece in the device's voice stops there and waits for "Devam et" —
  // lib/voicePlayer.js.)
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
    stopSpeaking();
    forgetLastReply();
    player.release(); // the element and its audio graph go with the call
    clearMediaSession();
    setAnalyser(null);
    setClosing(true);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setActive(false);
      setClosing(false);
    }, prefersReducedMotion() ? 0 : CLOSE_ANIMATION_MS);
  }, [player, stopSpeaking, cancelListenTimer, clearTurn, forgetLastReply, clearMediaSession]);

  // Every way out goes through history, so Android Back and the on-screen
  // buttons share one path and no stray history entry is left behind.
  const close = useCallback(() => {
    if (window.history.state?.lunaCall) window.history.back();
    else teardown();
  }, [teardown]);
  closeRef.current = close;

  useEffect(() => {
    // A reload on the call's history entry must not leave its marker behind.
    if (window.history.state?.lunaCall) {
      const { lunaCall, ...rest } = window.history.state;
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
    primeVoiceAudio(); // inside the tap: lets audio (and its visuals) run…
    player.unlock();   // …and her voice play later without a tap (iOS)
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
  }, [player, startListening, clearTurn]);

  useEffect(() => () => {
    clearTimeout(closeTimerRef.current);
    clearTimeout(listenTimerRef.current);
    clearTimeout(turnRef.current.timer);
    player.release();
    forgetLastReply();
  }, [player, forgetLastReply]);

  // ---------------------------------------------------------------- controls
  // A "not-allowed" we're still quietly retrying is not an error yet.
  const micRetrying = speech.error === "not-allowed" && micCheck !== "failed";
  const state = (() => {
    if (!speech.supported) return "error";
    if (speech.error && !speech.listening && !micRetrying) return "error";
    if (speech.listening || handoff || micRetrying) return "listening";
    // (finalizing alone — "Durdur" with nothing heard — is not "thinking")
    if (sending || sendingSoon || speech.transcribing || (loadingId && loadingId === reply?.id)) return "thinking";
    if (pausedId) return "paused";
    if (playingId) return "speaking";
    if (voiceFailed) return "readout";
    return "idle";
  })();

  // Her reply arrived and only her voice is still loading (see mainAction).
  const canSkipVoice = state === "thinking" && !sending && !!loadingId && loadingId === reply?.id;

  const mainAction = useCallback(() => {
    primeVoiceAudio();
    const sp = latest.current.speech;
    setAutoPaused(false);
    silenceRef.current = 0;
    if (state === "thinking") {
      // Her answer is here but her voice is still on its way: a tap shows it
      // as text right away instead of waiting (a slow or stuck voice must
      // never trap the call in "thinking").
      if (canSkipVoice) {
        stopSpeaking();
        setVoiceFailed({ id: reply.id, kind: "skipped", message: latest.current.t("Sesimi beklemeden cevabımı yazdım.", "Here's my answer without waiting for my voice.") });
      }
      return;
    }
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
      player.resume(); // inside the tap, so the browser lets her play
      return;
    }
    setVoiceFailed(null);
    if (state === "speaking") {
      // Interrupt: Luna stops, you talk — after the same short wait as when
      // she finishes, so the mic doesn't catch the tail of her voice still in
      // the output (Bluetooth speakers lag noticeably).
      stopSpeaking();
      cancelListenTimer();
      setHandoff(true);
      listenTimerRef.current = setTimeout(() => {
        if (liveRef.current) startListening();
        else setHandoff(false);
      }, micDelayAfterSpeechMs());
      return;
    }
    startListening();
  }, [state, canSkipVoice, reply, player, stopSpeaking, flushTurn, finishTurn, startListening, cancelListenTimer]);

  // Paused: talk instead of resuming.
  const talkInstead = useCallback(() => {
    primeVoiceAudio();
    stopSpeaking();
    setAutoPaused(false);
    startListening();
  }, [stopSpeaking, startListening]);

  const replay = useCallback(() => {
    primeVoiceAudio();
    const last = lastReplyRef.current;
    if (!last || !liveRef.current) return;
    // (Pieces that never arrived are fetched again, same turn; the ones the
    // device said, it says again.)
    speak(last);
  }, [speak]);

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

  // For the captions: how much of the reply she has said (0..1, all pieces).
  const speechProgress = useCallback(() => player.progress(), [player]);

  return {
    active,
    closing,
    isLive: () => liveRef.current,
    generation,
    open,
    close,
    onReply,
    onTurnFailed,
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
      turnFailed: voiceFailed?.kind === "turn",
      canSkipVoice,
      canReplay,
      handsFree,
      autoPaused,
      coach: turnsSeen < 2,
      speechProgress,
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
