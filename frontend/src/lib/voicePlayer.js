import { attachAnalyser, isAudible, releaseAnalyser, resumeVoiceAudio } from "@/lib/voiceAudio";
import { browserVoiceSupported, sayWithBrowser, unlockBrowserVoice } from "@/lib/browserVoice";

// Luna's voice in a call (driven by hooks/useVoiceCall.js). Two jobs:
//
// 1. ONE <audio> element for the whole call. iOS Safari lets an element
//    play without a tap only once it has played from a tap — a new Audio()
//    per reply, played after a network request, is refused there. unlock()
//    plays a blip of silence on it while the call is being opened (a tap);
//    every piece of every reply then reuses it by switching its src. Its
//    analyser for the visuals is attached once too (lib/voiceAudio.js).
//
// 2. A reply spoken piece by piece (lib/speechChunks.js): pieces are fetched
//    at most two at a time — each as soon as it is there and a request is
//    free — and played strictly in order, the first as soon as it is there.
//    The reply may still be streaming in when she starts (speak() with
//    open: true): grow() hands over the pieces cut since, and that no more
//    will come. If the next piece isn't there when one ends — not fetched
//    yet, or not even cut yet — the player waits for it (the call still
//    counts as speaking: no mic, no idle flash). A dropped connection or a
//    gateway error is asked for once more (see worthRetrying). Her first
//    piece also waits for a "hmm" she may be saying meanwhile
//    (lib/voiceFiller.js) to be over — see held(); the call fades that out
//    as soon as the piece is ready (onPieceReady, hooks/useVoiceCall.js).
//
// 3. A piece the server's voice can't make — its TTS is busy (503
//    "tts_busy"), refuses the text (400), or still fails after the retry —
//    is said in the device's own voice instead (lib/browserVoice.js), and the
//    pieces after it keep coming from the server as usual. The call stays
//    "speaking" throughout; the visuals just have no live level for that
//    piece. Only the user's own usage limit (429) still ends her voice — the
//    call then reads the answer out with that message — and so does a device
//    that can't speak; nothing after a missing piece is said (it would skip
//    words).
//
// The caller owns the reply's pieces ({text, url, synth}) and their blob
// URLs — they are kept for "Tekrar dinle". The player fills in url as pieces
// arrive (or sets synth: said by the device, again on a replay), and revokes
// only what arrives after it was stopped.

const IN_FLIGHT = 2;
const PIECE_TIMEOUT_MS = 25000; // a piece takes 2-11 s; a stuck request must not hang the call

// A dropped connection or a gateway error (a proxy's 5xx page, the server
// restarting) may pass on a second try. Not a 4xx (the same text would be
// refused again), not when the server says when to come back (its TTS is
// busy for a while), not a piece that already took PIECE_TIMEOUT_MS, and not
// the server's own "voice failed" (a JSON detail): it has already retried
// the voice model itself or been refused for good — asking again would only
// spend more of the model's few requests per minute. The device says those
// right away.
function worthRetrying(error) {
  const res = error?.response;
  if (error?.name === "TimeoutError" || res?.headers?.["retry-after"]) return false;
  if (res?.data?.detail === "tts_busy") return false;
  const status = res?.status;
  if (!status) return true;
  if (status === 408) return true;
  return status >= 500 && !(res.data && typeof res.data === "object" && res.data.detail);
}

// Whether the device's voice says a piece the server's couldn't: anything
// but the user's own usage limit (a plan quota, or going too fast).
function deviceSays(error) {
  const busy = error?.response?.data?.detail === "tts_busy";
  return browserVoiceSupported() && (busy || error?.response?.status !== 429);
}

function speechError(code) {
  const e = new Error(`speech synthesis failed: ${code}`);
  e.name = "SpeechSynthesisError";
  e.code = code;
  return e;
}

// 0.1 s of silence (16-bit PCM WAV) for unlock(), made once. A blob URL like
// her voice itself, so it plays wherever her voice can.
let silentUrl = null;
function silentClip() {
  if (silentUrl) return silentUrl;
  const rate = 8000;
  const bytes = rate * 0.1 * 2;
  const buffer = new ArrayBuffer(44 + bytes); // the samples stay 0: silence
  const v = new DataView(buffer);
  const ascii = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);        // fmt chunk size
  v.setUint16(20, 1, true);         // PCM
  v.setUint16(22, 1, true);         // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);  // bytes per second
  v.setUint16(32, 2, true);         // bytes per frame
  v.setUint16(34, 16, true);        // bits per sample
  ascii(36, "data");
  v.setUint32(40, bytes, true);
  silentUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return silentUrl;
}

// A piece was said to its end: in the reply it is followed by a space (the
// pieces joined by single spaces are the reply's spoken text — see
// lib/speechChunks.js), so the reply's last word counts as its very end.
function pieceSaid(r, text) {
  r.done += text.length + 1;
}

export function createVoicePlayer() {
  let el = null;
  let analyser = null;
  let run = null; // the reply being spoken (see speak()); null when she is silent
  let lastSaid = 0; // held after a reply ends, so captions never jump back before they go

  // The run whose current piece the element is playing — media events of
  // anything else (the unlock blip, a piece that was switched away from, a
  // stopped reply) are ignored.
  const current = () => {
    const r = run;
    if (!r || !el || r.index < 0 || r.waiting) return null;
    const url = r.pieces[r.index]?.url;
    return url && el.src === url ? r : null;
  };

  const onPlaying = () => {
    const r = current();
    if (!r) return;
    r.paused = false;
    r.on.onPlaying?.(r.index);
  };
  // A pause the player didn't make: another app took the audio, a headset
  // button, the lock screen. (A piece that reached its end fires "pause"
  // too, right before "ended".)
  const onPause = () => {
    const r = current();
    if (!r || el.ended) return;
    r.paused = true;
    r.on.onPaused?.();
  };
  const onEnded = () => {
    const r = current();
    if (!r) return;
    pieceSaid(r, r.pieces[r.index].text);
    next(r);
  };
  const onError = () => {
    const r = current();
    if (r) fail(r, el.error);
  };

  const element = () => {
    if (el) return el;
    el = new Audio();
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return el;
  };

  // Stop the run for good: in-flight pieces are cancelled (whatever still
  // arrives is revoked, see fetchPiece).
  const halt = () => {
    const r = run;
    if (!r) return;
    run = null;
    hush(r, false);
    r.st.forEach((s) => {
      if (s.ctl) s.ctl.abort();
      s.ctl = null;
    });
    if (el && !el.paused) {
      try { el.pause(); } catch (_) {}
    }
  };

  const fail = (r, error) => {
    if (r !== run) return;
    const index = r.index;
    halt();
    r.on.onFailed?.(index, error);
  };

  // The browser wants a tap before it plays (or the audio graph's context
  // couldn't be restarted without one): the caller shows "Devam et".
  const block = (r) => {
    r.paused = true;
    r.on.onPaused?.();
  };

  const start = (r) => {
    const index = r.index;
    if (!isAudible(el)) {
      resumeVoiceAudio().then((ok) => {
        if (r !== run || r.index !== index) return;
        if (ok) start(r);
        else block(r);
      });
      return;
    }
    let playing;
    try {
      playing = el.play();
    } catch (e) {
      playing = Promise.reject(e);
    }
    playing?.catch?.((e) => {
      if (r !== run || r.index !== index) return;
      if (e?.name === "AbortError") return; // paused or switched before it began
      if (e?.name === "NotAllowedError") block(r);
      else fail(r, e);
    });
  };

  // ---- a piece in the device's voice
  // The page went to the background: the device's voice stops there (it
  // would be cut off anyway) and waits for "Devam et".
  let watchingPage = false;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hush(run, true);
  };
  const watchPage = (on) => {
    if (on === watchingPage) return;
    watchingPage = on;
    if (on) document.addEventListener("visibilitychange", onVisibility);
    else document.removeEventListener("visibilitychange", onVisibility);
  };

  // Stop the device's voice. hold: a pause — remember where it was, so
  // resume() goes on from that word, and show "Devam et".
  const hush = (r, hold) => {
    if (!r || !r.voice) return;
    const h = r.voice;
    r.voice = null;
    watchPage(false);
    if (hold) r.from = h.resumeAt();
    h.cancel();
    if (hold) block(r);
  };

  const say = (r) => {
    if (r.paused) return; // paused between two pieces: resume() starts it
    if (document.visibilityState === "hidden") {
      block(r);
      return;
    }
    const index = r.index;
    const text = r.pieces[index].text;
    let h = null;
    const mine = () => !!h && r === run && r.voice === h;
    try {
      h = sayWithBrowser(text, {
        lang: r.lang,
        from: r.from,
        onStart: () => {
          if (!mine()) return;
          r.paused = false;
          r.on.onPlaying?.(index);
        },
        onEnd: () => {
          if (!mine()) return;
          r.voice = null;
          watchPage(false);
          pieceSaid(r, text);
          next(r);
        },
        onError: (code) => {
          if (!mine()) return;
          r.voice = null;
          watchPage(false);
          // It wants a tap ("not-allowed"), or something else stopped it —
          // the system took the audio, the page is going away ("interrupted",
          // "canceled": the player's own cancels never get here): a pause,
          // "Devam et" goes on from the word it reached. Anything else: the
          // device can't say it — the reply is read out.
          if (code === "not-allowed" || code === "interrupted" || code === "canceled") {
            r.from = h.resumeAt();
            block(r);
          } else {
            fail(r, speechError(code));
          }
        },
      });
    } catch (_) {
      h = null;
    }
    if (!h) {
      fail(r, speechError("unsupported"));
      return;
    }
    r.voice = h;
    watchPage(true);
  };

  // Her first piece waits while something else of hers is still sounding
  // (a "hmm" said while the reply was on its way — r.before(), see speak()).
  // Returns whether it waits; once that is over, the piece plays (or is
  // waited for as usual). Later pieces never wait for it.
  const held = (r) => {
    if (r.gate) return true;
    const gate = r.before?.();
    if (!gate) return false;
    r.gate = gate;
    gate.then(() => {
      if (r.gate !== gate) return;
      r.gate = null;
      if (r === run && r.waiting && r.index === 0) play(r);
    });
    return true;
  };

  // Play the run's current piece, or wait for it.
  const play = (r) => {
    const s = r.st[r.index];
    if (s.status === "failed") {
      fail(r, s.error);
      return;
    }
    if (r.index === 0 && held(r)) {
      r.waiting = true;
      return;
    }
    if (s.status === "synth") {
      r.waiting = false;
      say(r);
      return;
    }
    if (s.status !== "ready") {
      r.waiting = true;
      return;
    }
    r.waiting = false;
    const audio = element();
    analyser = attachAnalyser(audio);
    audio.src = r.pieces[r.index].url;
    if (r.paused) return; // paused between two pieces: resume() starts it
    start(r);
  };

  // Her last word: the reply is complete and every piece of it was said.
  const finish = (r) => {
    run = null;
    lastSaid = r.done;
    r.on.onDone?.();
  };

  const next = (r) => {
    r.index += 1;
    r.from = 0;
    if (r.index >= r.st.length) {
      // The reply is still streaming in: wait for its next piece (grow()).
      if (r.open) r.waiting = true;
      else finish(r);
      return;
    }
    play(r);
  };

  const pieceState = (p, synth) => ({
    status: p.url ? "ready" : p.synth && synth ? "synth" : "idle",
    tries: 0,
    ctl: null,
    error: null,
  });

  const pump = (r) => {
    for (let i = 0; i < r.st.length && i < r.stopAt && r.inFlight < IN_FLIGHT; i++) {
      if (r.st[i].status === "idle") fetchPiece(r, i);
    }
  };

  const fetchPiece = (r, i) => {
    const s = r.st[i];
    const ctl = new window.AbortController();
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, PIECE_TIMEOUT_MS);
    s.status = "loading";
    s.tries += 1;
    s.ctl = ctl;
    r.inFlight += 1;
    // Once per request: when it answers, or the moment it is cancelled or
    // times out — a request still stuck before the network (the auth step)
    // never sees its signal, and must not leave the call waiting forever.
    // Returns whether the outcome is still wanted (not if the run was
    // stopped or this request cancelled).
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      r.inFlight -= 1;
      if (s.ctl === ctl) s.ctl = null;
      return r === run && (!ctl.signal.aborted || timedOut);
    };
    const failed = (error) => {
      if (!settle()) return;
      if (s.tries < 2 && worthRetrying(error)) {
        s.status = "idle";
      } else if (deviceSays(error)) {
        // The device says this piece; the ones after it keep coming.
        s.status = "synth";
        s.error = error;
        r.pieces[i].synth = true;
        r.on.onPieceReady?.(i);
        if (r.waiting && r.index === i) play(r);
      } else {
        s.status = "failed";
        s.error = error;
        r.stopAt = Math.min(r.stopAt, i);
        for (let j = i + 1; j < r.st.length; j++) {
          if (r.st[j].ctl) r.st[j].ctl.abort();
        }
        if (r.waiting && r.index === i) {
          fail(r, error);
          return;
        }
      }
      if (r === run) pump(r);
    };
    ctl.signal.addEventListener("abort", () => {
      const e = new Error(timedOut ? "timeout" : "canceled");
      e.name = timedOut ? "TimeoutError" : "AbortError";
      failed(e);
    });
    Promise.resolve()
      .then(() => r.fetchPiece(i, ctl.signal))
      .then((url) => {
        if (!settle()) {
          URL.revokeObjectURL(url);
          return;
        }
        r.pieces[i].url = url;
        s.status = "ready";
        r.on.onPieceReady?.(i);
        if (r === run && r.waiting && r.index === i) play(r);
        if (r === run) pump(r);
      }, failed);
  };

  return {
    // Inside a tap (opening the call): make the element and let it play
    // later without one.
    unlock() {
      const audio = element();
      unlockBrowserVoice();
      if (run) return; // she is speaking — it is unlocked already
      try {
        audio.src = silentClip();
        audio.play()?.catch?.(() => {});
      } catch (_) {}
    },

    // Speak a reply: pieces [{text, url, synth}] (url set = already fetched,
    // synth = said by the device last time, e.g. "Tekrar dinle"),
    // fetchPiece(index, signal) -> Promise<blob URL>, lang ("tr-TR" |
    // "en-US", for the device's voice), open (the reply is still streaming
    // in: more pieces come through grow()), before() -> a promise to wait
    // for before her first piece plays, or null (asked when that piece is
    // about to play), and the callbacks onPieceReady(i), onPlaying(i),
    // onPaused(), onDone(), onFailed(i, error). Replaces whatever was being
    // said.
    speak({ pieces, fetchPiece, lang, open = false, before = null, ...on }) {
      halt();
      const synth = browserVoiceSupported();
      const r = {
        pieces,
        fetchPiece,
        before,
        gate: null,       // ...what her first piece is waiting for (see held())
        on,
        lang: lang || "tr-TR",
        open,
        st: pieces.map((p) => pieceState(p, synth)),
        index: -1,      // the piece being played (or waited for)
        waiting: false, // ...waited for: it hasn't arrived yet
        paused: false,
        done: 0,        // characters of the reply already said (whole pieces)
        inFlight: 0,
        stopAt: Infinity, // a piece failed for good: nothing from it on is said
        voice: null,      // the device saying the current piece (lib/browserVoice.js)
        from: 0,          // ...from this character on (after a pause)
      };
      run = r;
      lastSaid = 0;
      pump(r);
      next(r); // (synchronously, so "Tekrar dinle" plays inside its tap)
    },

    // The reply given to speak() as `pieces` has more pieces now (the caller
    // added them to that same array), and/or (done) it is complete. Ignored
    // when that reply isn't being said any more (interrupted, stopped).
    grow(pieces, { done = false } = {}) {
      const r = run;
      if (!r || r.pieces !== pieces) return;
      const synth = browserVoiceSupported();
      for (let i = r.st.length; i < pieces.length; i++) r.st.push(pieceState(pieces[i], synth));
      if (done) r.open = false;
      pump(r);
      // She was waiting past the last piece: go on with the new one, or end.
      if (!r.waiting || r.index < 0) return;
      if (r.index < r.st.length) play(r);
      else if (!r.open) finish(r);
    },

    stop: halt,

    // (Headset / lock-screen pause.) Between two pieces the element is
    // already quiet: the next piece is held instead of played on arrival.
    pause() {
      const r = run;
      if (!r || r.paused) return;
      if (r.voice) {
        hush(r, true);
        return;
      }
      if (!el) return;
      if (!el.paused) {
        el.pause(); // its "pause" event reports it
      } else if (r.waiting && r.index > 0) {
        r.paused = true;
        r.on.onPaused?.();
      }
    },

    // After a pause (or a refused play): call it inside the tap.
    resume() {
      const r = run;
      if (!r || r.index < 0) return;
      const wasPaused = r.paused;
      r.paused = false;
      if (r.waiting) {
        // Paused between two pieces, the next one still on its way: she is
        // "speaking" again and it plays when it arrives.
        if (wasPaused) r.on.onPlaying?.(r.index);
        return;
      }
      if (r.st[r.index].status === "synth") {
        if (!r.voice) say(r); // from where it stopped
        return;
      }
      if (el) start(r);
    },

    active: () => !!run,
    // (None while the device says a piece: its voice can't be measured.)
    analyser: () => (run && run.index >= 0 && run.st[run.index]?.status === "synth" ? null : analyser),

    // How many characters of the reply's spoken text she has said (whole
    // pieces with the space after each; within a piece by its playback
    // time, or the device voice's word boundaries — up to one past the end
    // once all of it is said). The caller relates it to that text's length,
    // which may still be growing while the reply streams in.
    said() {
      const r = run;
      if (!r) return lastSaid;
      let now = 0;
      if (r.index >= 0 && r.index < r.st.length && !r.waiting) {
        if (r.voice) now = r.voice.position();
        else if (r.st[r.index].status === "synth") now = r.from;
        else if (el && el.duration && isFinite(el.duration)) {
          now = r.pieces[r.index].text.length * Math.min(1, el.currentTime / el.duration);
        }
      }
      // Never backwards within a reply: the device voice's first word
      // boundary can land a little behind its time estimate, and after a
      // pause it starts again from the beginning of the word it reached.
      lastSaid = Math.max(lastSaid, r.done + now);
      return lastSaid;
    },

    // The call ended: drop the element and its audio graph.
    release() {
      halt();
      if (!el) return;
      const audio = el;
      el = null;
      analyser = null;
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch (_) {}
      releaseAnalyser(audio);
    },
  };
}
