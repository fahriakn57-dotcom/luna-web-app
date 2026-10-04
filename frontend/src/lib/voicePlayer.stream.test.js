/* global describe, test, expect, jest, beforeAll, beforeEach, require */
// lib/voicePlayer.js — pieces of her voice streamed as PCM (speak()'s
// fetchStream, POST /api/tts/stream) where her voice plays through Web Audio,
// and the whole-clip path (fetchPiece, /api/tts) everywhere else. Run with:
//   CI=true npx craco test --watchAll=false src/lib/voicePlayer.stream
// The real voicePlayer and voiceAudio; the AudioContext is a fake whose clock
// only moves when a test moves it (lib/fakeAudioContext.testkit.js), the
// device's voice a fake.
import { FakeContext, RATE, audio, firstValue } from "./fakeAudioContext.testkit";

// The app's "@/" alias is webpack's, not Jest's (see hooks/useVoiceCall.test.js).
jest.mock("@/lib/voiceAudio", () => jest.requireActual("./voiceAudio"), { virtual: true });
const mockDevice = { supported: false, said: [] };
jest.mock("@/lib/browserVoice", () => ({
  browserVoiceSupported: () => mockDevice.supported,
  sayWithBrowser: (text, opts) => {
    mockDevice.said.push(text);
    return { cancel() {}, resumeAt: () => 0, position: () => 0, opts };
  },
  unlockBrowserVoice: () => {},
}), { virtual: true });

let va;
let createVoicePlayer;
let ctx;
const media = []; // the element's play() calls: {el, src}
const blobs = [];

const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

function installBrowser() {
  window.AudioContext = FakeContext;
  window.ReadableStream = function ReadableStream() {};
  window.Response = function Response() {};
  window.Response.prototype.body = null;
}

beforeAll(() => {
  installBrowser();
  window.HTMLMediaElement.prototype.play = function play() {
    media.push({ el: this, src: this.src });
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() {};
  window.HTMLMediaElement.prototype.load = function load() {};
  URL.createObjectURL = (b) => {
    blobs.push(b);
    return `blob:made-${blobs.length}`;
  };
  URL.revokeObjectURL = () => {};
  va = require("@/lib/voiceAudio");
  ({ createVoicePlayer } = require("./voicePlayer"));
  va.primeVoiceAudio(); // (opening the call)
  ctx = FakeContext.last;
});

beforeEach(() => {
  installBrowser();
  ctx.reset();
  media.length = 0;
  blobs.length = 0;
  mockDevice.supported = false;
  mockDevice.said.length = 0;
});

// A PCM stream the test feeds: push(bytes), end(), fail(error). A cancelled
// request makes a waiting read fail, as a real fetch body does.
function makeStream(signal) {
  const queue = [];
  let waiter = null;
  let failure = null;
  let ended = false;
  const st = { canceled: false };
  const settle = () => {
    if (!waiter) return;
    const w = waiter;
    if (queue.length) {
      waiter = null;
      w.resolve({ value: queue.shift(), done: false });
    } else if (failure) {
      waiter = null;
      w.reject(failure);
    } else if (ended) {
      waiter = null;
      w.resolve({ value: undefined, done: true });
    }
  };
  st.reader = {
    read: () => new Promise((resolve, reject) => {
      waiter = { resolve, reject };
      settle();
    }),
    cancel: () => {
      st.canceled = true;
      return Promise.resolve();
    },
  };
  st.push = (bytes) => { queue.push(bytes); settle(); };
  st.end = () => { ended = true; settle(); };
  st.fail = (e) => { failure = e; settle(); };
  signal.addEventListener("abort", () => st.fail(Object.assign(new Error("aborted"), { name: "AbortError" })));
  return st;
}

// fetchStream / fetchPiece fakes: every call is kept with its stream and
// how to answer it.
function fakeFetches() {
  const streams = [];
  const unary = [];
  return {
    streams,
    unary,
    fetchStream: (i, signal) => new Promise((resolve, reject) => {
      const st = makeStream(signal);
      streams.push({
        i, signal, st, reject,
        open: () => resolve({ reader: st.reader, rate: RATE }), // its first audio is there
        whole: (url) => resolve({ url }),                     // the server's cache: MP3
      });
    }),
    fetchPiece: (i, signal) => new Promise((resolve, reject) => {
      unary.push({ i, signal, resolve, reject });
    }),
  };
}

function events() {
  const log = [];
  return {
    log,
    on: {
      onPieceReady: (i) => log.push(`ready:${i}`),
      onPlaying: (i) => log.push(`playing:${i}`),
      onPaused: () => log.push("paused"),
      onDone: () => log.push("done"),
      onFailed: (i, e) => log.push(`failed:${i}:${e?.name || e?.message}`),
    },
  };
}

const pieces = (...texts) => texts.map((text) => ({ text, url: null }));
// speak(), and let its first requests go out (they leave a moment later).
async function speak(player, args) {
  player.speak(args);
  await flush();
}
const endOf = (src) => src.at + src.buffer.duration;
const lastBlock = () => ctx.played()[ctx.played().length - 1];
const blobOf = (url) => blobs[Number(/^blob:made-(\d+)$/.exec(url)[1]) - 1];

function readBlob(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.readAsArrayBuffer(blob);
  });
}

describe("streamed pieces", () => {
  test("a piece plays from its first audio, through her analyser, and ends after its last block", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Merhaba!"), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    expect(f.streams.map((c) => c.i)).toEqual([0]);
    expect(f.unary).toHaveLength(0);
    f.streams[0].open();
    await flush();
    expect(ev.log).toEqual(["ready:0"]);
    f.streams[0].st.push(audio(0.2));
    await flush();
    expect(ev.log).toEqual(["ready:0", "playing:0"]);
    const [first] = ctx.played();
    expect(first.output).toBe(ctx.analysers[0]); // the visuals' analyser
    expect(player.analyser()).toBe(ctx.analysers[0]);
    f.streams[0].st.push(audio(0.3));
    f.streams[0].st.end();
    await flush();
    ctx.advance(endOf(lastBlock()) - 0.001);
    expect(ev.log).not.toContain("done");
    expect(player.active()).toBe(true);
    ctx.advance(endOf(lastBlock()));
    expect(ev.log).toEqual(["ready:0", "playing:0", "done"]);
    expect(player.active()).toBe(false);
  });

  test("in order, two in flight: a streamed piece is in flight until all of it came, and the next never starts before it ends", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki.", "Üç."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    expect(f.streams.map((c) => c.i)).toEqual([0, 1]);
    const [s0, s1] = f.streams;
    s0.open();
    s0.st.push(audio(0.3, 1000));
    await flush();
    expect(ev.log).toEqual(["ready:0", "playing:0"]);
    expect(f.streams).toHaveLength(2); // piece 0 is still coming: still in flight
    s1.open();
    s1.st.push(audio(0.4, 2000));
    s1.st.end();
    await flush();
    expect(f.streams.map((c) => c.i)).toEqual([0, 1, 2]); // piece 1 all came: its slot is free
    expect(ctx.played().map(firstValue)).toEqual([1000]); // piece 1 waits for piece 0
    s0.st.push(audio(0.2, 1000));
    s0.st.end();
    await flush();
    expect(ctx.played().map(firstValue)).toEqual([1000, 1000]);
    const end0 = endOf(lastBlock());
    ctx.advance(end0 - 0.001);
    expect(ctx.played().map(firstValue)).toEqual([1000, 1000]);
    ctx.advance(end0);
    expect(ctx.played().map(firstValue)).toEqual([1000, 1000, 2000]);
    expect(lastBlock().at).toBeGreaterThanOrEqual(end0);
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1", "playing:1"]);
    f.streams[2].open();
    f.streams[2].st.push(audio(0.1, 3000));
    f.streams[2].st.end();
    await flush();
    ctx.advance(endOf(lastBlock()));
    ctx.advance(endOf(lastBlock()));
    expect(ctx.played().map(firstValue)).toEqual([1000, 1000, 2000, 3000]);
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1", "playing:1", "ready:2", "playing:2", "done"]);
  });

  test("the whole clip becomes the piece's url (a WAV), and \"Tekrar dinle\" plays it from the element", async () => {
    const f = fakeFetches();
    const player = createVoicePlayer();
    const reply = pieces("Merhaba!");
    await speak(player, { pieces: reply, fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    const a = audio(0.1);
    const b = audio(0.05, 77);
    f.streams[0].open();
    f.streams[0].st.push(a.slice(0, 1001)); // (an odd split)
    f.streams[0].st.push(a.slice(1001));
    f.streams[0].st.push(b);
    expect(reply[0].url).toBeNull();
    f.streams[0].st.end();
    await flush();
    expect(reply[0].url).toBe(`blob:made-${blobs.length}`);
    const wav = blobs[blobs.length - 1];
    expect(wav.type).toBe("audio/wav");
    const bytes = await readBlob(wav);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(RATE);
    expect(Array.from(bytes.slice(44))).toEqual([...a, ...b]);
    ctx.advance(10);
    expect(player.active()).toBe(false);

    player.speak({ pieces: reply, fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    expect(media.map((m) => m.src)).toEqual([reply[0].url]); // at once (inside the tap)
    await flush();
    expect(f.streams).toHaveLength(1); // nothing fetched again
  });

  test("the audio ran dry just before the body's end: the piece ends right then, and its WAV is kept (the reply's last one too)", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    const reply = pieces("Bir.", "İki.", "Üç.");
    await speak(player, { pieces: reply, fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    const [s0, s1] = f.streams;
    const a0 = audio(0.3, 1000);
    s0.open();
    s0.st.push(a0);
    await flush();
    s1.open();
    s1.st.push(audio(0.3, 2000));
    await flush();
    ctx.advance(endOf(lastBlock())); // all of piece 0 heard, its body not over yet
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1"]);
    expect(player.active()).toBe(true);
    s0.st.end();
    await flush();
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1", "playing:1"]);
    expect(f.streams.map((c) => c.i)).toEqual([0, 1, 2]);
    expect(Array.from((await readBlob(blobOf(reply[0].url))).slice(44))).toEqual([...a0]);

    const a2 = audio(0.2, 3000);
    f.streams[2].open();
    f.streams[2].st.push(a2);
    s1.st.end();
    await flush();
    ctx.advance(endOf(lastBlock())); // piece 1 over: piece 2 plays
    ctx.advance(endOf(lastBlock())); // ...all of it heard, its body not over yet
    expect(ctx.played().map(firstValue)).toEqual([1000, 2000, 3000]);
    expect(ev.log).not.toContain("done");
    f.streams[2].st.end();
    await flush();
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1", "playing:1", "ready:2", "playing:2", "done"]);
    expect(player.active()).toBe(false);
    expect(Array.from((await readBlob(blobOf(reply[2].url))).slice(44))).toEqual([...a2]);
  });

  test("a clip the server had whole (audio/mpeg) plays from the element as before", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    const reply = pieces("Merhaba!");
    await speak(player, { pieces: reply, fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].whole("blob:cached-mp3");
    await flush();
    expect(reply[0].url).toBe("blob:cached-mp3");
    expect(media.map((m) => m.src)).toEqual(["blob:cached-mp3"]);
    expect(ctx.played()).toHaveLength(0);
    const { el } = media[0];
    el.dispatchEvent(new Event("playing"));
    el.dispatchEvent(new Event("ended"));
    expect(ev.log).toEqual(["ready:0", "playing:0", "done"]);
  });

  test("a streamed piece after a whole one waits for the element's end", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].whole("blob:cached-0");
    await flush();
    f.streams[1].open();
    f.streams[1].st.push(audio(0.3, 2000));
    f.streams[1].st.end();
    await flush();
    const { el } = media[0];
    el.dispatchEvent(new Event("playing"));
    expect(ctx.played()).toHaveLength(0); // piece 1 is all there, and waits
    ctx.currentTime = 2;
    el.dispatchEvent(new Event("ended"));
    expect(ctx.played().map(firstValue)).toEqual([2000]);
    expect(ctx.played()[0].at).toBeCloseTo(2.03, 9);
    ctx.advance(endOf(lastBlock()));
    expect(ev.log).toEqual(["ready:0", "ready:1", "playing:0", "playing:1", "done"]);
  });

  test("stopped (you cut her off): every block is silenced at once and the stream is let go", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    const reply = pieces("Uzun bir cümle.", "Bir tane daha.");
    await speak(player, { pieces: reply, fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.2));
    f.streams[0].st.push(audio(0.2));
    await flush();
    f.streams[1].open();
    f.streams[1].st.push(audio(0.3));
    await flush();
    expect(ctx.played()).toHaveLength(2);
    player.stop();
    expect(ctx.played().every((src) => src.stopped)).toBe(true);
    expect(f.streams.every((c) => c.signal.aborted)).toBe(true);
    await flush();
    ctx.advance(10);
    expect(ctx.played()).toHaveLength(2); // nothing more is heard
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1"]);
    expect(reply.map((p) => p.url)).toEqual([null, null]); // half clips are not kept
    expect(player.active()).toBe(false);
  });

  test("a stream that breaks while she says it ends her voice (as a broken clip) — never a hang", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.3));
    await flush();
    ctx.advance(0.1);
    f.streams[0].st.fail(new TypeError("network error"));
    await flush();
    expect(ctx.played().every((src) => src.stopped)).toBe(true);
    expect(ev.log).toEqual(["ready:0", "playing:0", "failed:0:TypeError"]);
    expect(player.active()).toBe(false);
    expect(f.streams).toHaveLength(2); // not asked again
    expect(f.streams[1].signal.aborted).toBe(true);
  });

  test("a stream that breaks before any of it was heard is asked for once more, then plays in its turn", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.3, 1000));
    await flush();
    f.streams[1].open();
    f.streams[1].st.push(audio(0.1, 2000));
    await flush();
    f.streams[1].st.fail(new TypeError("network error")); // piece 1, waiting its turn
    await flush();
    expect(f.streams.map((c) => c.i)).toEqual([0, 1, 1]);
    f.streams[2].open();
    f.streams[2].st.push(audio(0.2, 2100));
    f.streams[2].st.end();
    await flush();
    f.streams[0].st.end();
    await flush();
    ctx.advance(endOf(lastBlock()));
    expect(ctx.played().map(firstValue)).toEqual([1000, 2100]); // the broken one is never heard
    ctx.advance(endOf(lastBlock()));
    expect(ev.log).toEqual(["ready:0", "playing:0", "ready:1", "ready:1", "playing:1", "done"]);
  });

  test("...also the piece about to play, still building its cushion", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Merhaba!"), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.05)); // under the cushion: not heard yet
    await flush();
    f.streams[0].st.fail(new TypeError("network error"));
    await flush();
    expect(f.streams).toHaveLength(2);
    f.streams[1].open();
    f.streams[1].st.push(audio(0.2));
    f.streams[1].st.end();
    await flush();
    ctx.advance(endOf(lastBlock()));
    expect(ev.log).toEqual(["ready:0", "ready:0", "playing:0", "done"]);
  });

  test("a stream that stalls (the reader's TimeoutError) before it is heard: the device says that piece", async () => {
    mockDevice.supported = true;
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    await flush();
    f.streams[0].st.fail(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    await flush();
    expect(mockDevice.said).toEqual(["Bir."]);
    expect(f.streams.map((c) => c.i)).toEqual([0, 1]); // not asked again
  });

  test("the server's voice is busy (503 tts_busy, before any audio): the device says the piece, the next one streams", async () => {
    mockDevice.supported = true;
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    const busy = Object.assign(new Error("Request failed with status code 503"), {
      response: { status: 503, headers: { "retry-after": "60" }, data: { detail: "tts_busy" } },
      canFallBack: false,
    });
    f.streams[0].reject(busy);
    await flush();
    expect(mockDevice.said).toEqual(["Bir."]);
    expect(f.streams.map((c) => c.i)).toEqual([0, 1]); // asked once, as with /api/tts
    expect(f.unary).toHaveLength(0);
  });

  test("a usage limit (429) before any audio ends her voice: the call reads the answer out", async () => {
    mockDevice.supported = true;
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].reject(Object.assign(new Error("429"), { response: { status: 429, headers: {}, data: { detail: "limit" } } }));
    await flush();
    expect(ev.log).toEqual(["failed:0:Error"]);
    expect(mockDevice.said).toEqual([]);
  });

  test("a server without the streaming route: the piece is fetched whole at once, and so is every one after it", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].reject(Object.assign(new Error("404"), { response: { status: 404, headers: {}, data: { detail: "Not Found" } }, canFallBack: true }));
    await flush();
    expect(f.unary.map((c) => c.i)).toEqual([0]);
    f.unary[0].resolve("blob:whole-0");
    f.streams[1].open();
    f.streams[1].st.push(audio(0.2));
    f.streams[1].st.end();
    await flush();
    expect(media.map((m) => m.src)).toEqual(["blob:whole-0"]);
    // (Its next reply asks for none of them streamed.)
    player.stop();
    await speak(player, { pieces: pieces("Üç."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    expect(f.streams).toHaveLength(2);
    expect(f.unary.map((c) => c.i)).toEqual([0, 0]);
  });

  test("the system took the audio: \"Devam et\", and resume() goes on from where she was", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Merhaba!"), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.5));
    f.streams[0].st.end();
    await flush();
    ctx.advance(0.03 + 0.2);
    ctx.setState("suspended");
    expect(ev.log).toEqual(["ready:0", "playing:0", "paused"]);
    expect(ctx.played()[0].stopped).toBe(true);
    player.resume(); // (inside the tap)
    await flush();
    expect(ctx.state).toBe("running");
    const rest = lastBlock();
    expect(rest.buffer.length).toBe(0.3 * RATE);
    expect(ev.log).toEqual(["ready:0", "playing:0", "paused", "playing:0"]);
    ctx.advance(endOf(rest));
    expect(ev.log[ev.log.length - 1]).toBe("done");
  });

  test("pause() (headset) holds it where it was; resume() goes on", async () => {
    const f = fakeFetches();
    const ev = events();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Merhaba!"), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...ev.on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.4));
    f.streams[0].st.end();
    await flush();
    ctx.advance(0.13);
    player.pause();
    expect(ev.log).toEqual(["ready:0", "playing:0", "paused"]);
    player.resume();
    await flush();
    expect(lastBlock().buffer.length).toBe(0.3 * RATE);
    expect(ev.log).toEqual(["ready:0", "playing:0", "paused", "playing:0"]);
  });

  test("the captions follow the streamed piece as it is heard", async () => {
    const f = fakeFetches();
    const player = createVoicePlayer();
    const text = "Merhaba nasılsın"; // 16 characters
    await speak(player, { pieces: pieces(text), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    f.streams[0].open();
    f.streams[0].st.push(audio(1));
    f.streams[0].st.end();
    await flush();
    expect(player.said()).toBe(0);
    ctx.advance(0.03 + 0.5);
    expect(player.said()).toBeCloseTo(8, 5);
    ctx.advance(0.03 + 1);
    expect(player.said()).toBe(text.length + 1);
  });

  test("...and while the rest is still coming, against the whole clip's likely length — never ahead of her voice", async () => {
    const f = fakeFetches();
    const player = createVoicePlayer();
    const text = "Merhaba canım, bugün nasıl hissediyorsun"; // 40 characters: ~2.8 s
    await speak(player, { pieces: pieces(text), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    f.streams[0].open();
    f.streams[0].st.push(audio(0.8)); // (it comes 3-5x faster than she says it)
    await flush();
    ctx.advance(0.03 + 0.14);
    expect(player.said()).toBeCloseTo(40 * (0.14 / 2.8), 5); // not 40 * 0.14 / 0.8 = 7
    f.streams[0].st.push(audio(1.2));
    f.streams[0].st.end();
    await flush();
    ctx.advance(0.03 + 0.5);
    expect(player.said()).toBeCloseTo(40 * (0.5 / 2), 5); // all of it came: its real length
    ctx.advance(0.03 + 2);
    expect(player.said()).toBe(text.length + 1);
  });
});

describe("where the stream isn't used: /api/tts (fetchPiece) as before", () => {
  test("no fetchStream given", async () => {
    const f = fakeFetches();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir.", "İki."), fetchPiece: f.fetchPiece, ...events().on });
    expect(f.unary.map((c) => c.i)).toEqual([0, 1]);
    f.unary[0].resolve("blob:whole-0");
    await flush();
    expect(media.map((m) => m.src)).toEqual(["blob:whole-0"]);
  });

  test("no readable response body (no ReadableStream)", async () => {
    delete window.ReadableStream;
    const f = fakeFetches();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    expect(f.streams).toHaveLength(0);
    expect(f.unary.map((c) => c.i)).toEqual([0]);
  });

  test("the audio graph isn't running", async () => {
    ctx.state = "suspended";
    const f = fakeFetches();
    const player = createVoicePlayer();
    await speak(player, { pieces: pieces("Bir."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    expect(f.streams).toHaveLength(0);
    expect(f.unary.map((c) => c.i)).toEqual([0]);
  });

  test("iOS: always the <audio> element", async () => {
    // (lib/voiceAudio.js tells iOS by the user agent it was loaded with.)
    const ua = navigator.userAgent;
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    let iosAudio;
    let createIosPlayer;
    try {
      // Fresh modules (Jest 27's isolateModules would still hand out the
      // "@/" mock already made); the other tests keep the ones they hold.
      jest.resetModules();
      iosAudio = require("@/lib/voiceAudio");
      ({ createVoicePlayer: createIosPlayer } = require("./voicePlayer"));
    } finally {
      Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
    }
    iosAudio.primeVoiceAudio();
    expect(FakeContext.last.state).toBe("running"); // (the graph runs — it's iOS that rules the stream out)
    const f = fakeFetches();
    const player = createIosPlayer();
    player.speak({ pieces: pieces("Bir."), fetchPiece: f.fetchPiece, fetchStream: f.fetchStream, ...events().on });
    await flush();
    expect(f.streams).toHaveLength(0);
    expect(f.unary.map((c) => c.i)).toEqual([0]);
  });
});
