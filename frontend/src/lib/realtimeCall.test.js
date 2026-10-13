/* global test, expect, jest, beforeEach, describe */
// lib/realtimeCall.js — the HD call over WebRTC with fakes for the peer
// connection, its data channel, the mic, the audio element and the network:
// the SDP exchange, the events, the transcript in spoken order, the
// server's answers (help card, crisis instructions, stop), hanging up and
// every way it can fail to start. Run with:
//   CI=true npx craco test --watchAll=false src/lib/realtimeCall
import { createRealtimeCall, REALTIME_CALLS_URL } from "./realtimeCall";

const tick = () => new Promise((r) => setTimeout(r, 0));

class FakeTrack {
  constructor() { this.enabled = true; this.stopped = false; }
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor() { this.track = new FakeTrack(); }
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

class FakeChannel {
  constructor(label) { this.label = label; this.readyState = "connecting"; this.sent = []; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    if (this.onclose) this.onclose();
  }
  open() { this.readyState = "open"; if (this.onopen) this.onopen(); }
  emit(ev) { if (this.onmessage) this.onmessage({ data: JSON.stringify(ev) }); }
}

let opts;
function makePC({ autoOpen = true, closeInstead = false } = {}) {
  const made = [];
  class FakePC {
    constructor() {
      made.push(this);
      this.tracks = [];
      this.closed = false;
      this.connectionState = "new";
    }
    addTrack(track) { this.tracks.push(track); }
    createDataChannel(label) { this.dc = new FakeChannel(label); return this.dc; }
    async createOffer() { return { type: "offer", sdp: "v=0 offer" }; }
    async setLocalDescription(d) { this.local = d; }
    async setRemoteDescription(d) {
      this.remote = d;
      if (autoOpen) setTimeout(() => this.dc.open(), 0);
      if (closeInstead) setTimeout(() => this.dc.close(), 0);
    }
    getSenders() { return this.tracks.map((track) => ({ track })); }
    close() { this.closed = true; this.connectionState = "closed"; }
  }
  return { FakePC, made };
}

const SESSION = {
  session_id: "a".repeat(32), client_secret: "ek_test", calls_url: REALTIME_CALLS_URL, max_seconds: 900,
  heartbeat_seconds: 30, greet: true, session_update: null, voice: "marin",
};

function setup(over = {}) {
  const { FakePC, made } = makePC(over.pc);
  const stream = new FakeStream();
  const clock = { t: 1000 };
  const events = {
    state: [], userFinal: [], userInterim: [], assistantDelta: [], assistantFinal: [], safety: [], ended: [], actions: [],
  };
  const posts = [];
  const ends = [];
  const serverAnswers = [];
  opts = {
    startSession: jest.fn(async () => ({ ...SESSION, ...(over.session || {}) })),
    mic: over.mic || Promise.resolve(stream),
    postTranscript: jest.fn(async (args) => {
      posts.push(args);
      return serverAnswers.shift() || { ok: true };
    }),
    endSession: jest.fn(async (args) => { ends.push(args); return { ok: true }; }),
    fetchImpl: jest.fn(over.fetchImpl || (async () => ({ ok: true, status: 201, text: async () => "v=0 answer" }))),
    ...("connectSdp" in over ? { connectSdp: over.connectSdp } : {}),
    ...("callTool" in over ? { callTool: over.callTool } : {}),
    RTC: FakePC,
    makeAudio: () => ({ autoplay: false, srcObject: null, setAttribute() {}, play: () => Promise.resolve(), pause() {} }),
    now: () => clock.t,
    on: {
      state: (s) => events.state.push(s),
      userFinal: (x) => events.userFinal.push(x),
      userInterim: (x) => events.userInterim.push(x),
      assistantDelta: (x, id) => events.assistantDelta.push([x, id]),
      assistantFinal: (x, id) => events.assistantFinal.push([x, id]),
      safety: (x) => events.safety.push(x),
      ended: (x) => events.ended.push(x),
      actions: (x) => events.actions.push(x),
    },
  };
  const call = createRealtimeCall(opts);
  return { call, made, stream, clock, events, posts, ends, serverAnswers };
}

async function live(over) {
  const env = setup(over);
  await env.call.start();
  env.pc = env.made[0];
  env.dc = env.pc.dc;
  return env;
}

describe("connecting", () => {
  test("mints the session, posts the SDP offer with the client secret and opens the data channel", async () => {
    const env = await live();
    expect(opts.startSession).toHaveBeenCalledTimes(1);
    expect(env.pc.tracks).toEqual([env.stream.track]);
    expect(env.dc.label).toBe("oai-events");
    const [url, init] = opts.fetchImpl.mock.calls[0];
    expect(url).toBe(REALTIME_CALLS_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("v=0 offer");
    expect(init.headers).toEqual({ Authorization: "Bearer ek_test", "Content-Type": "application/sdp" });
    expect(env.pc.remote).toEqual({ type: "answer", sdp: "v=0 answer" });
    expect(env.call.isLive()).toBe(true);
    // she answers the call: a greeting is asked for at once
    expect(env.dc.sent).toEqual([{ type: "response.create" }]);
    expect(env.events.state).toEqual(["connecting", "thinking"]);
    env.call.hangUp();
  });

  test("a session_update from the server goes out first; no greeting when the server says so", async () => {
    const update = { type: "realtime", audio: { input: { transcription: { model: "x" } } } };
    const env = await live({ session: { session_update: update, greet: false } });
    expect(env.dc.sent).toEqual([{ type: "session.update", session: update }]);
    expect(env.events.state).toEqual(["connecting", "listening"]);
    env.call.hangUp();
  });

  test("the server refusing: rejects with stage 'session' and its status, the mic is let go", async () => {
    const env = setup();
    const refusal = Object.assign(new Error("403"), { response: { status: 403, headers: { "x-luna-realtime": "plan" } } });
    opts.startSession.mockImplementation(async () => { throw refusal; });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "session", status: 403, reason: "plan" });
    await tick();
    expect(env.stream.track.stopped).toBe(true);
    expect(env.made).toHaveLength(0);
    expect(opts.endSession).not.toHaveBeenCalled(); // there was no session
  });

  test("the mic refused: stage 'mic'", async () => {
    const env = setup({ mic: Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })) });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "mic" });
  });

  test("OpenAI refusing the offer: stage 'sdp', everything closed, the server's session ended", async () => {
    const env = setup({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => "" }) });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "sdp", status: 401 });
    await tick();
    expect(env.made[0].closed).toBe(true);
    expect(env.stream.track.stopped).toBe(true);
    expect(env.ends).toEqual([{ sessionId: SESSION.session_id, turns: [], reason: "connect_failed", usage: null }]);
  });

  test("the data channel closing before it opened: stage 'connect'", async () => {
    const env = setup({ pc: { autoOpen: false, closeInstead: true } });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "connect" });
    expect(env.call.isLive()).toBe(false);
  });

  test("hanging up while connecting: start() rejects (stage 'start') and nothing stays open", async () => {
    const env = setup();
    const started = env.call.start();
    env.call.hangUp();
    await expect(started).rejects.toMatchObject({ stage: "start" });
    await tick();
    expect(env.stream.track.stopped).toBe(true);
    expect(env.ends[0]).toMatchObject({ reason: "user" });
  });
});

describe("in the call", () => {
  test("your speech, her thinking and her voice drive the state", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "input_audio_buffer.speech_started" });
    env.dc.emit({ type: "input_audio_buffer.speech_stopped" });
    env.dc.emit({ type: "response.created" });
    env.dc.emit({ type: "output_audio_buffer.started" });
    env.dc.emit({ type: "output_audio_buffer.stopped" });
    expect(env.events.state).toEqual(["connecting", "listening", "user-speaking", "thinking", "speaking", "listening"]);
    env.call.hangUp();
  });

  test("the turns go to the server in spoken order, your words first even when they are transcribed late", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "conversation.item.added", item: { id: "u1", type: "message", role: "user" } });
    env.dc.emit({ type: "conversation.item.added", item: { id: "a1", type: "message", role: "assistant" } });
    env.dc.emit({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Merhaba, " });
    env.dc.emit({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Merhaba, nasılsın?" });
    await env.call._flush();
    expect(env.posts).toEqual([]); // her answer waits for your words
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: " Selam Luna " });
    await env.call._flush();
    expect(env.posts).toEqual([{ sessionId: SESSION.session_id, turns: [
      { role: "user", text: "Selam Luna", item_id: "u1" },
      { role: "assistant", text: "Merhaba, nasılsın?", item_id: "a1" },
    ] }]);
    expect(env.events.userFinal).toEqual(["Selam Luna"]);
    expect(env.events.assistantDelta[0]).toEqual(["Merhaba, ", "a1"]);
    expect(env.events.assistantFinal).toEqual([["Merhaba, nasılsın?", "a1"]]);
    await env.call._flush();
    expect(env.posts).toHaveLength(1); // never twice
    env.call.hangUp();
  });

  test("your turn whose words never come is passed over after a few seconds", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "conversation.item.added", item: { id: "u1", type: "message", role: "user" } });
    env.dc.emit({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Efendim?" });
    await env.call._flush();
    expect(env.posts).toEqual([]);
    env.clock.t += 7000;
    await env.call._flush();
    expect(env.posts[0].turns).toEqual([{ role: "assistant", text: "Efendim?", item_id: "a1" }]);
    env.call.hangUp();
  });

  test("an answer finished only in response.done still counts; its usage is added up", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "conversation.item.added", item: { id: "a9", type: "message", role: "assistant" } });
    env.dc.emit({ type: "response.done", response: {
      status: "completed",
      usage: { input_tokens: 100, output_tokens: 50, input_token_details: { audio_tokens: 80, cached_tokens: 10 },
        output_token_details: { audio_tokens: 40 } },
      output: [{ id: "a9", type: "message", role: "assistant", content: [{ type: "output_audio", transcript: "Tamam." }] }],
    } });
    await env.call._flush();
    expect(env.posts[0].turns).toEqual([{ role: "assistant", text: "Tamam.", item_id: "a9" }]);
    await env.call.hangUp();
    expect(env.ends[0].usage).toEqual(expect.objectContaining({
      input_tokens: 100, output_tokens: 50, input_audio_tokens: 80, cached_tokens: 10, output_audio_tokens: 40, responses: 1,
    }));
  });

  test("the server's help card, crisis instructions and stop", async () => {
    const env = await live({ session: { greet: false } });
    env.serverAnswers.push({ ok: true, safety: { kind: "self_harm", resources: [] }, instructions_update: "NEW INSTRUCTIONS" });
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "..." });
    await env.call._flush();
    expect(env.events.safety).toEqual([{ kind: "self_harm", resources: [] }]);
    expect(env.dc.sent).toContainEqual({ type: "session.update", session: { type: "realtime", instructions: "NEW INSTRUCTIONS" } });
    env.serverAnswers.push({ ok: true, stop: true, stop_reason: "max_duration" });
    await env.call._flush(false, true); // a heartbeat
    await tick();
    expect(env.events.ended).toEqual([{ reason: "max_duration" }]);
    expect(env.call.isLive()).toBe(false);
    expect(env.ends[0]).toMatchObject({ reason: "max_duration" });
  });

  test("a failed post is sent again with the next one", async () => {
    const env = await live({ session: { greet: false } });
    opts.postTranscript.mockImplementationOnce(async () => { throw new Error("offline"); });
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Bir" });
    await env.call._flush();
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "İki" });
    await env.call._flush();
    expect(env.posts[env.posts.length - 1].turns.map((t) => t.text)).toEqual(["Bir", "İki"]);
    env.call.hangUp();
  });

  test("cutting in, muting, and the captions' progress", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "output_audio_buffer.started" });
    env.dc.emit({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "x".repeat(28) });
    env.clock.t += 1000;
    expect(env.call.progress()).toBeCloseTo(0.5, 1); // 14 characters a second
    env.call.interrupt();
    expect(env.dc.sent).toEqual([{ type: "response.cancel" }, { type: "output_audio_buffer.clear" }]);
    expect(env.call.state()).toBe("listening");
    env.call.setMuted(true);
    expect(env.stream.track.enabled).toBe(false);
    env.call.setMuted(false);
    expect(env.stream.track.enabled).toBe(true);
    env.call.hangUp();
  });

  test("hanging up closes everything and sends the last turns with the end (what was heard of an unfinished one)", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Görüşürüz" });
    env.dc.emit({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Görüşürüz, kendine " });
    await env.call.hangUp();
    expect(env.pc.closed).toBe(true);
    expect(env.dc.readyState).toBe("closed");
    expect(env.stream.track.stopped).toBe(true);
    expect(env.ends).toEqual([{ sessionId: SESSION.session_id, reason: "user", usage: null, turns: [
      { role: "user", text: "Görüşürüz", item_id: "u1" },
      { role: "assistant", text: "Görüşürüz, kendine", item_id: "a1" },
    ] }]);
    expect(env.events.ended).toEqual([]); // (the caller hung up: no "ended" callback)
    await env.call.hangUp(); // twice is harmless
    expect(env.ends).toHaveLength(1);
  });

  test("the connection dropping ends the call", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.close();
    await tick();
    expect(env.events.ended).toEqual([{ reason: "disconnected" }]);
    expect(env.ends[0]).toMatchObject({ reason: "disconnected" });
  });

  test("events after the end, and garbage, are ignored", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.onmessage({ data: "not json" });
    await env.call.hangUp();
    env.dc.emit({ type: "output_audio_buffer.started" });
    expect(env.events.state).not.toContain("speaking");
  });
});

describe("the server relays the offer (it keeps the secret)", () => {
  const RELAYED = { connect: "server", client_secret: undefined, calls_url: undefined };

  test("the SDP offer goes to the server, never to OpenAI from the browser", async () => {
    const connectSdp = jest.fn(async () => "v=0 relayed answer");
    const env = await live({ session: RELAYED, connectSdp });
    expect(connectSdp).toHaveBeenCalledWith({ sessionId: SESSION.session_id, sdp: "v=0 offer" });
    expect(opts.fetchImpl).not.toHaveBeenCalled();
    expect(env.pc.remote).toEqual({ type: "answer", sdp: "v=0 relayed answer" });
    expect(env.call.isLive()).toBe(true);
    env.call.hangUp();
  });

  test("the relay failing: stage 'sdp' with the server's status, the session ended", async () => {
    const refusal = Object.assign(new Error("502"), { response: { status: 502, headers: { "x-luna-realtime": "provider" } } });
    const env = setup({ session: RELAYED, connectSdp: jest.fn(async () => { throw refusal; }) });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "sdp", status: 502, reason: "provider" });
    await tick();
    expect(env.made[0].closed).toBe(true);
    expect(env.ends[0]).toMatchObject({ reason: "connect_failed" });
  });

  test("an empty answer from the relay is a failure", async () => {
    const env = setup({ session: RELAYED, connectSdp: jest.fn(async () => "") });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "sdp" });
  });

  test("a relayed session without a relay function can't start", async () => {
    const env = setup({ session: RELAYED });
    await expect(env.call.start()).rejects.toMatchObject({ stage: "session" });
    expect(env.made).toHaveLength(0);
  });
});

describe("her tools", () => {
  const fnCall = (callId, name = "create_reminder", args = "{\"text\":\"Annemi ara\",\"due\":\"2026-10-14T09:00\"}") => ({
    type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: args, status: "completed",
  });
  const done = (output) => ({ type: "response.done", response: { status: "completed", output } });

  test("a function call runs on the server, its output goes back and she answers", async () => {
    const actions = [{ type: "reminder_created", id: "651f0c2b9d3e4a5b6c7d8e9f", summary: "Annemi ara" }];
    const callTool = jest.fn(async () => ({ output: "{\"ok\":true}", actions }));
    const env = await live({ session: { greet: false }, callTool });
    env.dc.emit(done([fnCall("call_1")]));
    expect(env.call.state()).toBe("thinking");
    await tick();
    await tick();
    expect(callTool).toHaveBeenCalledWith({
      name: "create_reminder", arguments: "{\"text\":\"Annemi ara\",\"due\":\"2026-10-14T09:00\"}", callId: "call_1",
    });
    expect(env.dc.sent).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_1", output: "{\"ok\":true}" } },
      { type: "response.create" },
    ]);
    expect(env.events.actions).toEqual([actions]);
    env.dc.emit(done([fnCall("call_1")])); // the same call again: never twice
    await tick();
    expect(callTool).toHaveBeenCalledTimes(1);
    env.call.hangUp();
  });

  test("two calls in one response: both outputs, then one answer", async () => {
    const callTool = jest.fn(async ({ callId }) => ({ output: `{"ok":true,"id":"${callId}"}`, actions: [] }));
    const env = await live({ session: { greet: false }, callTool });
    env.dc.emit(done([fnCall("a", "create_note", "{\"text\":\"x\"}"), fnCall("b", "create_note", "{\"text\":\"y\"}")]));
    await tick();
    await tick();
    expect(env.dc.sent.map((e) => e.type)).toEqual(["conversation.item.create", "conversation.item.create", "response.create"]);
    expect(env.dc.sent.map((e) => e.item?.call_id).filter(Boolean)).toEqual(["a", "b"]);
    expect(env.events.actions).toEqual([]);
    env.call.hangUp();
  });

  test("a tool that fails is told to her honestly", async () => {
    const env = await live({ session: { greet: false }, callTool: jest.fn(async () => { throw new Error("offline"); }) });
    env.dc.emit(done([fnCall("c1")]));
    await tick();
    await tick();
    const out = JSON.parse(env.dc.sent[0].item.output);
    expect(out).toMatchObject({ ok: false, error: "unavailable" });
    expect(env.dc.sent[1]).toEqual({ type: "response.create" });
    env.call.hangUp();
  });

  test("no tool function: she still gets an answer (unavailable)", async () => {
    const env = await live({ session: { greet: false } });
    env.dc.emit(done([fnCall("c2")]));
    await tick();
    expect(JSON.parse(env.dc.sent[0].item.output).error).toBe("unavailable");
    env.call.hangUp();
  });

  test("at most a dozen tool calls in one call", async () => {
    const callTool = jest.fn(async () => ({ output: "{\"ok\":true}", actions: [] }));
    const env = await live({ session: { greet: false }, callTool });
    for (let i = 0; i < 13; i += 1) {
      env.dc.emit(done([fnCall(`n${i}`, "create_note", "{\"text\":\"x\"}")]));
      // eslint-disable-next-line no-await-in-loop
      await tick();
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
    expect(callTool).toHaveBeenCalledTimes(12);
    const last = env.dc.sent.filter((e) => e.type === "conversation.item.create").pop();
    expect(JSON.parse(last.item.output).error).toBe("too_many_calls");
    env.call.hangUp();
  });

  test("an output that arrives after the call ended is not sent", async () => {
    let release;
    const callTool = jest.fn(() => new Promise((r) => { release = r; }));
    const env = await live({ session: { greet: false }, callTool });
    env.dc.emit(done([fnCall("late")]));
    await env.call.hangUp();
    release({ output: "{\"ok\":true}", actions: [] });
    await tick();
    expect(env.dc.sent.filter((e) => e.type === "conversation.item.create")).toEqual([]);
  });
});

describe("what the server says while the call runs", () => {
  test("a crisis turns her tools off with the new instructions", async () => {
    const env = await live({ session: { greet: false } });
    env.serverAnswers.push({ ok: true, instructions_update: "CRISIS", tools_off: true });
    env.dc.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "..." });
    await env.call._flush();
    expect(env.dc.sent).toContainEqual({
      type: "session.update", session: { type: "realtime", instructions: "CRISIS", tools: [], tool_choice: "none" },
    });
    env.call.hangUp();
  });

  test("her plan's budget brings the end of the call closer", async () => {
    const env = await live({ session: { greet: false } });
    env.serverAnswers.push({ ok: true, seconds_left: 0.05 });
    await env.call._flush(false, true);
    await new Promise((r) => setTimeout(r, 120));
    expect(env.events.ended).toEqual([{ reason: "max_duration" }]);
    expect(env.ends[0]).toMatchObject({ reason: "max_duration" });
  });

  test("a later end than the current one changes nothing", async () => {
    const env = await live({ session: { greet: false, max_seconds: 0.1 } });
    env.serverAnswers.push({ ok: true, seconds_left: 600 });
    await env.call._flush(false, true);
    await new Promise((r) => setTimeout(r, 160));
    expect(env.events.ended).toEqual([{ reason: "max_duration" }]);
  });

  test("stopped for the budget or the spend breaker: the 'time is up' note", async () => {
    const env = await live({ session: { greet: false } });
    env.serverAnswers.push({ ok: true, stop: true, stop_reason: "budget" });
    await env.call._flush(false, true);
    await tick();
    expect(env.events.ended).toEqual([{ reason: "limit" }]);
  });
});
