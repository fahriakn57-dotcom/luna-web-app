// HD voice calls: you and Luna talk speech to speech over WebRTC with
// OpenAI's Realtime API (hooks/useVoiceCall.js drives it; the classic call —
// recognizer -> chat -> her voice piece by piece — takes over whenever this
// can't start or breaks off).
//
// How a call goes:
//   1. The server mints a short-lived client secret for this account
//      (startSession -> POST /api/voice/realtime/session): Luna's persona,
//      language, today's date, what she knows about you, her voice, her
//      tools and the turn detection are fixed in it. The mic is asked for at
//      the same time (requestMicrophone, inside the tap that opened the call).
//   2. RTCPeerConnection: the mic track goes out, her voice comes back as a
//      remote track played by an <audio> element, and a data channel
//      ("oai-events") carries the session's events. The SDP offer goes to
//      the server (connectSdp -> POST /api/voice/realtime/connect), which
//      posts it to OpenAI with the secret it kept — the browser never holds
//      it, and the server can hang the call up — and the answer completes
//      the connection. (session.connect === "direct", the server's kill
//      switch: the offer goes to OpenAI from here with session.client_secret.)
//   3. Events: your speech starts/stops (server VAD), the transcript of your
//      words, her reply's transcript as she says it, her audio starting and
//      stopping. Each finished turn goes back to the server in spoken order
//      (postTranscript): the chat history, memories and the crisis check
//      need them, and the call's time is billed as it goes. With no turn to
//      send, an empty post every heartbeat says the call is still on.
//   4. Her tools (a reminder, a note — when the server gave her any): a
//      function call in a finished response runs on the server (callTool ->
//      POST /api/agent/tool-call), its output goes back as a
//      function_call_output item, then she answers (response.create). What
//      was done goes to on.actions (the chat's cards).
//   5. The server may answer with the help card (safety), new session
//      instructions (crisis: sent as a session.update, tools off), how long
//      the call may still last (seconds_left: her plan's budget may end it
//      sooner) or stop (time up, budget, spend breaker).
//   6. Hanging up (or the page going away) closes everything and posts the
//      last turns with the end of the call (endSession, keepalive).
//
// No reconnecting: a dropped call ends (on.ended), and the classic call is
// there. This module has no app imports on purpose: everything it needs is
// passed in (the hook, and its tests, decide).

export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const CONNECT_TIMEOUT_MS = 15000;
const DISCONNECT_GRACE_MS = 4000;  // a "disconnected" peer may come back by itself
const FLUSH_DELAY_MS = 250;
const USER_TEXT_WAIT_MS = 6000;    // a turn of yours whose words never came is passed over after this
const CHARS_PER_SECOND = 14;       // how fast she speaks, for the captions
const MAX_POST_TRIES = 3;
const MAX_TURN_CHARS = 4000;
const MAX_TOOL_CALLS = 12;         // per call: past this she is told no more
const MAX_TOOL_ARGS = 8000;
// What she reads when a tool couldn't run (the server's own refusals come
// as its output).
const TOOL_FAILED = JSON.stringify({
  ok: false, error: "unavailable", message: "The action could not be done right now; tell the user honestly.",
});
const TOOL_LIMIT = JSON.stringify({
  ok: false, error: "too_many_calls", message: "No more actions in this call; suggest doing it in the chat.",
});

// GA event names first, then the preview names an older server may send.
const EV = {
  itemAdded: ["conversation.item.added", "conversation.item.created"],
  userDelta: ["conversation.item.input_audio_transcription.delta"],
  userDone: ["conversation.item.input_audio_transcription.completed"],
  userFailed: ["conversation.item.input_audio_transcription.failed"],
  botDelta: ["response.output_audio_transcript.delta", "response.audio_transcript.delta",
    "response.output_text.delta", "response.text.delta"],
  botDone: ["response.output_audio_transcript.done", "response.audio_transcript.done",
    "response.output_text.done", "response.text.done"],
};

const IOS = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent || "")
  || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1));

// Whether this browser can make an HD call at all.
export function realtimeSupported() {
  try {
    return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function"
      && typeof navigator !== "undefined" && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === "function";
  } catch (_) {
    return false;
  }
}

// The mic, asked for inside the tap that opens the call (the permission
// prompt belongs to that tap). Echo cancellation keeps her own voice out.
export function requestMicrophone() {
  try {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function stopStream(stream) {
  try {
    stream?.getTracks?.().forEach((t) => t.stop());
  } catch (_) {}
}

// An error saying where the call failed: "session" (the server refused —
// `status` says why: 403 plan, 429 minutes, 503 busy), "mic", "sdp",
// "connect" or "start" (hung up while connecting).
function failure(stage, cause, extra = {}) {
  const e = new Error(`realtime ${stage} failed${cause?.message ? `: ${cause.message}` : ""}`);
  e.name = "RealtimeCallError";
  e.stage = stage;
  e.cause = cause;
  e.status = cause?.response?.status ?? cause?.status ?? null;
  e.reason = cause?.response?.headers?.["x-luna-realtime"] ?? null;
  return Object.assign(e, extra);
}

function withTimeout(promise, ms, what) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const numberOr0 = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

// startSession() -> Promise<{session_id, connect: "server" | "direct",
//   client_secret + calls_url (direct only), max_seconds, heartbeat_seconds,
//   greet, session_update}>
// mic: a Promise<MediaStream> (requestMicrophone(), started in the tap)
// connectSdp({sessionId, sdp}) -> Promise<string> the SDP answer (the server's relay)
// postTranscript({sessionId, turns}) -> Promise<{safety?, instructions_update?,
//   tools_off?, seconds_left?, stop?, stop_reason?}>
// endSession({sessionId, turns, reason, usage}) -> Promise
// callTool({name, arguments, callId}) -> Promise<{output, actions}> (her tools; optional)
// audioContext: for the visuals' analyser of her voice (optional)
// on: { state(s), userInterim(text), userFinal(text), assistantDelta(text, id),
//       assistantFinal(text, id), safety(payload), actions(list), ended({reason}), error(err) }
//   state: "connecting" | "listening" | "user-speaking" | "thinking" | "speaking" | "ended"
// fetchImpl / RTC / makeAudio / now: for tests.
export function createRealtimeCall({
  startSession, mic, postTranscript, endSession, connectSdp = null, callTool = null, audioContext = null, on = {},
  fetchImpl = null, RTC = null, makeAudio = null, now = () => Date.now(),
}) {
  const doFetch = fetchImpl || ((...a) => window.fetch(...a));
  const PeerConnection = RTC || (typeof window !== "undefined" ? window.RTCPeerConnection : undefined);
  const newAudio = makeAudio || (() => new window.Audio());

  let phase = "idle";       // idle | connecting | live | ended
  let state = "idle";
  let session = null;
  let micStream = null;
  let pc = null;
  let dc = null;
  let audio = null;
  let analyserNode = null;
  let analyserSource = null;
  let muted = false;
  let userSpeaking = false;
  let bufferEvents = false; // the server reports her audio starting/stopping (WebRTC)
  let speakingSince = 0;
  let botText = "";
  let speakTimer = null;
  let heartbeat = null;
  let maxTimer = null;
  let flushTimer = null;
  let dropTimer = null;
  let connectReject = null;
  let posting = Promise.resolve();
  let ended = false;
  let deadline = 0;          // when the call must end (now() ms; 0 = no limit)
  let toolCount = 0;
  const toolCalls = new Set(); // call_ids already run
  const retry = [];          // turns whose post failed, sent again first
  const items = [];          // conversation items in spoken order (see noteItem)
  const byId = new Map();
  const sent = new Set();
  const usage = {};

  const emit = (name, ...args) => {
    try {
      on[name]?.(...args);
    } catch (_) {}
  };

  const setState = (s) => {
    if (s === state) return;
    state = s;
    emit("state", s);
  };

  const send = (event) => {
    try {
      if (dc && dc.readyState === "open") dc.send(JSON.stringify(event));
    } catch (_) {}
  };

  // ---- the transcript, in spoken order
  // A message item of yours or hers, noted when the server adds it to the
  // conversation (or when its first words arrive, if that came first).
  const noteItem = (id, role) => {
    const key = id || `local-${now()}-${items.length}`;
    let it = byId.get(key);
    if (!it) {
      it = { id: key, role, text: null, partial: "", done: false, at: now() };
      byId.set(key, it);
      items.push(it);
    }
    return it;
  };

  const finishItem = (id, role, text) => {
    const it = noteItem(id, role);
    if (it.done) return it;
    it.done = true;
    it.text = String(text ?? it.partial ?? "").trim();
    scheduleFlush();
    return it;
  };

  // The turns that can go now, oldest first: an item still waiting for its
  // words holds the ones after it (your words are transcribed after you
  // spoke, while her answer may already be coming) — for at most
  // USER_TEXT_WAIT_MS. force (hanging up): everything, with what was heard
  // of an unfinished one.
  const takeReady = (force) => {
    const out = [];
    while (items.length) {
      const it = items[0];
      if (!it.done) {
        if (force || (it.role === "user" && now() - it.at > USER_TEXT_WAIT_MS)) {
          it.done = true;
          it.text = (it.partial || "").trim();
        } else {
          break;
        }
      }
      items.shift();
      byId.delete(it.id);
      if (it.text && !sent.has(it.id)) {
        sent.add(it.id);
        out.push({ role: it.role, text: it.text.slice(0, MAX_TURN_CHARS), item_id: String(it.id).slice(0, 64) });
      }
    }
    return out;
  };

  // The call's end, moved closer when the server says it must be (her
  // plan's budget ran low while you talked).
  const shortenTo = (seconds) => {
    if (phase !== "live" || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return;
    const at = now() + seconds * 1000;
    if (deadline && at >= deadline - 1000) return;
    deadline = at;
    clearTimeout(maxTimer);
    maxTimer = setTimeout(() => finish("max_duration"), seconds * 1000);
  };

  const handleServer = (res) => {
    if (!res || typeof res !== "object") return;
    if (res.safety) emit("safety", res.safety);
    if (typeof res.instructions_update === "string" && res.instructions_update) {
      const update = { type: "realtime", instructions: res.instructions_update };
      // (a conversation in crisis: no account actions any more)
      if (res.tools_off) Object.assign(update, { tools: [], tool_choice: "none" });
      send({ type: "session.update", session: update });
    }
    if (res.stop && phase === "live") {
      // (her time, her plan's budget or the platform's spend: the same note on the screen)
      const reason = res.stop_reason === "max_duration" ? "max_duration" : "limit";
      finish(reason);
      return;
    }
    shortenTo(res.seconds_left);
  };

  // ---- her tools: the function calls of a finished response
  const runTool = async (item) => {
    const callId = String(item.call_id || "");
    const name = String(item.name || "");
    if (toolCount >= MAX_TOOL_CALLS) return { callId, output: TOOL_LIMIT };
    toolCount += 1;
    const args = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {});
    if (typeof callTool !== "function" || !name || args.length > MAX_TOOL_ARGS) return { callId, output: TOOL_FAILED };
    try {
      const res = await callTool({ name, arguments: args, callId });
      if (Array.isArray(res?.actions) && res.actions.length) emit("actions", res.actions);
      return { callId, output: typeof res?.output === "string" && res.output ? res.output : TOOL_FAILED };
    } catch (_) {
      return { callId, output: TOOL_FAILED };
    }
  };

  const handleToolCalls = (output) => {
    const calls = (output || []).filter((item) => item?.type === "function_call" && item.call_id
      && !toolCalls.has(item.call_id));
    if (!calls.length) return;
    calls.forEach((item) => toolCalls.add(item.call_id));
    setState("thinking");
    Promise.all(calls.map(runTool)).then((results) => {
      if (phase !== "live") return;
      results.forEach(({ callId, output: out }) => {
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: out } });
      });
      send({ type: "response.create" }); // she says what was done
    });
  };

  const flush = (force = false, beat = false) => {
    clearTimeout(flushTimer);
    flushTimer = null;
    const turns = [...retry.splice(0), ...takeReady(force)];
    if ((!turns.length && !beat) || !session) return posting;
    posting = posting.then(async () => {
      try {
        const res = await postTranscript({
          sessionId: session.session_id,
          turns: turns.map(({ role, text, item_id: itemId }) => ({ role, text, item_id: itemId })),
        });
        handleServer(res);
      } catch (_) {
        // Sent again with the next post (a failed heartbeat just waits for the next one).
        const again = [];
        turns.forEach((turn) => {
          turn.tries = (turn.tries || 0) + 1;
          if (turn.tries < MAX_POST_TRIES) again.push(turn);
        });
        retry.unshift(...again);
      }
    });
    return posting;
  };

  const scheduleFlush = () => {
    if (flushTimer || phase !== "live") return;
    flushTimer = setTimeout(() => flush(false), FLUSH_DELAY_MS);
  };

  // ---- her voice, for the screen
  const startSpeaking = () => {
    clearTimeout(speakTimer);
    speakTimer = null;
    if (state !== "speaking") speakingSince = now();
    setState("speaking");
  };

  const stopSpeaking = () => {
    clearTimeout(speakTimer);
    speakTimer = null;
    if (state === "speaking" || state === "thinking") setState(userSpeaking ? "user-speaking" : "listening");
  };

  const addUsage = (u) => {
    if (!u || typeof u !== "object") return;
    const add = (key, value) => { usage[key] = (usage[key] || 0) + numberOr0(value); };
    add("input_tokens", u.input_tokens);
    add("output_tokens", u.output_tokens);
    add("input_audio_tokens", u.input_token_details?.audio_tokens);
    add("input_text_tokens", u.input_token_details?.text_tokens);
    add("cached_tokens", u.input_token_details?.cached_tokens);
    add("output_audio_tokens", u.output_token_details?.audio_tokens);
    add("output_text_tokens", u.output_token_details?.text_tokens);
    add("responses", 1);
  };

  const transcriptOf = (item) => {
    for (const c of item?.content || []) {
      if (typeof c?.transcript === "string" && c.transcript) return c.transcript;
      if (typeof c?.text === "string" && c.text) return c.text;
    }
    return "";
  };

  const onEvent = (raw) => {
    let ev;
    try {
      ev = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return;
    }
    const type = ev?.type;
    if (!type || phase !== "live") return;
    if (type === "input_audio_buffer.speech_started") {
      userSpeaking = true;
      clearTimeout(speakTimer);
      speakTimer = null;
      setState("user-speaking"); // (the server stops her voice when you start talking)
    } else if (type === "input_audio_buffer.speech_stopped") {
      userSpeaking = false;
      setState("thinking");
    } else if (EV.itemAdded.includes(type)) {
      const it = ev.item;
      if (it?.type === "message" && (it.role === "user" || it.role === "assistant")) noteItem(it.id, it.role);
    } else if (EV.userDelta.includes(type)) {
      const it = noteItem(ev.item_id, "user");
      it.partial += String(ev.delta || "");
      emit("userInterim", it.partial.trim());
    } else if (EV.userDone.includes(type)) {
      const it = finishItem(ev.item_id, "user", ev.transcript);
      emit("userInterim", "");
      if (it.text) emit("userFinal", it.text);
    } else if (EV.userFailed.includes(type)) {
      finishItem(ev.item_id, "user", "");
      emit("userInterim", "");
    } else if (type === "response.created") {
      if (state !== "speaking") setState("thinking");
    } else if (EV.botDelta.includes(type)) {
      const it = noteItem(ev.item_id, "assistant");
      it.partial += String(ev.delta || "");
      botText = it.partial;
      if (!bufferEvents && state !== "speaking" && !userSpeaking) startSpeaking();
      emit("assistantDelta", botText, it.id);
    } else if (EV.botDone.includes(type)) {
      const it = finishItem(ev.item_id, "assistant", ev.transcript ?? ev.text);
      botText = it.text || botText;
      if (it.text) emit("assistantFinal", it.text, it.id);
    } else if (type === "output_audio_buffer.started") {
      bufferEvents = true;
      startSpeaking();
    } else if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
      bufferEvents = true;
      stopSpeaking();
    } else if (type === "response.done") {
      const r = ev.response || {};
      addUsage(r.usage);
      (r.output || []).forEach((item) => {
        if (item?.type === "message" && item.role === "assistant") {
          const it = byId.get(item.id);
          if (it && !it.done) {
            const text = transcriptOf(item) || it.partial;
            finishItem(item.id, "assistant", text);
            if (text) emit("assistantFinal", text.trim(), item.id);
          }
        }
      });
      // Without the audio events, her voice is over roughly when its words
      // have been said.
      if (!bufferEvents && state === "speaking") {
        const left = Math.max(0, (botText.length / CHARS_PER_SECOND) * 1000 - (now() - speakingSince));
        clearTimeout(speakTimer);
        speakTimer = setTimeout(stopSpeaking, left + 300);
      } else if (state === "thinking" && !userSpeaking) {
        setState("listening"); // (an answer without audio)
      }
      handleToolCalls(r.output); // (she asked for a tool: "thinking" until its answer)
    } else if (type === "error") {
      const err = ev.error || {};
      emit("error", err);
      if (/session_expired|session_closed/i.test(String(err.code || err.type || ""))) finish("expired");
    }
  };

  const onRemoteTrack = (e) => {
    const remote = e.streams?.[0] || (typeof window !== "undefined" && window.MediaStream && e.track
      ? new window.MediaStream([e.track]) : null);
    if (!remote || !audio) return;
    audio.srcObject = remote;
    try {
      audio.play?.()?.catch?.(() => {});
    } catch (_) {}
    // Her level for the visuals: read from the stream, never routed to the
    // speakers (the element plays her). Not on iOS (see lib/voiceAudio.js).
    const ctx = audioContext;
    if (!IOS && ctx && ctx.state === "running" && typeof ctx.createMediaStreamSource === "function" && !analyserNode) {
      try {
        analyserSource = ctx.createMediaStreamSource(remote);
        analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 512;
        analyserNode.smoothingTimeConstant = 0.55;
        analyserSource.connect(analyserNode);
      } catch (_) {
        analyserNode = null;
        analyserSource = null;
      }
    }
  };

  const onPeerState = () => {
    const s = pc?.connectionState;
    if (phase !== "live") return;
    if (s === "failed" || s === "closed") {
      finish("disconnected");
    } else if (s === "disconnected") {
      clearTimeout(dropTimer);
      dropTimer = setTimeout(() => {
        if (phase === "live" && pc?.connectionState !== "connected") finish("disconnected");
      }, DISCONNECT_GRACE_MS);
    } else if (s === "connected") {
      clearTimeout(dropTimer);
      dropTimer = null;
    }
  };

  const onPageHide = () => finish("pagehide");

  const cleanup = () => {
    [speakTimer, maxTimer, flushTimer, dropTimer].forEach((t) => clearTimeout(t));
    clearInterval(heartbeat);
    speakTimer = maxTimer = flushTimer = dropTimer = heartbeat = null;
    try {
      window.removeEventListener("pagehide", onPageHide);
    } catch (_) {}
    try {
      dc?.close?.();
    } catch (_) {}
    try {
      pc?.getSenders?.().forEach((s) => s.track?.stop?.());
    } catch (_) {}
    try {
      pc?.close?.();
    } catch (_) {}
    stopStream(micStream);
    if (audio) {
      try {
        audio.pause?.();
      } catch (_) {}
      try {
        audio.srcObject = null;
      } catch (_) {}
    }
    try {
      analyserSource?.disconnect?.();
    } catch (_) {}
    analyserNode = null;
    analyserSource = null;
  };

  const usageReport = () => (Object.keys(usage).length ? { ...usage } : null);

  const closeServerSession = (reason, turns = []) => {
    if (!session?.session_id) return Promise.resolve();
    const sessionId = session.session_id;
    posting = posting.then(() => endSession({ sessionId, turns, reason, usage: usageReport() })).catch(() => {});
    return posting;
  };

  // The call is over (hung up, time up, dropped, the page went away).
  function finish(reason) {
    if (phase !== "live") return posting;
    phase = "ended";
    ended = true;
    cleanup();
    setState("ended");
    const turns = [...retry.splice(0), ...takeReady(true)]
      .map(({ role, text, item_id: itemId }) => ({ role, text, item_id: itemId }));
    const done = closeServerSession(reason, turns);
    if (reason !== "user") emit("ended", { reason });
    return done;
  }

  const onOpen = () => {
    if (session.session_update && typeof session.session_update === "object") {
      send({ type: "session.update", session: session.session_update });
    }
    if (session.greet) {
      send({ type: "response.create" });
      setState("thinking");
    } else {
      setState("listening");
    }
    const beatMs = Math.max(10, Number(session.heartbeat_seconds) || 30) * 1000;
    heartbeat = setInterval(() => flush(false, true), beatMs);
    const maxS = Number(session.max_seconds) || 0;
    if (maxS > 0) {
      deadline = now() + maxS * 1000;
      maxTimer = setTimeout(() => finish("max_duration"), maxS * 1000);
    }
    try {
      window.addEventListener("pagehide", onPageHide);
    } catch (_) {}
  };

  return {
    // Connects; resolves once the call is live, rejects (a RealtimeCallError)
    // if it can't be — everything it opened is closed again then.
    async start() {
      if (phase !== "idle") throw failure("start", new Error("already started"));
      phase = "connecting";
      setState("connecting");
      Promise.resolve(mic).then((stream) => {
        micStream = stream;
        if (phase === "ended") stopStream(stream); // hung up (or failed) before the mic came
      }, () => {});
      try {
        const [s, stream] = await Promise.all([
          Promise.resolve().then(() => startSession()).catch((e) => { throw failure("session", e); }),
          Promise.resolve(mic).catch((e) => { throw failure("mic", e); }),
        ]);
        session = s;
        micStream = stream;
        if (phase !== "connecting") throw failure("start", new Error("hung up"));
        // The offer goes through the server (it keeps the secret), unless the
        // server hands the secret over (its "direct" kill switch).
        const viaServer = session?.connect === "server" || (!!session && !session.client_secret
          && typeof connectSdp === "function");
        if (!session || (viaServer ? typeof connectSdp !== "function"
          : typeof session.client_secret !== "string" || !session.client_secret)) {
          throw failure("session", new Error(viaServer ? "no relay" : "no client secret"));
        }
        const track = stream?.getAudioTracks?.()[0];
        if (!track) throw failure("mic", new Error("no audio track"));
        if (typeof PeerConnection !== "function") throw failure("connect", new Error("no WebRTC"));
        pc = new PeerConnection();
        audio = newAudio();
        audio.autoplay = true;
        try {
          audio.setAttribute?.("playsinline", "");
        } catch (_) {}
        pc.ontrack = onRemoteTrack;
        pc.onconnectionstatechange = onPeerState;
        pc.addTrack(track, stream);
        dc = pc.createDataChannel("oai-events");
        const opened = new Promise((resolve, reject) => {
          connectReject = reject;
          dc.onopen = () => resolve();
        });
        // A failure before `await opened` (the SDP step) closes the channel
        // during cleanup, which rejects this promise with nobody awaiting it
        // any more; the real outcome is the error already thrown.
        opened.catch(() => {});
        dc.onmessage = (e) => onEvent(e.data);
        dc.onclose = () => {
          if (phase === "live") finish("disconnected");
          else connectReject?.(new Error("data channel closed"));
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        let answer;
        if (viaServer) {
          try {
            answer = await connectSdp({ sessionId: session.session_id, sdp: offer.sdp });
          } catch (e) {
            throw failure("sdp", e);
          }
          if (typeof answer !== "string" || !answer) throw failure("sdp", new Error("no answer"));
        } else {
          let res;
          try {
            res = await doFetch(session.calls_url || REALTIME_CALLS_URL, {
              method: "POST",
              body: offer.sdp,
              headers: { Authorization: `Bearer ${session.client_secret}`, "Content-Type": "application/sdp" },
            });
          } catch (e) {
            throw failure("sdp", e);
          }
          if (!res || !res.ok) throw failure("sdp", new Error(`HTTP ${res?.status}`), { status: res?.status ?? null });
          answer = await res.text();
        }
        if (phase !== "connecting") throw failure("start", new Error("hung up"));
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        try {
          await withTimeout(opened, CONNECT_TIMEOUT_MS, "data channel");
        } catch (e) {
          throw failure("connect", e);
        }
        if (phase !== "connecting") throw failure("start", new Error("hung up"));
        phase = "live";
        onOpen();
      } catch (e) {
        const err = e?.name === "RealtimeCallError" ? e : failure("connect", e);
        phase = "ended";
        cleanup();
        setState("ended");
        // The server's session is closed again (it bills only its first slice).
        closeServerSession(err.stage === "start" ? "user" : "connect_failed");
        throw err;
      }
    },

    // Hang up. While still connecting, start() stops and rejects (stage "start").
    hangUp(reason = "user") {
      if (phase === "connecting") {
        phase = "hanging-up";
        return Promise.resolve();
      }
      return finish(reason);
    },

    // You cut in: her answer stops now (the server also stops when you start talking).
    interrupt() {
      if (phase !== "live") return;
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
      stopSpeaking();
    },

    setMuted(value) {
      muted = !!value;
      try {
        micStream?.getAudioTracks?.().forEach((t) => { t.enabled = !muted; });
      } catch (_) {}
    },

    isMuted: () => muted,
    isLive: () => phase === "live",
    hasEnded: () => ended || phase === "ended",
    state: () => state,
    analyser: () => analyserNode,
    // How much of her current reply she has said (0..1), for the captions.
    progress() {
      if (state !== "speaking") return 1;
      const total = botText.length || 1;
      return Math.min(1, (((now() - speakingSince) / 1000) * CHARS_PER_SECOND) / total);
    },
    // (tests)
    _event: onEvent,
    _flush: flush,
  };
}
