import {
  attachAnalyser, createPcmStream, isAudible, releaseAnalyser, resumeVoiceAudio, streamingVoiceSupported, voiceContext,
} from "@/lib/voiceAudio";
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
// 4. Where her voice goes through the audio graph anyway (not iOS — see
//    lib/voiceAudio.js) and a response can be read as it comes, a piece is
//    streamed (speak()'s fetchStream): raw PCM played as the server makes it
//    — her first word ~1 s sooner than a whole clip could arrive (launch
//    audit 2026-10-03). It is there ("ready") with its first audio, and in
//    flight until the rest has come; the whole clip then becomes its url (a
//    WAV), which "Tekrar dinle" plays from the element. A clip the server
//    had already (its cache) comes whole and plays from the element as
//    usual. A stream that breaks before any of it was heard is a failed
//    request like any other (see 2. and 3.); one that breaks while she says
//    it ends her voice, as a broken clip does. A server without the
//    streaming route: pieces are fetched whole from then on.
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

// A blob URL of 16-bit mono PCM (an ArrayBuffer of little-endian samples)
// as a WAV clip.
function wavUrl(pcm, rate) {
  const bytes = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
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
  return URL.createObjectURL(new Blob([header, pcm], { type: "audio/wav" }));
}

// 0.1 s of silence (16-bit PCM WAV) for unlock(), made once. A blob URL like
// her voice itself, so it plays wherever her voice can.
let silentUrl = null;
function silentClip() {
  const rate = 8000;
  if (!silentUrl) silentUrl = wavUrl(new ArrayBuffer((rate / 10) * 2), rate); // the samples stay 0: silence
  return silentUrl;
}

// How long a streamed piece will be, before all of it has come (for the
// captions — see said()). Measured on the server's voice (2026-10-03): 41
// characters 2.6-3.1 s, 127 characters 7.6-8.6 s.
const clipSeconds = (text) => 0.2 + 0.065 * text.length;

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
  let streamRoute = true; // ...until the server says it has no streaming route (see 4.)

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
  // arrives is revoked, see fetchPiece), a streamed one is silenced at once.
  const halt = () => {
    const r = run;
    if (!r) return;
    run = null;
    hush(r, false);
    r.st.forEach((s) => {
      if (s.ctl) s.ctl.abort();
      s.ctl = null;
      if (s.pcm) s.pcm.stop();
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

  // A streamed piece plays straight through the context (into her analyser):
  // its first scheduled sound is "playing", its last one ending is the end.
  const startStream = (r, voice) => {
    const index = r.index;
    const mine = () => r === run && r.index === index && r.st[index].pcm === voice;
    voice.play(analyser, {
      onStart: () => {
        if (!mine()) return;
        r.paused = false;
        r.on.onPlaying?.(index);
      },
      onEnd: () => {
        if (!mine()) return;
        pieceSaid(r, r.pieces[index].text);
        next(r);
      },
      // pause(), or the system took the audio: as the element's "pause".
      onPause: () => {
        if (!mine()) return;
        r.paused = true;
        r.on.onPaused?.();
      },
      onError: (e) => {
        if (mine()) fail(r, e);
      },
    });
  };

  const start = (r) => {
    const index = r.index;
    const voice = r.st[index].pcm;
    if (voice ? voiceContext()?.state !== "running" : !isAudible(el)) {
      resumeVoiceAudio().then((ok) => {
        // (A stream that broke meanwhile is being fetched again: it plays when it is there.)
        if (r !== run || r.index !== index || r.waiting) return;
        if (ok) start(r);
        else block(r);
      });
      return;
    }
    if (voice) {
      startStream(r, voice);
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
    // (A streamed piece plays into this analyser too: one for all her voice.)
    analyser = attachAnalyser(audio);
    if (!s.pcm) audio.src = r.pieces[r.index].url;
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
    pcm: null, // streamed: its audio so far (lib/voiceAudio.js createPcmStream)
  });

  const pump = (r) => {
    for (let i = 0; i < r.st.length && i < r.stopAt && r.inFlight < IN_FLIGHT; i++) {
      if (r.st[i].status === "idle") fetchPiece(r, i);
    }
  };

  // Piece i is there: it plays if she was waiting for it.
  const ready = (r, i) => {
    r.st[i].status = "ready";
    r.on.onPieceReady?.(i);
    if (r === run && r.waiting && r.index === i) play(r);
    if (r === run) pump(r);
  };

  // Piece i didn't come: its request failed, or its stream broke before any
  // of it was heard. Asked for once more (see worthRetrying), else said by
  // the device — or her voice ends there.
  const missed = (r, i, error, streamed) => {
    const s = r.st[i];
    if (streamed && error?.canFallBack) {
      // No streaming route on this server: the piece is fetched whole, now
      // and from now on (this try doesn't count).
      streamRoute = false;
      s.tries -= 1;
      s.status = "idle";
    } else if (s.tries < 2 && worthRetrying(error)) {
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

  const fetchPiece = (r, i) => {
    const s = r.st[i];
    const ctl = new window.AbortController();
    const streamed = !!r.fetchStream && streamRoute && streamingVoiceSupported();
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
    // Once per request: when it has answered in full (a streamed piece: all
    // of it has come), or the moment it fails, is cancelled or times out — a
    // request still stuck before the network (the auth step) never sees its
    // signal, and must not leave the call waiting forever. Returns whether
    // the outcome is still wanted (not if the run was stopped or this
    // request cancelled).
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      r.inFlight -= 1;
      if (s.ctl === ctl) s.ctl = null;
      return r === run && (!ctl.signal.aborted || timedOut);
    };
    const failed = (error) => {
      if (settle()) missed(r, i, error, streamed);
    };
    ctl.signal.addEventListener("abort", () => {
      const e = new Error(timedOut ? "timeout" : "canceled");
      e.name = timedOut ? "TimeoutError" : "AbortError";
      failed(e);
    });
    const arrived = (url) => {
      if (!settle()) {
        URL.revokeObjectURL(url);
        return;
      }
      r.pieces[i].url = url;
      ready(r, i);
    };
    // Streamed, its first audio is here: the piece is there and may play at
    // once, while the rest keeps coming (no PIECE_TIMEOUT_MS any more — the
    // stream has a stall timeout of its own, lib/api.js).
    const streaming = ({ reader, rate }) => {
      if (settled) {
        reader.cancel?.();
        return;
      }
      clearTimeout(timer);
      const voice = createPcmStream(rate);
      s.pcm = voice;
      const broke = (error) => {
        const heard = voice.started();
        voice.stop();
        if (s.pcm === voice) s.pcm = null;
        if (!settle()) return;
        if (heard) {
          // She was saying it: her voice broke off, as with a broken clip.
          s.status = "failed";
          s.error = error;
          fail(r, error);
          return;
        }
        if (r.index === i) r.waiting = true; // (it may have been about to start)
        missed(r, i, error, true);
      };
      ready(r, i);
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (settled) {
            reader.cancel?.();
            return false;
          }
          if (done) return true;
          voice.push(value);
        }
      })().then((complete) => {
        if (!complete) return;
        // Its slot and its WAV first: if all of it has been heard already
        // (the audio ran dry just before the body's end), end() goes on to
        // the next piece — or ends the reply — right away.
        if (settle()) {
          // The whole clip, kept for "Tekrar dinle" (from the element).
          r.pieces[i].url = wavUrl(voice.pcm16(), rate);
          pump(r);
        }
        voice.end();
      }, broke);
    };
    Promise.resolve()
      .then(() => (streamed ? r.fetchStream(i, ctl.signal) : r.fetchPiece(i, ctl.signal)))
      .then((got) => {
        if (!streamed) arrived(got);
        else if (got?.reader) streaming(got);
        else if (got?.url) arrived(got.url);
        else failed(new Error("tts stream: no audio"));
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
    // fetchPiece(index, signal) -> Promise<blob URL>, fetchStream(index,
    // signal) -> Promise<{reader, rate} | {url}> (lib/api.js fetchTTSStream;
    // optional — used only where streaming works, see 4.), lang ("tr-TR" |
    // "en-US", for the device's voice), open (the reply is still streaming
    // in: more pieces come through grow()), before() -> a promise to wait
    // for before her first piece plays, or null (asked when that piece is
    // about to play), and the callbacks onPieceReady(i), onPlaying(i),
    // onPaused(), onDone(), onFailed(i, error). Replaces whatever was being
    // said.
    speak({ pieces, fetchPiece, fetchStream = null, lang, open = false, before = null, ...on }) {
      halt();
      const synth = browserVoiceSupported();
      const r = {
        pieces,
        fetchPiece,
        fetchStream,
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
      const voice = r.index >= 0 && !r.waiting ? r.st[r.index]?.pcm : null;
      if (voice) {
        voice.pause(); // its onPause reports it
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
      if (el || r.st[r.index].pcm) start(r); // (a streamed piece: from where it stopped)
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
        const s = r.st[r.index];
        if (r.voice) now = r.voice.position();
        else if (s.status === "synth") now = r.from;
        else if (s.pcm) {
          const { text } = r.pieces[r.index];
          now = text.length * s.pcm.progress(clipSeconds(text)); // (the real length once all of it came)
        } else if (el && el.duration && isFinite(el.duration)) {
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
