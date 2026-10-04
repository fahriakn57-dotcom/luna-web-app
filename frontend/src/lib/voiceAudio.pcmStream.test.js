/* global describe, test, expect, jest, beforeEach, afterEach, require */
// lib/voiceAudio.js — her voice streamed as raw PCM (createPcmStream) and
// where that is used (streamingVoiceSupported). Run with:
//   CI=true npx craco test --watchAll=false src/lib/voiceAudio.pcmStream
// The AudioContext is a fake whose clock only moves when a test moves it
// (lib/fakeAudioContext.testkit.js).

import { FakeContext, RATE, audio, pcm } from "./fakeAudioContext.testkit";

// A fresh lib/voiceAudio.js with its context made (as opening the call does).
function load() {
  let mod;
  jest.isolateModules(() => {
    mod = require("./voiceAudio");
  });
  mod.primeVoiceAudio();
  return { va: mod, ctx: FakeContext.last };
}

const played = (ctx) => ctx.played();
const samplesOf = (src) => Array.from(src.buffer.getChannelData(0));

function callbacks() {
  const log = [];
  return {
    log,
    on: {
      onStart: () => log.push("start"),
      onEnd: () => log.push("end"),
      onPause: () => log.push("pause"),
      onError: (e) => log.push(`error:${e.message}`),
    },
  };
}

let savedAudioContext;
beforeEach(() => {
  savedAudioContext = window.AudioContext;
  window.AudioContext = FakeContext;
});
afterEach(() => {
  window.AudioContext = savedAudioContext;
});

describe("createPcmStream", () => {
  test("a sample split across two reads (an odd byte) is joined, not shifted", () => {
    const { va, ctx } = load();
    const values = [1000, -2, 32767, -32768, 12345, -300];
    const bytes = pcm(values);
    const s = va.createPcmStream(RATE);
    s.push(bytes.slice(0, 3)); // one sample and a half
    s.push(bytes.slice(3, 4)); // ...its other half alone
    s.push(bytes.slice(4, 9)); // two and a half
    s.push(bytes.slice(9));
    s.end();
    expect(Array.from(new Uint8Array(s.pcm16()))).toEqual(Array.from(bytes));
    const { on } = callbacks();
    s.play(null, on);
    expect(played(ctx)).toHaveLength(1);
    expect(samplesOf(played(ctx)[0])).toEqual(values.map((x) => x / 32768));
  });

  test("an odd byte left at the very end is dropped (half a sample)", () => {
    const { va } = load();
    const s = va.createPcmStream(RATE);
    s.push(new Uint8Array([0x10, 0x00, 0x20]));
    s.end();
    expect(Array.from(new Uint8Array(s.pcm16()))).toEqual([0x10, 0x00]);
  });

  test("holds a short cushion, then plays blocks back to back on the context's clock (gapless)", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    const output = { name: "analyser" };
    ctx.currentTime = 5;
    s.play(output, on);
    s.push(audio(0.05));
    expect(played(ctx)).toHaveLength(0); // under the cushion: nothing yet
    expect(log).toEqual([]);
    s.push(audio(0.1));
    expect(played(ctx)).toHaveLength(1);
    expect(log).toEqual(["start"]);
    const [first] = played(ctx);
    expect(first.at).toBeCloseTo(5.03, 9); // a little ahead of "now"
    expect(first.buffer.length).toBe(0.15 * RATE); // all that was held
    expect(first.output).toBe(output); // through her analyser
    ctx.currentTime = 5.05;
    s.push(audio(0.04));
    ctx.currentTime = 5.08;
    s.push(audio(0.2));
    const blocks = played(ctx);
    expect(blocks).toHaveLength(3);
    for (let k = 1; k < blocks.length; k++) {
      expect(blocks[k].at).toBeCloseTo(blocks[k - 1].at + blocks[k - 1].buffer.duration, 9);
    }
    expect(log).toEqual(["start"]); // started once
  });

  test("a tiny read waits to join the next one (alone it would click) — unless the audio is about to run out", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    s.play(null, callbacks().on);
    s.push(audio(0.2)); // 0.03 .. 0.23
    s.push(pcm([5, 6, 7]));
    expect(played(ctx)).toHaveLength(1);
    s.push(audio(0.1));
    expect(played(ctx)).toHaveLength(2);
    expect(played(ctx)[1].buffer.length).toBe(3 + 0.1 * RATE); // one block
    expect(played(ctx)[1].at).toBeCloseTo(0.23, 9);
    ctx.currentTime = 0.3; // 0.03 s still ahead
    s.push(pcm([8]));
    expect(played(ctx)).toHaveLength(3);
    expect(played(ctx)[2].at).toBeCloseTo(0.23 + (3 + 0.1 * RATE) / RATE, 9); // right after the block before
    s.push(pcm([9, 10]));
    expect(played(ctx)).toHaveLength(4); // (still under 0.05 s ahead)
    ctx.currentTime = 0;
    const t = va.createPcmStream(RATE);
    t.play(null, callbacks().on);
    t.push(audio(0.2));
    t.push(pcm([1, 2]));
    t.end(); // nothing more is coming: the last bit goes as it is
    expect(played(ctx)).toHaveLength(6);
  });

  test("a block due on one of the context's frames starts a hair under it, never a hair over (Chrome would start it a frame late)", () => {
    const { va, ctx } = load(); // 48 kHz
    ctx.currentTime = (100000 + 3e-7) / 48000 - 0.03; // due a float's hair past frame 100000
    const s = va.createPcmStream(RATE);
    s.play(null, callbacks().on);
    s.push(audio(0.2));
    const [b] = played(ctx);
    expect(b.at * 48000).toBeLessThan(100000);
    expect(Math.ceil(b.at * 48000)).toBe(100000);
    ctx.sampleRate = 44100; // due between two frames: left as it is
    const t = va.createPcmStream(RATE);
    ctx.currentTime = 1000.5 / 44100 - 0.03;
    t.play(null, callbacks().on);
    t.push(audio(0.2));
    expect(played(ctx)[1].at).toBe(ctx.currentTime + 0.03);
  });

  test("ends when the last scheduled block has finished — and only once the stream is complete", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.play(null, on);
    s.push(audio(0.2));
    s.push(audio(0.1));
    const end = 0.03 + 0.3;
    ctx.advance(end + 0.01);
    expect(log).toEqual(["start"]); // played it all, but more may come
    s.push(audio(0.3)); // ...and it does: the cushion again, then on
    const blocks = played(ctx);
    expect(blocks).toHaveLength(3);
    expect(blocks[2].at).toBeCloseTo(end + 0.01 + 0.03, 9);
    s.end();
    ctx.advance(blocks[2].at + 0.3 - 0.001);
    expect(log).toEqual(["start"]);
    ctx.advance(blocks[2].at + 0.3);
    expect(log).toEqual(["start", "end"]);
    expect(s.progress()).toBe(1);
  });

  test("a clip shorter than the cushion plays once the stream is complete", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.play(null, on);
    s.push(audio(0.05));
    expect(played(ctx)).toHaveLength(0);
    s.end();
    expect(played(ctx)).toHaveLength(1);
    ctx.advance(1);
    expect(log).toEqual(["start", "end"]);
  });

  test("audio that came before play() is all played from its start", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    s.push(audio(0.5));
    s.end();
    const { log, on } = callbacks();
    s.play(null, on);
    expect(played(ctx)).toHaveLength(1);
    expect(played(ctx)[0].buffer.length).toBe(0.5 * RATE);
    ctx.advance(0.53);
    expect(log).toEqual(["start", "end"]);
  });

  test("stop() silences every scheduled block at once, with no callback", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.play(null, on);
    s.push(audio(0.2));
    s.push(audio(0.2));
    expect(played(ctx)).toHaveLength(2);
    s.stop();
    expect(played(ctx).every((b) => b.stopped && b.onended === null)).toBe(true);
    s.push(audio(0.2)); // (whatever still arrives is never heard)
    s.end();
    ctx.advance(5);
    expect(played(ctx)).toHaveLength(2);
    expect(log).toEqual(["start"]);
  });

  test("pause() stops where it was; play() goes on from there", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.push(audio(0.5));
    s.end();
    s.play(null, on);
    ctx.advance(0.03 + 0.2); // 0.2 s heard
    expect(s.progress()).toBeCloseTo(0.4, 3);
    s.pause();
    expect(log).toEqual(["start", "pause"]);
    expect(played(ctx)[0].stopped).toBe(true);
    ctx.advance(3);
    s.play(null, on);
    const again = played(ctx)[1];
    expect(again.buffer.length).toBe(0.3 * RATE); // the rest
    expect(again.buffer.getChannelData(0)[0]).toBe(samplesOf(played(ctx)[0])[0.2 * RATE]);
    ctx.advance(again.at + 0.3);
    expect(log).toEqual(["start", "pause", "start", "end"]);
  });

  test("the context stopping under it (the system took the audio) pauses it", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.play(null, on);
    s.push(audio(0.4));
    ctx.advance(0.13);
    ctx.setState("suspended");
    expect(log).toEqual(["start", "pause"]);
    expect(played(ctx)[0].stopped).toBe(true);
    expect(s.progress()).toBeCloseTo(0.1 / 0.4, 3);
    expect(ctx.listeners).toHaveLength(0); // (it no longer listens)
  });

  test("progress(expectS): until all of it came, of the estimate or of what came (the longer); then of the whole clip", () => {
    const { va, ctx } = load();
    const s = va.createPcmStream(RATE);
    s.play(null, callbacks().on);
    s.push(audio(0.4));
    ctx.advance(0.03 + 0.1); // 0.1 s heard
    expect(s.progress()).toBeCloseTo(0.1 / 0.4, 6); // (no estimate: of what came)
    expect(s.progress(2)).toBeCloseTo(0.1 / 2, 6);
    expect(s.progress(0.2)).toBeCloseTo(0.1 / 0.4, 6); // an estimate under what came already
    s.push(audio(0.6));
    s.end();
    expect(s.progress(2)).toBeCloseTo(0.1 / 1, 6); // complete: its real length
  });

  test("a block that can't be scheduled reports an error instead of hanging", () => {
    const { va, ctx } = load();
    ctx.createBuffer = () => { throw new Error("NotSupportedError"); };
    const s = va.createPcmStream(RATE);
    const { log, on } = callbacks();
    s.play(null, on);
    s.push(audio(0.2));
    expect(log).toEqual(["error:NotSupportedError"]);
  });
});

describe("streamingVoiceSupported", () => {
  let saved;
  beforeEach(() => {
    saved = { ReadableStream: window.ReadableStream, Response: window.Response, ua: navigator.userAgent };
    window.ReadableStream = function ReadableStream() {};
    window.Response = function Response() {};
    window.Response.prototype.body = null;
  });
  afterEach(() => {
    window.ReadableStream = saved.ReadableStream;
    window.Response = saved.Response;
    Object.defineProperty(window.navigator, "userAgent", { value: saved.ua, configurable: true });
  });

  test("with a running context and a readable response body", () => {
    const { va, ctx } = load();
    expect(va.streamingVoiceSupported()).toBe(true);
    ctx.state = "suspended";
    expect(va.streamingVoiceSupported()).toBe(false);
  });

  test("not before the context was made", () => {
    let mod;
    jest.isolateModules(() => {
      mod = require("./voiceAudio");
    });
    expect(mod.streamingVoiceSupported()).toBe(false);
  });

  test("not where a response body can't be read as it comes", () => {
    const { va } = load();
    delete window.ReadableStream;
    expect(va.streamingVoiceSupported()).toBe(false);
  });

  test("never on iOS (the ring switch mutes the audio graph)", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    const { va } = load();
    expect(va.streamingVoiceSupported()).toBe(false);
  });
});
