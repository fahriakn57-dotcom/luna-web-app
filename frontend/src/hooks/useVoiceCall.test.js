/* global test, expect, jest, beforeAll, beforeEach, afterEach, require */
// hooks/useVoiceCall.js — your turn and her first word (launch audit
// 2026-10-03): the silence that ends a turn after a final vs an interim, the
// recognizer's last words joining the turn, a held turn sent the moment
// nothing holds it, and her "hmm" faded out once piece 0 is ready. Run with:
//   CI=true npx craco test --watchAll=false src/hooks/useVoiceCall
// Real timers, and the real voicePlayer / voiceFiller / speechChunks /
// spokenText; the speech recognizer, the audio element and the AudioContext
// are fakes.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

// The app's "@/" alias is webpack's (craco.config.js), not Jest's: every
// "@/lib/..." module the hook and its libs import is registered here — the
// fakes, and the rest as the real files.
jest.mock("@/lib/api", () => ({ fetchTTS: jest.fn(), fetchTTSStream: jest.fn(), getReplyLang: () => null }), { virtual: true });
jest.mock("@/lib/browserVoice", () => ({
  browserVoiceSupported: () => false, sayWithBrowser: jest.fn(), unlockBrowserVoice: () => {},
}), { virtual: true });
jest.mock("@/lib/voiceAudio", () => {
  const log = [];
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    decodeAudioData(data, ok) { const b = { duration: 1.0 }; if (ok) ok(b); return Promise.resolve(b); },
    createGain() {
      return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    },
    createBufferSource() {
      const src = {
        buffer: null, onended: null, timer: null, connect() {}, disconnect() {},
        start() {
          log.push({ kind: "filler.start", t: Date.now() });
          src.timer = setTimeout(() => src.onended && src.onended(), src.buffer.duration * 1000);
        },
        stop(when) {
          clearTimeout(src.timer);
          const ms = Math.max(0, ((when || 0) - ctx.currentTime) * 1000);
          log.push({ kind: "filler.stop", t: Date.now(), ms });
          src.timer = setTimeout(() => { const f = src.onended; src.onended = null; if (f) f(); }, ms);
        },
      };
      return src;
    },
  };
  return {
    primeVoiceAudio: () => {}, micDelayAfterSpeechMs: () => 50, playTurnCue: () => Promise.resolve(),
    voiceContext: () => ctx, contextAlwaysAudible: () => true,
    attachAnalyser: () => null, isAudible: () => true, resumeVoiceAudio: () => Promise.resolve(true), releaseAnalyser: () => {},
    // these hook tests drive the whole-clip path (the streamed one has its
    // own tests in lib/voicePlayer.stream.test.js)
    streamingVoiceSupported: () => false, createPcmStream: () => null,
    __log: log,
  };
}, { virtual: true });
jest.mock("@/lib/voicePlayer", () => jest.requireActual("../lib/voicePlayer"), { virtual: true });
jest.mock("@/lib/voiceFiller", () => jest.requireActual("../lib/voiceFiller"), { virtual: true });
jest.mock("@/lib/spokenText", () => jest.requireActual("../lib/spokenText"), { virtual: true });
jest.mock("@/lib/speechChunks", () => jest.requireActual("../lib/speechChunks"), { virtual: true });

const api = require("@/lib/api");
const audioMock = require("@/lib/voiceAudio");
const { useVoiceCall } = require("./useVoiceCall");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Time passing as in a browser, where what a timer changed has rendered
// before the next one fires: a few ms per act() (one act() around a long
// sleep holds every render until its end, so the hook would read stale state).
async function wait(ms) {
  const end = Date.now() + ms;
  for (let left = ms; left > 0; left = end - Date.now()) {
    await act(async () => { await sleep(Math.min(10, left)); });
  }
}

const played = [];
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = function play() {
    played.push({ src: this.src, t: Date.now() });
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() {};
  window.HTMLMediaElement.prototype.load = function load() {};
  URL.createObjectURL = () => "blob:silent";
  URL.revokeObjectURL = () => {};
  // Her "hmm" clips. (A plain function: CRA's Jest resets every jest.fn()
  // before each test.)
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

// The recognizer, as useSpeechRecognition reports it. stop() works like the
// native engine's: listening goes off at once; `endAfterStopMs` later it
// gives the words it still held (`heldWords`, if any) as a final, then ends
// (onEnd). endAfterStopMs null: it never answers.
const ctl = {};
function makeSpeech() {
  return {
    listening: false, interim: "", supported: true, error: null, finalizing: false, capturing: false,
    transcribing: false, engine: "native",
    start: jest.fn(() => { ctl.patchSpeech({ listening: true }); return true; }),
    stop: jest.fn(() => {
      ctl.patchSpeech({ listening: false });
      if (ctl.endAfterStopMs == null) return;
      setTimeout(() => {
        const words = ctl.heldWords;
        ctl.heldWords = "";
        if (words) ctl.call.handleFinal(words, undefined);
        ctl.call.handleSpeechEnd({ heard: true, noSpeech: false, aborted: false });
      }, ctl.endAfterStopMs);
    }),
    abort: jest.fn(() => { ctl.patchSpeech({ listening: false, interim: "" }); }),
    clearError: jest.fn(),
  };
}
function Harness() {
  const [sending, setSending] = useState(false);
  const [speech, setSpeech] = useState(makeSpeech);
  ctl.setSending = setSending;
  ctl.patchSpeech = (p) => setSpeech((s) => ({ ...s, ...p }));
  ctl.speech = speech;
  ctl.call = useVoiceCall({ lang: "tr", t: (tr) => tr, quotaMessage: () => "", speech, sending, sendTurn: ctl.sendTurn, fillerChance: ctl.fillerChance });
  return null;
}

let root;
let host;
beforeEach(async () => {
  ctl.fillerChance = 0;
  ctl.endAfterStopMs = 100;
  ctl.heldWords = "";
  ctl.sent = [];
  ctl.sendTurn = jest.fn((text, opts) => { ctl.sent.push({ text, t: Date.now(), turnId: opts.turnId }); ctl.setSending(true); });
  api.fetchTTS.mockReset();
  played.length = 0;
  audioMock.__log.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () => { ctl.call.open(); });
  await wait(30);
  expect(ctl.speech.listening).toBe(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const finalPhrase = (text) => act(async () => {
  ctl.patchSpeech({ interim: "" }); // (the speech hook clears it as the final comes)
  ctl.call.handleFinal(text, undefined);
});
const sentTexts = () => ctl.sent.map((s) => s.text);

test("after a final, 550 ms of silence ends the turn: the recognizer gives its last words and it goes", async () => {
  const t0 = Date.now();
  await finalPhrase("merhaba Luna");
  await wait(470);
  expect(ctl.speech.stop).not.toHaveBeenCalled();
  await wait(300);
  expect(ctl.speech.stop).toHaveBeenCalledTimes(1);
  expect(sentTexts()).toEqual(["merhaba Luna"]);
  const after = ctl.sent[0].t - t0;
  expect(after).toBeGreaterThanOrEqual(640); // 550 + the recognizer's 100 to end
  expect(after).toBeLessThan(800); // was 850
});

test("words the recognizer still held (their interim came with the last final, so never shown) join the turn", async () => {
  ctl.heldWords = "nasılsın";
  await finalPhrase("Merhaba Luna");
  await wait(900);
  expect(sentTexts()).toEqual(["Merhaba Luna nasılsın"]);
});

test("...also when they come on their own, after the recognizer's own silence wait", async () => {
  ctl.endAfterStopMs = null; // answers its stop() with nothing — the late final comes regardless
  await finalPhrase("Merhaba Luna");
  await wait(700);
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  await act(async () => { ctl.call.handleFinal("nasılsın", undefined); });
  expect(sentTexts()).toEqual(["Merhaba Luna nasılsın"]);
  await wait(1200);
  expect(sentTexts()).toEqual(["Merhaba Luna nasılsın"]);
});

test("a recognizer that never answers its stop(): the turn still goes 850 ms after the final, as before", async () => {
  ctl.endAfterStopMs = null;
  const t0 = Date.now();
  await finalPhrase("bugün yorgunum");
  await wait(780);
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  await wait(250);
  expect(sentTexts()).toEqual(["bugün yorgunum"]);
  expect(ctl.sent[0].t - t0).toBeGreaterThanOrEqual(840);
});

test("while words are still coming (an interim) it waits 850 ms, then asks for the final", async () => {
  ctl.endAfterStopMs = null;
  await finalPhrase("bir şey");
  await wait(100);
  await act(async () => ctl.patchSpeech({ interim: "daha" }));
  await wait(650); // past 550 after the final, under 850 after the interim
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  expect(ctl.speech.stop).not.toHaveBeenCalled();
  await wait(300);
  expect(ctl.speech.stop).toHaveBeenCalledTimes(1); // the half phrase is finished first
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  await finalPhrase("daha var");
  expect(sentTexts()).toEqual(["bir şey daha var"]);
});

test("a turn held by the previous one keeps the mic open and goes the moment `sending` clears — no poll", async () => {
  await act(async () => ctl.setSending(true)); // e.g. a reply you just cut off is still letting go
  await finalPhrase("dur bir dakika");
  await wait(900);
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  expect(ctl.speech.stop).not.toHaveBeenCalled(); // (you may go on talking meanwhile)
  const t1 = Date.now();
  await act(async () => ctl.setSending(false));
  expect(sentTexts()).toEqual(["dur bir dakika"]);
  expect(ctl.sent[0].t - t1).toBeLessThan(50);
});

test("a turn held by a transcription goes the moment it is in", async () => {
  await act(async () => ctl.patchSpeech({ transcribing: true }));
  await finalPhrase("bugün hava nasıl");
  await wait(700);
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  const t1 = Date.now();
  await act(async () => ctl.patchSpeech({ transcribing: false }));
  expect(sentTexts()).toEqual(["bugün hava nasıl"]);
  expect(ctl.sent[0].t - t1).toBeLessThan(50);
});

test("talking again while held: the silence decides again, not the hold", async () => {
  await act(async () => ctl.setSending(true));
  await finalPhrase("bir");
  await wait(650); // held now
  await act(async () => ctl.patchSpeech({ interim: "iki" })); // still talking
  await act(async () => ctl.setSending(false));
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  await finalPhrase("iki üç");
  await wait(450);
  expect(ctl.sendTurn).not.toHaveBeenCalled();
  await wait(350);
  expect(sentTexts()).toEqual(["bir iki üç"]);
});

test("her 'hmm' fades out as soon as piece 0 is ready; her first word follows after a breath", async () => {
  ctl.fillerChance = 1; // (the clips were preloaded when the call opened)
  const deferred = [];
  api.fetchTTS.mockImplementation(({ part }) => new Promise((resolve) => deferred.push({ part, resolve })));
  await finalPhrase("anlat bakalım");
  await wait(750);
  expect(ctl.sent).toHaveLength(1);
  await wait(750); // FILLER_DELAY_MS (650) after the send: the "hmm" starts
  const start = audioMock.__log.find((e) => e.kind === "filler.start");
  expect(start).toBeTruthy();
  expect(ctl.call.modalProps.state).toBe("thinking");
  const gen = ctl.call.generation();
  const { turnId } = ctl.sent[0];
  await act(async () => {
    ctl.call.onReplyStart(gen, turnId);
    ctl.call.onReplyDelta("Bugün seninle konuşmak çok güzel! Nasıl geçti günün, anlatır mısın bana biraz?", gen);
  });
  expect(deferred.map((d) => d.part)).toEqual([0]);
  await wait(100);
  const tReady = Date.now();
  await act(async () => { deferred[0].resolve("blob:piece0"); });
  const stop = audioMock.__log.find((e) => e.kind === "filler.stop");
  expect(stop).toBeTruthy();
  expect(stop.t - tReady).toBeLessThan(50);
  expect(stop.ms).toBeCloseTo(60, 0); // the filler's own short fade
  await wait(400);
  const first = played.find((p) => p.src === "blob:piece0");
  expect(first).toBeTruthy();
  const after = first.t - tReady;
  const naturalEnd = start.t + 1000 + 120 - tReady; // the clip's end + the breath
  expect(after).toBeGreaterThanOrEqual(170); // fade 60 + breath 120
  expect(after).toBeLessThan(naturalEnd - 200);
  expect(ctl.call.modalProps.state).toBe("speaking");
});

test("piece 0 ready before any 'hmm': none starts later", async () => {
  ctl.fillerChance = 1;
  const deferred = [];
  api.fetchTTS.mockImplementation(({ part }) => new Promise((resolve) => deferred.push({ part, resolve })));
  await finalPhrase("selam");
  await wait(750);
  expect(ctl.sent).toHaveLength(1);
  const gen = ctl.call.generation();
  const { turnId } = ctl.sent[0];
  await act(async () => {
    ctl.call.onReplyStart(gen, turnId);
    ctl.call.onReplyDelta("Selam! Seni duymak gerçekten çok güzel, nasılsın bugün? Anlat bakalım.", gen);
  });
  await act(async () => { deferred[0].resolve("blob:piece0b"); });
  await wait(900);
  expect(audioMock.__log.filter((e) => e.kind === "filler.start")).toHaveLength(0);
  expect(played.some((p) => p.src === "blob:piece0b")).toBe(true);
});
