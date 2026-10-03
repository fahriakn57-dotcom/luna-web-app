/* global describe, test, expect, jest, beforeAll, beforeEach, afterEach, require */
// lib/api.js streamChat (POST /api/chat/stream) — run with:
//   CI=true npx craco test --watchAll=false src/lib/api.streamChat
import { TextDecoder, TextEncoder } from "util";

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), interceptors: { response: { use: jest.fn() } } },
}));

let streamChat;
beforeAll(() => {
  process.env.REACT_APP_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://luna.test";
  if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  ({ streamChat } = require("./api"));
});

const ARGS = { message: "selam", mode: "friend", lang: "tr", conversationId: null, mood: null };
const encoder = new TextEncoder();
const data = (event) => `data: ${JSON.stringify(event)}\n\n`;
const delta = (text) => data({ type: "assistant_delta", text });

// fetch answering with these SSE chunks, then: the end of the stream, a
// dropped connection (end: "drop"), or silence until aborted (end: "hang").
function serve(chunks, { end = "done" } = {}) {
  const requests = [];
  window.fetch = jest.fn(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const queue = [...chunks];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: () => {
            if (queue.length) return Promise.resolve({ value: encoder.encode(queue.shift()), done: false });
            if (end === "drop") return Promise.reject(new TypeError("network error"));
            if (end === "hang") {
              return new Promise((_, reject) => init.signal.addEventListener("abort", () => (
                reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          cancel: () => Promise.resolve(),
        }),
      },
    };
  });
  return requests;
}

async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

describe("streamChat", () => {
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.fetch;
  });

  test("a typed turn asks for stream: true, skips keep-alives and resolves with the whole reply", async () => {
    const requests = serve([
      ": keep-alive\n\n",
      delta("Mer"),
      delta("haba").slice(0, 10), // a frame split across two reads
      delta("haba").slice(10),
      data({ type: "assistant_completed", reply: "Merhaba", message_id: "m1", degraded: false }),
    ]);
    const deltas = [];
    const reply = await streamChat({ ...ARGS, idempotencyKey: "text-k1", onDelta: (t) => deltas.push(t) });
    expect(reply).toBe("Merhaba");
    expect(deltas).toEqual(["Mer", "haba"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/api\/chat\/stream$/);
    expect(requests[0].body).toEqual(expect.objectContaining({ text: "selam", voice: false, stream: true }));
    expect(requests[0].init.headers["X-Idempotency-Key"]).toBe("text-k1");
  });

  test("a spoken turn sends voice: true and no stream field (unchanged)", async () => {
    const requests = serve([delta("Selam!"), data({ type: "assistant_completed", reply: "Selam!", message_id: "m1" })]);
    expect(await streamChat({ ...ARGS, voice: true, onDelta: () => {} })).toBe("Selam!");
    expect(requests[0].body.voice).toBe(true);
    expect(requests[0].body).not.toHaveProperty("stream");
  });

  test("the help card comes with assistant_completed", async () => {
    const safety = { kind: "self_harm", resources: [{ name: "112" }] };
    serve([delta("Buradayım."), data({ type: "assistant_completed", reply: "Buradayım.", message_id: "m1", safety })]);
    const onSafety = jest.fn();
    expect(await streamChat({ ...ARGS, onDelta: () => {}, onSafety })).toBe("Buradayım.");
    expect(onSafety).toHaveBeenCalledWith(safety);
  });

  test("a flagged turn the server failed mid-reply brings the reply it kept and the help card", async () => {
    const safety = { kind: "self_harm", resources: [{ name: "112" }] };
    serve([delta("Seni duyuyorum,"), data({ type: "task_failed", error: "stream_interrupted", status: 502,
      detail: "Şu an cevap veremiyorum", reply: "Yanındayım. 112'yi arayabilirsin.", safety })]);
    const onSafety = jest.fn();
    const { error } = await outcome(streamChat({ ...ARGS, onDelta: () => {}, onSafety }));
    expect(error.response.status).toBe(502);
    expect(error.reply).toBe("Yanındayım. 112'yi arayabilirsin.");
    expect(onSafety).toHaveBeenCalledWith(safety);
    expect(error.canFallBack).toBeFalsy();
    expect(error.resumable).toBeFalsy(); // the server ended this turn: never asked again
  });

  test("an ordinary stream_interrupted carries no reply", async () => {
    serve([delta("Merhaba,"), data({ type: "task_failed", error: "stream_interrupted", status: 502, detail: "x" })]);
    const onSafety = jest.fn();
    const { error } = await outcome(streamChat({ ...ARGS, onDelta: () => {}, onSafety }));
    expect(error.response.status).toBe(502);
    expect(error.reply).toBeUndefined();
    expect(onSafety).not.toHaveBeenCalled();
  });

  test("a connection dropped after part of the reply is resumable, not a fallback", async () => {
    serve([delta("Yarım")], { end: "drop" });
    const { error } = await outcome(streamChat({ ...ARGS, onDelta: () => {} }));
    expect(error.resumable).toBe(true);
    expect(error.canFallBack).toBe(false);
  });

  test("a connection dropped before any of the reply can fall back", async () => {
    serve([], { end: "drop" });
    const { error } = await outcome(streamChat({ ...ARGS, onDelta: () => {} }));
    expect(error.canFallBack).toBe(true);
    expect(error.resumable).toBe(true);
  });

  test.each([[false, 45000], [true, 15000]])("gives up after the idle time (voice: %s -> %i ms)", async (voice, idleMs) => {
    jest.useFakeTimers();
    serve([], { end: "hang" });
    let result = null;
    streamChat({ ...ARGS, voice, onDelta: () => {} }).then(
      (value) => { result = { value }; },
      (error) => { result = { error }; },
    );
    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await flush();
    jest.advanceTimersByTime(idleMs - 1);
    await flush();
    expect(result).toBeNull();
    jest.advanceTimersByTime(1);
    await flush();
    expect(result.error.name).toBe("TimeoutError");
    expect(result.error.canFallBack).toBe(false); // the server may still be writing it
    expect(result.error.resumable).toBe(true);
  });

  test("a 429 keeps its Retry-After (a short wait, not a usage limit)", async () => {
    window.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: (h) => (h === "Retry-After" ? "5" : null) },
      json: async () => ({ detail: "Aynı anda çok fazla istek işleniyor, birazdan tekrar dene" }),
    }));
    const { error } = await outcome(streamChat({ ...ARGS, onDelta: () => {} }));
    expect(error.response.status).toBe(429);
    expect(error.response.headers["retry-after"]).toBe("5");
    expect(error.canFallBack).toBe(false);
    expect(error.resumable).toBeFalsy();
  });
});
