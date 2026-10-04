/* global describe, test, expect, jest, beforeAll, beforeEach, afterEach, require */
// lib/api.js fetchTTSStream (POST /api/tts/stream) — and fetchTTS left as it
// was. Run with:
//   CI=true npx craco test --watchAll=false src/lib/api.fetchTTSStream

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), interceptors: { response: { use: jest.fn() } } },
}));

let api;
let axios;
beforeAll(() => {
  process.env.REACT_APP_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://luna.test";
  api = require("./api");
  axios = require("axios").default;
});

const PCM_TYPE = "audio/l16; rate=24000; channels=1";

function headersOf(map) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (h) => lower[h.toLowerCase()] ?? null };
}

// fetch answering 200 with these body chunks, then: the end, a dropped
// connection (end: "drop"), or nothing more until aborted (end: "hang").
function serve(chunks, { type = PCM_TYPE, end = "done" } = {}) {
  const requests = [];
  const canceled = [];
  window.fetch = jest.fn(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const queue = [...chunks];
    return {
      ok: true,
      status: 200,
      headers: headersOf({ "Content-Type": type }),
      arrayBuffer: async () => new Uint8Array(chunks.flatMap((c) => Array.from(c))).buffer,
      body: {
        getReader: () => ({
          read: () => {
            if (init.signal.aborted) return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (end === "drop") return Promise.reject(new TypeError("network error"));
            if (end === "hang") {
              return new Promise((_, reject) => init.signal.addEventListener("abort", () => (
                reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          cancel: () => {
            canceled.push(true);
            return Promise.resolve();
          },
        }),
      },
    };
  });
  return { requests, canceled };
}

// fetch answering `status` with this body and these headers.
function answer(status, body, headers = {}) {
  window.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: headersOf(headers),
    text: async () => body,
  }));
}

async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

async function readAll(reader) {
  const got = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return got;
    got.push(Array.from(value));
  }
}

describe("fetchTTSStream", () => {
  let blobs;
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
    blobs = [];
    URL.createObjectURL = (b) => {
      blobs.push(b);
      return `blob:${blobs.length}`;
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.fetch;
  });

  test("posts fetchTTS's body with the device's auth, and hands over the PCM as it comes", async () => {
    const { requests } = serve([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const got = await api.fetchTTSStream({ text: "Merhaba!", turnId: "t-1", part: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/api\/tts\/stream$/);
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toEqual(expect.objectContaining({
      "X-Device-Id": "dev-1", "X-Device-Secret": "secret-1", "Content-Type": "application/json",
    }));
    expect(requests[0].body).toEqual({ text: "Merhaba!", voice: "coral", turn_id: "t-1", part: 2 });
    expect(got.rate).toBe(24000);
    expect(got.url).toBeUndefined();
    expect(await readAll(got.reader)).toEqual([[1, 2, 3], [4, 5]]);
  });

  test("no turn id: no turn_id / part, as fetchTTS", async () => {
    const { requests } = serve([]);
    await api.fetchTTSStream({ text: "Olur." });
    expect(requests[0].body).toEqual({ text: "Olur.", voice: "coral" });
  });

  test("a clip the server had whole (its cache) comes as an MP3 blob URL", async () => {
    serve([new Uint8Array([0xff, 0xfb, 0x90]), new Uint8Array([0x64])], { type: "audio/mpeg" });
    const got = await api.fetchTTSStream({ text: "Merhaba!" });
    expect(got).toEqual({ url: "blob:1" });
    expect(blobs[0].type).toBe("audio/mpeg");
    expect(blobs[0].size).toBe(4);
  });

  test.each([
    [503, JSON.stringify({ detail: "tts_busy" }), { "Retry-After": "60" }, { detail: "tts_busy" }, "60"],
    [429, JSON.stringify({ detail: "Bu ayki sesli kullanım hakkın doldu." }), {}, { detail: "Bu ayki sesli kullanım hakkın doldu." }, undefined],
    [400, JSON.stringify({ detail: "empty text" }), {}, { detail: "empty text" }, undefined],
    [502, JSON.stringify({ detail: "Ses üretilemedi" }), {}, { detail: "Ses üretilemedi" }, undefined],
    [502, "<html>Bad Gateway</html>", {}, "<html>Bad Gateway</html>", undefined],
  ])("an error before any audio (%i) fails as fetchTTS's axios error would", async (status, body, headers, data, retryAfter) => {
    answer(status, body, headers);
    const { error } = await outcome(api.fetchTTSStream({ text: "x", turnId: "t", part: 0 }));
    expect(error.response.status).toBe(status);
    expect(error.response.data).toEqual(data);
    expect(error.response.headers["retry-after"]).toBe(retryAfter);
    expect(error.canFallBack).toBe(false);
  });

  test.each([404, 405])("a server without the streaming route (%i) can fall back to fetchTTS", async (status) => {
    answer(status, JSON.stringify({ detail: "Not Found" }));
    const { error } = await outcome(api.fetchTTSStream({ text: "x" }));
    expect(error.response.status).toBe(status);
    expect(error.canFallBack).toBe(true);
  });

  test("an answer that is neither PCM nor MP3 can fall back too", async () => {
    serve([], { type: "text/html" });
    const { error } = await outcome(api.fetchTTSStream({ text: "x" }));
    expect(error.canFallBack).toBe(true);
  });

  test("a connection dropped mid-piece is an error of its reader", async () => {
    serve([new Uint8Array([1, 2])], { end: "drop" });
    const got = await api.fetchTTSStream({ text: "x" });
    await got.reader.read();
    const { error } = await outcome(got.reader.read());
    expect(error).toBeInstanceOf(TypeError);
  });

  test("no audio for 8 s: the stream is given up as a TimeoutError", async () => {
    jest.useFakeTimers();
    serve([new Uint8Array([1, 2])], { end: "hang" });
    const got = await api.fetchTTSStream({ text: "x" });
    await got.reader.read();
    let result = null;
    got.reader.read().then((v) => { result = { v }; }, (error) => { result = { error }; });
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    jest.advanceTimersByTime(7999);
    await flush();
    expect(result).toBeNull();
    jest.advanceTimersByTime(1);
    await flush();
    expect(result.error.name).toBe("TimeoutError");
  });

  test("the caller's signal cancels the body too (not a timeout)", async () => {
    serve([new Uint8Array([1, 2])], { end: "hang" });
    const ctl = new window.AbortController();
    const got = await api.fetchTTSStream({ text: "x", signal: ctl.signal });
    await got.reader.read();
    const pending = outcome(got.reader.read());
    ctl.abort();
    const { error } = await pending;
    expect(error.name).toBe("AbortError");
  });

  test("cancel() lets the body go", async () => {
    const { canceled } = serve([new Uint8Array([1, 2])], { end: "hang" });
    const got = await api.fetchTTSStream({ text: "x" });
    await got.reader.cancel();
    expect(canceled).toEqual([true]);
    expect(window.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

describe("fetchTTS (unchanged)", () => {
  test("still POST /api/tts with axios, the MP3 as a blob URL", async () => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
    const blobs = [];
    URL.createObjectURL = (b) => {
      blobs.push(b);
      return "blob:mp3";
    };
    axios.post.mockResolvedValue({ data: { audio_base64: btoa("ID3"), format: "mp3" } });
    window.fetch = jest.fn();
    const url = await api.fetchTTS({ text: "Merhaba!", turnId: "t-1", part: 1 });
    expect(url).toBe("blob:mp3");
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/api\/tts$/),
      { text: "Merhaba!", voice: "coral", turn_id: "t-1", part: 1 }, expect.anything());
    expect(window.fetch).not.toHaveBeenCalled();
    expect(blobs[0].type).toBe("audio/mpeg");
    delete window.fetch;
  });
});
