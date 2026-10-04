import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTTS, fetchTTSStream, getReplyLang } from "@/lib/api";
import { primeVoiceAudio, micDelayAfterSpeechMs, playTurnCue } from "@/lib/voiceAudio";
import { createVoicePlayer } from "@/lib/voicePlayer";
import { createVoiceFiller, preloadFillers } from "@/lib/voiceFiller";
import { toSpoken } from "@/lib/spokenText";
import { createSpeechCutter } from "@/lib/speechChunks";

// Everything that makes the voice call a conversation rather than a
// walkie-talkie. Luna.jsx owns the chat (sending messages); this hook owns
// the call around it:
//   - hands-free turns: after Luna finishes speaking the mic reopens on its
//     own (never while she is still audible — the mic would hear her); two
//     silent turns in a row pause it until the next tap
//   - your turn ends after a short silence, not at the first breath
//   - her voice: the reply streams in (Luna.jsx -> onReplyStart,
//     onReplyDelta, onReply) and is cut into pieces as it comes
//     (lib/speechChunks.js); each is synthesized and played in order
//     (lib/voicePlayer.js) — her first sentence goes to the voice before the
//     rest of the reply is even written. One audio element that iOS lets
//     play without a tap; a piece the server's voice can't make is said in
//     the device's own voice (lib/browserVoice.js) instead of going silent
//   - while her reply is slow to come, a short "hmm, bakalım" in her voice
//     (lib/voiceFiller.js) — now and then, never over her reply or the mic
//   - playback: live level for the visuals, resume after an outside pause,
//     replay of the last reply, and the reply as text if her voice fails
//   - phone behaviour: Android Back ends the call, lock-screen/headset
//     controls, a short "moonset" before the screen closes

// The silence that ends your turn. After a final phrase the recognizer has
// already waited out a pause of its own (~0.4-0.8 s) before giving it, so
// only a short one more; while words are still only half-recognised (an
// interim), the longer one — you may just be catching your breath. (Launch
// audit 2026-10-03: 850 ms after a final too meant ≈ 1.25-1.65 s of silence
// before your turn went, on desktop and iOS.) The short one ends by asking
// the recognizer for words it may still hold unshown (see armEndpoint), and
// the turn goes ENDPOINT_MS after the final at the latest, as before.
const ENDPOINT_AFTER_FINAL_MS = 550;
const ENDPOINT_MS = 850;
const CLOSE_ANIMATION_MS = 460;  // matches moonScene exit() / .call-exit
// Her "hmm" (lib/voiceFiller.js): when nothing of her reply can be heard yet
// this long after your turn went, she says one — on about 3 turns in 4, never
// on two turns in a row. Once her reply's first piece is ready to play, a
// "hmm" still sounding fades out, and her first word follows after a breath.
const FILLER_DELAY_MS = 650;
const FILLER_CHANCE = 0.75;
const FILLER_GAP_MS = 120;
const HANDS_FREE_KEY = "luna_call_handsfree";
const TURNS_SEEN_KEY = "luna_call_turns_seen";
const isAndroid = /Android/i.test(navigator.userAgent);
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function readNumber(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch (_) { return 0; }
}

// Your turn so far: its finished phrases, the silence timer (or, while its
// last words are asked for, the latest it goes — see finishTurn), "send at
// the next final", its id (from the server recognizer's first phrase, if it
// made one), and held: it is ready to go but waits for the previous turn or
// a transcription to finish (see flushTurn).
function newTurn() {
  return { parts: [], timer: null, flushOnFinal: false, turnId: null, held: false };
}

// Nothing sends the turn on its own any more: no silence timer, no hold.
function unschedule(turn) {
  clearTimeout(turn.timer);
  turn.timer = null;
  turn.held = false;
}

// One id per turn: the server counts the turn's speech recognition and every
// piece of the reply's voice as ONE voice use.
function newTurnId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// A reply to be said in the call (msg: {id, text}; gen: the call it belongs
// to). open: more of it is still streaming in. Its pieces are cut as its
// text comes (lib/speechChunks.js); started: her voice has begun; cutOff:
// you interrupted her while it was still streaming in.
function newReply(msg, gen, turnId, open) {
  return { msg, gen, turnId: turnId || newTurnId(), pieces: [], cutter: createSpeechCutter(), open, started: false, cutOff: false };
}

// The language she answers in (the reply language chosen in Settings, else
// the interface's) — her fillers are in that one, when there are any.
function replyLang(lang) {
  return getReplyLang() || lang;
}

function setPlaybackState(value) {
  try {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = value;
  } catch (_) {}
}

// fillerChance: the odds of her "hmm" on a turn — the app leaves it at
// FILLER_CHANCE; only tests pin it (1: every turn that may have one, 0: never).
export function useVoiceCall({ lang, t, quotaMessage, speech, sending, sendTurn, fillerChance = FILLER_CHANCE }) {
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
  const [filler] = useState(createVoiceFiller);          // her "hmm" (lib/voiceFiller.js)

  const liveRef = useRef(false);
  const genRef = useRef(0);            // which call a reply belongs to (bumped on every open)
  const lastInterimRef = useRef("");   // words heard but not yet final, in case no final comes
  // The reply being said, kept for "Tekrar dinle": {msg, turnId, gen,
  // pieces: [{text, url, synth}], cutter, open (still streaming in),
  // started (her voice has begun)} — see newReply.
  const lastReplyRef = useRef(null);
  const streamRef = useRef(null);      // ...while it is still streaming in
  // The turn on its way to Luna (sendTurn's signal): hanging up, or cutting
  // her off while her reply still streams in, lets it go — a request left
  // running would keep the turn "sending" (no mic, "thinking") until it ends.
  const turnCtlRef = useRef(null);
  const replyLenRef = useRef(0);       // its spoken length so far (captions' progress)
  const turnRef = useRef(newTurn());   // your turn (see newTurn)
  const listenTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const silenceRef = useRef(0);
  const closeRef = useRef(() => {});
  // Her "hmm": the timer that may start one for the turn just sent, and
  // which turns of this call were sent / had one (never two in a row).
  const fillerTimerRef = useRef(null);
  const fillerTurnsRef = useRef({ sent: 0, lastWith: -2 });
  const stateRef = useRef("idle"); // the screen's state (see `state`) as last rendered

  // Latest values for callbacks that run later (timers, media events).
  const latest = useRef({});
  latest.current = { speech, sending, handsFree, autoPaused, lang, t, quotaMessage, sendTurn, voiceFailed, fillerChance };

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

  // You cut her off while the rest of her reply is still streaming in: the
  // stream is let go (Luna.jsx then reports the turn as failed, which for a
  // reply you cut off is no error — see onTurnFailed), so your next turn
  // never waits for an answer you no longer want.
  const cutOffStream = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.cutOff = true;
    turnCtlRef.current?.abort();
  }, []);

  // Her "hmm" stops at once (a short fade), and one about to start doesn't:
  // you interrupted, hung up, left the page, the turn or her voice failed —
  // or her reply's first piece is ready to play (see speak()). (Not when her
  // reply merely begins to stream in: until that piece's audio is there, the
  // "hmm" goes on.)
  const stopFiller = useCallback(() => {
    clearTimeout(fillerTimerRef.current);
    fillerTimerRef.current = null;
    filler.stop();
  }, [filler]);

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
    unschedule(turnRef.current);
    turnRef.current = newTurn();
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

  // Never while Luna is audible or about to be (her "hmm" included): the mic
  // has no echo cancellation and would send her own words back as yours. Nor
  // while your last words are still being transcribed (the fallback
  // recognizer).
  const canAutoListen = useCallback(() => {
    const { speech: sp, sending: busy, handsFree: hf, autoPaused: paused } = latest.current;
    return liveRef.current && hf && !paused && sp.supported && !sp.error && !sp.listening && !sp.transcribing
      && !busy && !player.active() && !filler.audible() && document.visibilityState === "visible";
  }, [player, filler]);

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
    r.started = true;
    player.speak({
      pieces: r.pieces,
      open: r.open, // still streaming in: more pieces follow (see addPieces)
      fetchPiece: (i, signal) => fetchTTS({ text: r.pieces[i].text, turnId: r.turnId, part: i, signal }),
      // Streamed audio where it plays through Web Audio (voicePlayer decides;
      // iOS and browsers without streaming fetch keep fetchPiece): her first
      // sound ~0.6 s after the request instead of after the whole piece.
      fetchStream: (i, signal) => fetchTTSStream({ text: r.pieces[i].text, turnId: r.turnId, part: i, signal }),
      // Her first piece never starts over her "hmm": it waits until that is
      // over, plus a breath (until then the screen still says "thinking").
      before: () => filler.whenDone(FILLER_GAP_MS),
      // The device's voice, for a piece the server's couldn't make.
      lang: latest.current.lang === "tr" ? "tr-TR" : "en-US",
      onPieceReady: (i) => {
        if (i !== 0) return;
        if (lastReplyRef.current === r) setCanReplay(true);
        // Her answer can be heard now: a "hmm" still sounding fades out
        // (~60 ms) instead of her first word waiting for its end — launch
        // audit 2026-10-03 (a cached piece or an instant reply is there
        // while the clip still has most of a second to go).
        stopFiller();
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
      // Only after her LAST piece does the mic reopen. (If that was the
      // moment her reply completed, its turn is still finishing — Luna.jsx
      // clears `sending` right after: hands-free goes on a moment later.)
      onDone: () => {
        setPlayingId(null);
        setPausedId(null);
        silenceRef.current = 0;
        setPlaybackState("none");
        const go = () => listenNext(micDelayAfterSpeechMs(), { cue: true });
        if (!latest.current.sending) {
          go();
          return;
        }
        cancelListenTimer();
        listenTimerRef.current = setTimeout(go, 300);
      },
      onFailed: (_index, error) => {
        stopFiller(); // (her answer is read out now)
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
  }, [player, filler, cancelListenTimer, clearTurn, listenNext, showMediaSession, stopFiller]);

  // Which call is open now — Luna.jsx reads it when a turn is sent and
  // hands it back with the reply, so a reply to an earlier call is ignored.
  const generation = useCallback(() => genRef.current, []);

  // Her reply as the captions and the readout show it (it grows while it
  // streams in). spoken: its spoken text, when already at hand.
  const showReply = useCallback((id, text, spoken = toSpoken(text)) => {
    setReply({ id, text });
    replyLenRef.current = spoken.length;
  }, []);

  // More of a reply's pieces were cut (done: and that was the last of them).
  // Her voice starts with the first; later ones join the reply being said —
  // unless it isn't any more (interrupted, her voice failed): then they are
  // only kept for "Tekrar dinle".
  const addPieces = useCallback((r, texts, done) => {
    texts.forEach((text) => r.pieces.push({ text, url: null }));
    if (done) r.open = false;
    if (r.started) player.grow(r.pieces, { done });
    else if (r.pieces.length) speak(r);
  }, [player, speak]);

  // Luna.jsx: her reply to a turn spoken in this call has begun to stream
  // in — onReplyDelta brings it bit by bit, onReply whole at the end.
  const onReplyStart = useCallback((gen, turnId) => {
    if (!liveRef.current || gen !== genRef.current) return;
    stopSpeaking();     // a newer reply replaces anything still being said
    forgetLastReply();  // "Tekrar dinle" must always belong to this reply
    const r = newReply({ id: `l-call-${Date.now()}`, text: "" }, gen, turnId, true);
    streamRef.current = r;
    lastReplyRef.current = r;
    setVoiceFailed(null);
    showReply(r.msg.id, "", "");
  }, [stopSpeaking, forgetLastReply, showReply]);

  // Luna.jsx: the next bit of the reply that is streaming in. Her voice
  // starts as soon as its first piece can be cut (lib/speechChunks.js).
  const onReplyDelta = useCallback((text, gen) => {
    const r = streamRef.current;
    if (!liveRef.current || !r || r.gen !== gen || gen !== genRef.current || !text) return;
    r.msg = { ...r.msg, text: r.msg.text + text };
    const spoken = toSpoken(r.msg.text);
    showReply(r.msg.id, r.msg.text, spoken);
    addPieces(r, r.cutter.update(spoken, false), false);
  }, [showReply, addPieces]);

  // Luna.jsx calls this with each reply that arrives while the call is live.
  // turnId: the turn it answers (its voice counts as that turn). The reply
  // that streamed in is finished from its final text (a difference from the
  // streamed bits is reconciled — a word already cut is never said again);
  // one that came whole is cut and said from its start.
  const onReply = useCallback((msg, gen, turnId) => {
    if (!liveRef.current || gen !== genRef.current) return;
    let r = streamRef.current;
    streamRef.current = null;
    if (!r || r.gen !== gen || (turnId && r.turnId !== turnId)) {
      stopSpeaking();
      forgetLastReply();
      setVoiceFailed(null);
      r = newReply(msg, gen, turnId, true);
      lastReplyRef.current = r;
    }
    r.msg = { ...msg, id: r.msg.id };
    const spoken = toSpoken(msg.text);
    showReply(r.msg.id, msg.text, spoken);
    // (No falling back to the raw text when nothing speakable is left — a
    // reply of only a link or an emoji: the server strips the same things
    // and refuses the empty rest, so it would end as "Sesim şu an gelmedi".)
    const texts = r.cutter.update(spoken, true);
    if (r.started || texts.length) {
      addPieces(r, texts, true);
      return;
    }
    // Nothing to say: hands-free carries on — once this turn has finished
    // sending (Luna.jsx clears `sending` right after this returns). The
    // screen says "Mikrofon açılıyor" meanwhile, not idle for a moment.
    // (A "hmm" still sounding stops: no answer follows it — and the mic
    // then waits for its tail to leave the speaker, as after her voice.)
    r.open = false;
    const afterFiller = filler.audible();
    stopFiller();
    cancelListenTimer();
    const { handsFree: hf, autoPaused: paused } = latest.current;
    if (hf && !paused) setHandoff(true);
    listenTimerRef.current = setTimeout(() => listenNext(afterFiller ? micDelayAfterSpeechMs() : 0), 300);
  }, [stopSpeaking, forgetLastReply, showReply, addPieces, listenNext, cancelListenTimer, stopFiller, filler]);

  // Luna.jsx calls this when a turn sent from the call failed (network, a
  // usage limit) — also when her reply broke off while streaming in: what
  // she said of it stops and is dropped (it was no whole answer). Returns
  // true when the call showed it (no toast needed).
  const onTurnFailed = useCallback((error, gen) => {
    if (!liveRef.current || gen !== genRef.current) return false;
    stopFiller();
    const broken = streamRef.current;
    const brokeOff = !!broken;
    if (brokeOff) {
      streamRef.current = null;
      stopSpeaking();
      forgetLastReply();
      setReply(null);
      replyLenRef.current = 0;
      // You had cut her off and are talking already (or the mic is about to
      // open for you): that answer was given up anyway. No error, and your
      // new turn goes on.
      if (broken.cutOff) return true;
    }
    cancelListenTimer();
    clearTurn();
    setAutoPaused(true); // no hands-free loop on errors: wait for a tap
    const { quotaMessage: qm, t: tr } = latest.current;
    setVoiceFailed({
      id: null,
      kind: "turn",
      message: qm(error) || (brokeOff
        ? tr("Bağlantı koptu, cevabım yarıda kaldı. Tekrar sorar mısın?", "The connection dropped and my answer broke off. Could you ask again?")
        : tr("Mesajın gitmedi, bağlantını kontrol edip tekrar dene.", "Your message didn't go through. Check your connection and try again.")),
    });
    return true;
  }, [cancelListenTimer, clearTurn, stopSpeaking, forgetLastReply, stopFiller]);

  // Your turn `turnId` was just sent: if FILLER_DELAY_MS later nothing of her
  // reply can be heard yet — no piece of it arrived, she isn't saying
  // anything, nothing failed, the screen still says "thinking" — she says a
  // "hmm" meanwhile (on about 3 turns in 4, never on two turns in a row).
  // A quick reply never gets one.
  const scheduleFiller = useCallback((turnId) => {
    clearTimeout(fillerTimerRef.current);
    const gen = genRef.current;
    const turns = fillerTurnsRef.current;
    turns.sent += 1;
    const turnNo = turns.sent;
    fillerTimerRef.current = setTimeout(() => {
      fillerTimerRef.current = null;
      const { speech: sp, voiceFailed: failed, lang: uiLang, fillerChance: odds } = latest.current;
      if (!liveRef.current || gen !== genRef.current || document.visibilityState !== "visible") return;
      if (stateRef.current !== "thinking" || failed || sp.listening) return;
      // (Her voice only ever begins with a piece that arrived.)
      const r = lastReplyRef.current;
      if (r && r.turnId === turnId && r.pieces.some((p) => p.url || p.synth)) return;
      if (turns.lastWith === turnNo - 1 || Math.random() >= odds) return;
      const lang = replyLang(uiLang);
      if (!filler.ready(lang)) {
        preloadFillers(lang); // (for a later turn: the language changed, or the clips failed to load)
        return;
      }
      // As when she speaks (see speak()): the fallback recognizer's mic,
      // held between turns, is let go first — a held mic puts phones in
      // their quieter call audio mode.
      if (sp.engine === "recorder" && !sp.transcribing) sp.abort();
      if (filler.play(lang)) turns.lastWith = turnNo;
    }, FILLER_DELAY_MS);
  }, [filler]);

  // ---------------------------------------------------------------- your turn
  const flushTurn = useCallback(() => {
    const turn = turnRef.current;
    unschedule(turn);
    const { sending: busy, speech: sp } = latest.current;
    if (busy || sp.transcribing) {
      // The previous turn is still on its way, or your last words are still
      // being transcribed — this one goes the moment that is over (the
      // effect below; launch audit 2026-10-03: it was re-checked every
      // 250-400 ms).
      turn.held = true;
      return;
    }
    const text = turn.parts.join(" ").replace(/\s+/g, " ").trim();
    const turnId = turn.turnId || newTurnId();
    turnRef.current = newTurn();
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
    const ctl = new window.AbortController();
    turnCtlRef.current = ctl;
    latest.current.sendTurn(text, { turnId, signal: ctl.signal });
    scheduleFiller(turnId);
  }, [scheduleFiller]);
  const flushTurnRef = useRef(flushTurn);
  flushTurnRef.current = flushTurn;

  // A held turn (see flushTurn) goes as soon as nothing holds it any more:
  // Luna.jsx clears `sending` (the previous turn — e.g. a reply you cut off
  // — is over), or the recognizer's transcription is in. (flushTurn checks
  // again and holds it once more if something else still does.)
  useEffect(() => {
    if (turnRef.current.held && !sending && !speech.transcribing) flushTurnRef.current();
  }, [sending, speech.transcribing]);

  // Ask the engine for its last words, then send them together with the
  // turn (handleFinal flushes; handleSpeechEnd covers "no final came").
  // waitMs: the turn goes after that long even if the engine hasn't
  // answered by then.
  const finishTurn = useCallback((waitMs) => {
    const turn = turnRef.current;
    unschedule(turn); // (a held turn waits for those words too)
    turn.flushOnFinal = true;
    if (waitMs) turn.timer = setTimeout(() => flushTurnRef.current(), waitMs);
    setSendingSoon(true);
    setLastSent([turn.parts.join(" "), lastInterimRef.current].filter(Boolean).join(" "));
    latest.current.speech.stop();
  }, []);

  // The silence timer: you stopped talking (ENDPOINT_AFTER_FINAL_MS after a
  // final phrase, ENDPOINT_MS while words are still coming). If a phrase is
  // still only half-recognised when it ends, finish it first instead of
  // sending without it. After a final, finish it anyway: Chrome can hand
  // over a final together with the first interim of your next words, and
  // only the final reaches us (useSpeechRecognition renders the interim as
  // ""), so the recognizer may still hold words we never saw — stop() makes
  // it give them now, and they join this turn rather than starting one her
  // reply would drop (review of launch audit 2026-10-03). Still ENDPOINT_MS
  // after the final at the latest. Not while the turn would be held (see
  // flushTurn): the mic stays open then, in case you go on. (You're talking
  // again: a held turn waits for this timer instead.)
  const armEndpoint = useCallback((afterFinal) => {
    const turn = turnRef.current;
    unschedule(turn);
    turn.timer = setTimeout(() => {
      const { speech: sp, sending: busy } = latest.current;
      if (sp.interim) finishTurn();
      else if (afterFinal && sp.listening && !busy && !sp.transcribing) finishTurn(ENDPOINT_MS - ENDPOINT_AFTER_FINAL_MS);
      else flushTurn();
    }, afterFinal ? ENDPOINT_AFTER_FINAL_MS : ENDPOINT_MS);
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
    else armEndpoint(true);
    return true;
  }, [flushTurn, armEndpoint, noteSilence]);

  // Still talking (new interim words) — keep the turn open.
  useEffect(() => {
    if (!liveRef.current || !speech.interim) return;
    lastInterimRef.current = speech.interim;
    if (turnRef.current.parts.length && !turnRef.current.flushOnFinal) armEndpoint(false);
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
        stopFiller(); // (her reply itself goes on, see above)
        if (latest.current.speech.listening) latest.current.speech.abort();
        clearTurn();
      } else {
        listenNext(400);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, listenNext, cancelListenTimer, clearTurn, stopFiller]);

  // ---------------------------------------------------------------- open / close
  const teardown = useCallback(() => {
    if (!liveRef.current) return;
    liveRef.current = false;
    streamRef.current = null;
    turnCtlRef.current?.abort(); // a turn still on its way is let go
    turnCtlRef.current = null;
    cancelListenTimer();
    clearTurn();
    latest.current.speech.abort();
    stopFiller();
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
  }, [player, stopSpeaking, cancelListenTimer, clearTurn, forgetLastReply, clearMediaSession, stopFiller]);

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
    preloadFillers(replyLang(latest.current.lang)); // her "hmm"s, ready before the first turn
    clearTimeout(closeTimerRef.current);
    if (sp.listening) sp.abort(); // the chat mic, if it was on
    sp.clearError();
    liveRef.current = true;
    genRef.current += 1;
    streamRef.current = null;
    silenceRef.current = 0;
    stopFiller();
    fillerTurnsRef.current = { sent: 0, lastWith: -2 };
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
  }, [player, startListening, clearTurn, stopFiller]);

  useEffect(() => () => {
    clearTimeout(closeTimerRef.current);
    clearTimeout(listenTimerRef.current);
    clearTimeout(turnRef.current.timer);
    stopFiller();
    player.release();
    forgetLastReply();
  }, [player, forgetLastReply, stopFiller]);

  // ---------------------------------------------------------------- controls
  // A "not-allowed" we're still quietly retrying is not an error yet.
  const micRetrying = speech.error === "not-allowed" && micCheck !== "failed";
  const state = (() => {
    if (!speech.supported) return "error";
    if (speech.error && !speech.listening && !micRetrying) return "error";
    if (speech.listening || handoff || micRetrying) return "listening";
    // (Before "thinking": she starts talking while the rest of her reply is
    // still streaming in — the turn is still `sending` then.)
    if (pausedId) return "paused";
    if (playingId) return "speaking";
    // (finalizing alone — "Durdur" with nothing heard — is not "thinking")
    if (sending || sendingSoon || speech.transcribing || (loadingId && loadingId === reply?.id)) return "thinking";
    if (voiceFailed) return "readout";
    return "idle";
  })();
  stateRef.current = state;

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
        stopFiller();
        stopSpeaking();
        setVoiceFailed({ id: reply.id, kind: "skipped", message: latest.current.t("Sesimi beklemeden cevabımı yazdım.", "Here's my answer without waiting for my voice.") });
      }
      return;
    }
    stopFiller();
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
        unschedule(turnRef.current);
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
      cutOffStream();
      cancelListenTimer();
      setHandoff(true);
      listenTimerRef.current = setTimeout(() => {
        if (liveRef.current) startListening();
        else setHandoff(false);
      }, micDelayAfterSpeechMs());
      return;
    }
    startListening();
  }, [state, canSkipVoice, reply, player, stopSpeaking, stopFiller, cutOffStream, flushTurn, finishTurn, startListening, cancelListenTimer]);

  // Paused: talk instead of resuming.
  const talkInstead = useCallback(() => {
    primeVoiceAudio();
    stopFiller();
    stopSpeaking();
    cutOffStream();
    setAutoPaused(false);
    startListening();
  }, [stopSpeaking, stopFiller, startListening, cutOffStream]);

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

  // For the captions: how much of the reply she has said (0..1 of its text
  // so far — it may still be growing).
  const speechProgress = useCallback(() => {
    const total = replyLenRef.current;
    return total ? Math.min(1, player.said() / total) : 0;
  }, [player]);

  return {
    active,
    closing,
    isLive: () => liveRef.current,
    generation,
    open,
    close,
    onReplyStart,
    onReplyDelta,
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
