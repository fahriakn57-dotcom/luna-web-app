import { attachAnalyser, isAudible, releaseAnalyser, resumeVoiceAudio } from "@/lib/voiceAudio";

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
//    at most two at a time — the first two as soon as the reply arrives, the
//    next whenever one is done — and played strictly in order, the first as
//    soon as it is there. If the next piece isn't there when one ends, the
//    player waits for it (the call still counts as speaking: no mic, no idle
//    flash). A failed piece is asked for once more before giving up; nothing
//    after a missing piece is said (it would skip words).
//
// The caller owns the reply's pieces ({text, url}) and their blob URLs —
// they are kept for "Tekrar dinle". The player fills in url as pieces arrive,
// and revokes only what arrives after it was stopped.

const IN_FLIGHT = 2;
const PIECE_TIMEOUT_MS = 25000; // a piece takes 2-11 s; a stuck request must not hang the call

// A network failure, a timeout or a server error may pass on a second try;
// a 4xx (a used-up quota, a bad request) won't.
function worthRetrying(error) {
  const status = error?.response?.status;
  return !status || status >= 500 || status === 408;
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

export function createVoicePlayer() {
  let el = null;
  let analyser = null;
  let run = null; // the reply being spoken (see speak()); null when she is silent
  let lastProgress = 0; // held after a reply ends, so captions never jump back before they go

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
    r.done += r.pieces[r.index].text.length;
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

  // Play the run's current piece, or wait for it.
  const play = (r) => {
    const s = r.st[r.index];
    if (s.status === "failed") {
      fail(r, s.error);
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

  const next = (r) => {
    r.index += 1;
    if (r.index >= r.pieces.length) {
      run = null;
      lastProgress = 1;
      r.on.onDone?.();
      return;
    }
    play(r);
  };

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
      pump(r);
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
      if (run) return; // she is speaking — it is unlocked already
      try {
        audio.src = silentClip();
        audio.play()?.catch?.(() => {});
      } catch (_) {}
    },

    // Speak a reply: pieces [{text, url}] (url set = already fetched, e.g.
    // "Tekrar dinle"), fetchPiece(index, signal) -> Promise<blob URL>, and
    // the callbacks onPieceReady(i), onPlaying(i), onPaused(), onDone(),
    // onFailed(i, error). Replaces whatever was being said.
    speak({ pieces, fetchPiece, ...on }) {
      halt();
      const r = {
        pieces,
        fetchPiece,
        on,
        st: pieces.map((p) => ({ status: p.url ? "ready" : "idle", tries: 0, ctl: null, error: null })),
        index: -1,      // the piece being played (or waited for)
        waiting: false, // ...waited for: it hasn't arrived yet
        paused: false,
        done: 0,        // characters of the pieces already said
        total: pieces.reduce((n, p) => n + p.text.length, 0),
        inFlight: 0,
        stopAt: Infinity, // a piece failed for good: nothing from it on is said
      };
      run = r;
      lastProgress = 0;
      pump(r);
      next(r); // (synchronously, so "Tekrar dinle" plays inside its tap)
    },

    stop: halt,

    // (Headset / lock-screen pause.) Between two pieces the element is
    // already quiet: the next piece is held instead of played on arrival.
    pause() {
      const r = run;
      if (!r || !el || r.paused) return;
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
      if (!r || r.index < 0 || !el) return;
      const wasPaused = r.paused;
      r.paused = false;
      if (r.waiting) {
        // Paused between two pieces, the next one still on its way: she is
        // "speaking" again and it plays when it arrives.
        if (wasPaused) r.on.onPlaying?.(r.index);
        return;
      }
      start(r);
    },

    active: () => !!run,
    analyser: () => analyser,

    // How much of the reply she has said, 0..1 (by characters; within a
    // piece by its playback time).
    progress() {
      const r = run;
      if (!r || !r.total) return lastProgress;
      let now = 0;
      if (r.index >= 0 && !r.waiting && el && el.duration && isFinite(el.duration)) {
        now = r.pieces[r.index].text.length * Math.min(1, el.currentTime / el.duration);
      }
      lastProgress = Math.min(1, (r.done + now) / r.total);
      return lastProgress;
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
