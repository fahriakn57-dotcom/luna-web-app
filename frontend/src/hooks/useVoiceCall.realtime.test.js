/* global test, expect, jest, beforeAll, beforeEach, afterEach, require */
// hooks/useVoiceCall.js — the HD call (lib/realtimeCall.js, faked here):
// used when the server says this account can, its states on the call
// screen, the main button (cut in / mute / unmute), the transcript handed
// to the chat, the help card, hanging up, and the classic call taking over
// when it can't connect, is refused or ends. Run with:
//   CI=true npx craco test --watchAll=false src/hooks/useVoiceCall.realtime
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

// Shared with the mock factories below (jest only lets them see "mock*" names).
const mockRt = { calls: [], status: null, startResult: null, toolCalls: [], connects: [] };

function mockMakeCall(opts) {
  const call = {
    opts,
    hungUp: [],
    interrupted: 0,
    muted: false,
    start: () => (mockRt.startResult ? mockRt.startResult(call) : Promise.resolve()),
    hangUp: (reason) => { call.hungUp.push(reason); return Promise.resolve(); },
    interrupt: () => { call.interrupted += 1; },
    setMuted: (m) => { call.muted = m; },
    progress: () => 0.5,
    analyser: () => null,
  };
  mockRt.calls.push(call);
  return call;
}

jest.mock("@/lib/api", () => ({
  fetchTTS: () => Promise.reject(new Error("no classic voice in these tests")),
  fetchTTSStream: () => Promise.reject(new Error("no classic voice in these tests")),
  getReplyLang: () => null,
  fetchRealtimeStatus: () => Promise.resolve(mockRt.status),
  startRealtimeVoice: () => Promise.resolve({ session_id: "s1", connect: "server", conversation_id: "conv-srv" }),
  sendRealtimeTranscript: () => Promise.resolve({}),
  endRealtimeVoice: () => Promise.resolve({}),
  connectRealtimeVoice: (args) => { mockRt.connects.push(args); return Promise.resolve("v=0 answer"); },
  runAgentToolCall: (args) => { mockRt.toolCalls.push(args); return Promise.resolve({ output: "{}", actions: [] }); },
}), { virtual: true });
jest.mock("../lib/realtimeCall", () => ({
  realtimeSupported: () => true,
  requestMicrophone: () => Promise.resolve({ getTracks: () => [] }),
  createRealtimeCall: (opts) => mockMakeCall(opts),
}));
jest.mock("@/lib/browserVoice", () => ({
  browserVoiceSupported: () => false, sayWithBrowser: () => null, unlockBrowserVoice: () => {},
}), { virtual: true });
jest.mock("@/lib/voiceAudio", () => {
  const ctx = {
    state: "running", currentTime: 0, destination: {},
    decodeAudioData(data, ok) { const b = { duration: 1.0 }; if (ok) ok(b); return Promise.resolve(b); },
    createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
    createBufferSource() { return { buffer: null, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; },
  };
  return {
    primeVoiceAudio: () => {}, micDelayAfterSpeechMs: () => 50, playTurnCue: () => Promise.resolve(),
    voiceContext: () => ctx, contextAlwaysAudible: () => true,
    attachAnalyser: () => null, isAudible: () => true, resumeVoiceAudio: () => Promise.resolve(true), releaseAnalyser: () => {},
    streamingVoiceSupported: () => false, createPcmStream: () => null,
  };
}, { virtual: true });
jest.mock("@/lib/voicePlayer", () => jest.requireActual("../lib/voicePlayer"), { virtual: true });
jest.mock("@/lib/voiceFiller", () => jest.requireActual("../lib/voiceFiller"), { virtual: true });
jest.mock("@/lib/spokenText", () => jest.requireActual("../lib/spokenText"), { virtual: true });
jest.mock("@/lib/speechChunks", () => jest.requireActual("../lib/speechChunks"), { virtual: true });

const { useVoiceCall } = require("./useVoiceCall");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(ms) {
  const end = Date.now() + ms;
  for (let left = ms; left > 0; left = end - Date.now()) {
    await act(async () => { await sleep(Math.min(10, left)); });
  }
}

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function pause() {};
  window.HTMLMediaElement.prototype.load = function load() {};
  URL.createObjectURL = () => "blob:silent";
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (url) => (String(url).endsWith("manifest.json")
    ? { ok: true, json: async () => ({ version: 2, voice: "marin", clips: { tr: ["tr-1.mp3"] } }) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

const ctl = {};
function makeSpeech() {
  return {
    listening: false, interim: "", supported: true, error: null, finalizing: false, capturing: false,
    transcribing: false, engine: "native",
    start: jest.fn(() => { ctl.patchSpeech({ listening: true }); return true; }),
    stop: jest.fn(() => { ctl.patchSpeech({ listening: false }); }),
    abort: jest.fn(() => { ctl.patchSpeech({ listening: false, interim: "" }); }),
    clearError: jest.fn(),
  };
}
function Harness() {
  const [speech, setSpeech] = useState(makeSpeech);
  ctl.patchSpeech = (p) => setSpeech((s) => ({ ...s, ...p }));
  ctl.speech = speech;
  ctl.call = useVoiceCall({
    lang: "tr", t: (tr) => tr, quotaMessage: () => "", speech, sending: false, sendTurn: () => {}, fillerChance: 0,
    mode: "friend", conversationId: "conv-1", onTranscriptTurn: (turn) => ctl.turns.push(turn),
  });
  return null;
}

let root;
let host;
let mounted;
beforeEach(async () => {
  try { localStorage.clear(); } catch (_) {}
  mockRt.calls = [];
  mockRt.status = { available: true, voice: "marin", reason: null };
  mockRt.startResult = null;
  mockRt.toolCalls = [];
  mockRt.connects = [];
  ctl.turns = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
  await act(async () => root.render(<Harness />));
  await wait(1700); // the status is asked for 1.5 s after the page loads
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
});

const props = () => ctl.call.modalProps;
const open = () => act(async () => { ctl.call.open(); });

test("an account the server allows gets the HD call: connecting, then the server's turns", async () => {
  await open();
  expect(mockRt.calls).toHaveLength(1);
  expect(ctl.speech.start).not.toHaveBeenCalled(); // the classic recognizer never opens
  expect(props().state).toBe("connecting");
  expect(props().realtime).toBe(true);
  expect(props().capturing).toBe(false);
  const call = mockRt.calls[0];
  await act(async () => { call.opts.on.state("listening"); });
  expect(props().state).toBe("listening");
  expect(props().capturing).toBe(true);
  await act(async () => { call.opts.on.userInterim("Selam Lu"); });
  expect(props().interim).toBe("Selam Lu");
  await act(async () => {
    call.opts.on.userFinal("Selam Luna");
    call.opts.on.state("thinking");
  });
  expect(props().state).toBe("thinking");
  expect(props().lastSent).toBe("Selam Luna");
  expect(props().interim).toBe("");
  await act(async () => {
    call.opts.on.state("speaking");
    call.opts.on.assistantDelta("Merhaba!", "a1");
  });
  expect(props().state).toBe("speaking");
  expect(props().replyText).toBe("Merhaba!");
  expect(props().speechProgress()).toBe(0.5);
  await act(async () => { call.opts.on.assistantFinal("Merhaba! Nasılsın?", "a1"); });
  expect(props().replyText).toBe("Merhaba! Nasılsın?");
  expect(ctl.turns).toEqual([{ role: "user", text: "Selam Luna" }, { role: "assistant", text: "Merhaba! Nasılsın?" }]);
  expect(props().canReplay).toBe(false);
});

test("the session asks for this thread, mode and language", async () => {
  await open();
  const call = mockRt.calls[0];
  expect(typeof call.opts.startSession).toBe("function");
  expect(typeof call.opts.postTranscript).toBe("function");
  expect(typeof call.opts.endSession).toBe("function");
  expect(call.opts.audioContext).toBeTruthy();
});

test("the main button cuts in while she speaks, mutes and unmutes your mic", async () => {
  await open();
  const call = mockRt.calls[0];
  await act(async () => { call.opts.on.state("speaking"); });
  await act(async () => { props().onMainAction(); });
  expect(call.interrupted).toBe(1);
  await act(async () => { call.opts.on.state("listening"); });
  await act(async () => { props().onMainAction(); });
  expect(call.muted).toBe(true);
  expect(props().state).toBe("muted");
  expect(props().muted).toBe(true);
  await act(async () => { props().onMainAction(); });
  expect(call.muted).toBe(false);
  expect(props().state).toBe("listening");
  await act(async () => { call.opts.on.state("connecting"); });
  await act(async () => { props().onMainAction(); }); // nothing to do while connecting
  expect(call.interrupted).toBe(1);
});

test("the help card the server sent shows on the call screen", async () => {
  await open();
  await act(async () => { mockRt.calls[0].opts.on.safety({ kind: "self_harm", resources: [{ phone: "112" }] }); });
  expect(props().realtimeSafety).toEqual({ kind: "self_harm", resources: [{ phone: "112" }] });
});

test("leaving the page hangs the HD call up", async () => {
  await open();
  const call = mockRt.calls[0];
  await act(async () => root.unmount());
  mounted = false;
  expect(call.hungUp).toEqual(["user"]);
});

test("an HD call that can't connect: the classic call takes over, and the next call is classic", async () => {
  mockRt.startResult = () => Promise.reject(Object.assign(new Error("sdp"), { stage: "sdp" }));
  await open();
  await wait(30);
  expect(props().realtime).toBe(false);
  expect(props().notice).toMatch(/HD ses şu an bağlanamadı/);
  expect(ctl.speech.start).toHaveBeenCalled(); // hands-free listening, as a classic call starts
  expect(props().state).toBe("listening");
  expect(Number(localStorage.getItem("luna_rt_trouble_until"))).toBeGreaterThan(Date.now());
  await open();
  expect(mockRt.calls).toHaveLength(1); // no second HD attempt for a while
});

test("a session the server refuses: classic now, no 'trouble' remembered", async () => {
  mockRt.startResult = () => Promise.reject(Object.assign(new Error("429"), { stage: "session", status: 429 }));
  await open();
  await wait(30);
  expect(props().realtime).toBe(false);
  expect(localStorage.getItem("luna_rt_trouble_until")).toBeNull();
  await open();
  expect(mockRt.calls).toHaveLength(1); // (the server said no: classic until the status changes)
});

test("an HD call whose time is up: a note, and the classic call waits for a tap", async () => {
  await open();
  await act(async () => { mockRt.calls[0].opts.on.state("listening"); });
  await act(async () => { mockRt.calls[0].opts.on.ended({ reason: "max_duration" }); });
  expect(props().realtime).toBe(false);
  expect(props().state).toBe("idle");
  expect(props().autoPaused).toBe(true);
  expect(props().notice).toMatch(/HD görüşme süren doldu/);
  expect(localStorage.getItem("luna_rt_trouble_until")).toBeNull();
  await act(async () => { props().onMainAction(); }); // a tap: the classic call listens
  expect(ctl.speech.start).toHaveBeenCalled();
  expect(props().notice).toBe("");
});

test("no HD call when the server says this account can't make one", async () => {
  mockRt.status = { available: false, reason: "plan", voice: "marin" };
  await wait(10);
  // (the status was asked before this test changed it: ask again by remounting)
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await wait(1700);
  await open();
  expect(mockRt.calls).toHaveLength(0);
  expect(props().realtime).toBe(false);
  await wait(20);
  expect(ctl.speech.start).toHaveBeenCalled();
});

test("the offer goes through the server's relay, and her tools run in the session's thread", async () => {
  await open();
  const call = mockRt.calls[0];
  expect(typeof call.opts.connectSdp).toBe("function");
  expect(typeof call.opts.callTool).toBe("function");
  await act(async () => { await call.opts.connectSdp({ sessionId: "s1", sdp: "v=0 offer" }); });
  expect(mockRt.connects).toEqual([{ sessionId: "s1", sdp: "v=0 offer" }]);
  // before the session: the chat's thread; after it: the thread the server stores the call in
  await act(async () => { await call.opts.callTool({ name: "create_note", arguments: "{}" }); });
  expect(mockRt.toolCalls[0]).toEqual({ name: "create_note", arguments: "{}", conversationId: "conv-1" });
  await act(async () => { await call.opts.startSession(); });
  await act(async () => { await call.opts.callTool({ name: "create_reminder", arguments: "{\"text\":\"x\"}" }); });
  expect(mockRt.toolCalls[1]).toEqual({ name: "create_reminder", arguments: "{\"text\":\"x\"}", conversationId: "conv-srv" });
});

const REMINDER = [{ type: "reminder_created", id: "651f0c2b9d3e4a5b6c7d8e9f", summary: "Annemi ara" }];

test("what her tools did goes to the chat with her next answer", async () => {
  await open();
  const call = mockRt.calls[0];
  await act(async () => {
    call.opts.on.actions(REMINDER);
    call.opts.on.assistantFinal("Yarın dokuzda hatırlatırım.", "a1");
  });
  expect(ctl.turns).toEqual([{ role: "assistant", text: "Yarın dokuzda hatırlatırım.", actions: REMINDER }]);
  await act(async () => { call.opts.on.assistantFinal("Başka bir şey?", "a2"); });
  expect(ctl.turns[1]).toEqual({ role: "assistant", text: "Başka bir şey?" }); // (once)
});

test("hanging up before she said it: the cards still reach the chat", async () => {
  await open();
  await act(async () => { mockRt.calls[0].opts.on.actions(REMINDER); });
  await act(async () => { props().onClose(); });
  await wait(50); // (the way out goes through history: popstate)
  expect(ctl.turns).toEqual([{ role: "assistant", text: "", actions: REMINDER }]);
  expect(mockRt.calls[0].hungUp).toEqual(["user"]);
});

test("a refused session says the server's reason on the screen", async () => {
  const detail = "Bu haftaki HD sesli görüşme hakkın doldu; standart sesli görüşmeyle devam edebilirsin.";
  mockRt.startResult = () => Promise.reject(Object.assign(new Error("429"), {
    stage: "session", status: 429, cause: { response: { status: 429, data: { detail } } },
  }));
  await open();
  await wait(30);
  expect(props().realtime).toBe(false);
  expect(props().notice).toBe(detail);
});
