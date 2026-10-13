/* global describe, test, expect, jest, beforeAll, beforeEach, afterEach, require */
// lib/api.js — the Markdown render capability (X-Luna-Render / render),
// whole turn results (sources, attachments), keep-alives on a long search,
// message files and the paged gallery. Run with:
//   CI=true npx craco test --watchAll=false src/lib/api.renderAndResults
import { TextDecoder, TextEncoder } from "util";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(), get: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  },
}));

let api;
let axios;
let requestInterceptor;
beforeAll(() => {
  process.env.REACT_APP_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://luna.test";
  if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  api = require("./api");
  axios = require("axios").default;
  // (captured now: CRA's Jest resets every jest.fn() before each test)
  requestInterceptor = axios.interceptors.request.use.mock.calls[0]?.[0];
});

const ARGS = { message: "selam", mode: "friend", lang: "tr", conversationId: null, mood: null };
const encoder = new TextEncoder();
const data = (event) => `data: ${JSON.stringify(event)}\n\n`;
const delta = (text) => data({ type: "assistant_delta", text });

// fetch answering with these SSE chunks, each `gapMs` after the one before
// (0: at once), then the end of the stream. A read in progress fails when
// the request is aborted, as a real one does.
function serve(chunks, { gapMs = 0 } = {}) {
  const requests = [];
  window.fetch = jest.fn(async (url, init) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const queue = [...chunks];
    const next = () => (queue.length
      ? { value: encoder.encode(queue.shift()), done: false }
      : { value: undefined, done: true });
    const read = () => {
      if (!gapMs) return Promise.resolve(next());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(next()), gapMs);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel: () => Promise.resolve() }) },
    };
  });
  return requests;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("render capability", () => {
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.fetch;
  });

  test.each([[false], [true]])("a turn says it renders Markdown, in the header and the body (voice: %s)", async (voice) => {
    const requests = serve([delta("Selam"), data({ type: "assistant_completed", reply: "Selam", message_id: "m1" })]);
    await api.streamChat({ ...ARGS, voice, onDelta: () => {} });
    expect(requests[0].init.headers["X-Luna-Render"]).toBe("markdown");
    expect(requests[0].body.render).toBe("markdown");
  });

  test("every axios request to the API gets the header, including ones without the device's auth", () => {
    expect(typeof requestInterceptor).toBe("function");
    const cfg = requestInterceptor({ url: `${api.API}/auth/register`, headers: { "X-Device-Id": "d" } });
    expect(cfg.headers["X-Luna-Render"]).toBe("markdown");
    const set = jest.fn();
    requestInterceptor({ url: `${api.API}/features`, headers: { set } });
    expect(set).toHaveBeenCalledWith("X-Luna-Render", "markdown");
    const other = requestInterceptor({ url: "https://other.example/x", headers: {} });
    expect(other.headers["X-Luna-Render"]).toBeUndefined();
  });

  test("sendChat sends it too and, with full, resolves the whole turn", async () => {
    axios.post.mockResolvedValue({ data: {
      reply: "İşte çizdiğim görsel 🎨", message_id: "m9",
      attachments: [{ type: "image", message_id: "m9", mime_type: "image/jpeg", name: "gorsel.jpg", size_bytes: 3,
        url: "/api/messages/m9/file", data_base64: "AAAA", source: "chat_image" }],
      sources: [{ title: "Kaynak", url: "https://a.com/x?utm_source=openai" }],
    } });
    const result = await api.sendChat({ ...ARGS, full: true });
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/api\/chat$/);
    expect(body.render).toBe("markdown");
    expect(config.headers["X-Luna-Render"]).toBe("markdown");
    expect(result.reply).toBe("İşte çizdiğim görsel 🎨");
    expect(result.messageId).toBe("m9");
    expect(result.attachments).toEqual([{ type: "image", messageId: "m9", mimeType: "image/jpeg", name: "gorsel.jpg",
      sizeBytes: 3, dataUrl: "data:image/jpeg;base64,AAAA", source: "chat_image" }]);
    expect(result.sources).toEqual([{ title: "Kaynak", url: "https://a.com/x", domain: "a.com" }]);
    // (without full: just the text, as before)
    expect(await api.sendChat({ ...ARGS })).toBe("İşte çizdiğim görsel 🎨");
  });
});

describe("streamChat results", () => {
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.fetch;
  });

  const completed = {
    type: "assistant_completed", reply: "Dolar 41,2 TL ([aa.com.tr](https://aa.com.tr/x)).", message_id: "m2",
    sources: [{ title: "AA", url: "https://aa.com.tr/x?utm_source=openai" }],
    attachments: [{ type: "file", message_id: "m3", mime_type: "application/pdf", name: "rapor.pdf", size_bytes: 5000000,
      url: "/api/messages/m3/file", source: "chat_file" }],
  };

  test("full: the reply with its sources and attachments; without it: the reply text (unchanged)", async () => {
    serve([delta("Dolar"), data(completed)]);
    const result = await api.streamChat({ ...ARGS, full: true, onDelta: () => {} });
    expect(result.reply).toBe(completed.reply);
    expect(result.messageId).toBe("m2");
    expect(result.sources).toEqual([{ title: "AA", url: "https://aa.com.tr/x", domain: "aa.com.tr" }]);
    expect(result.attachments).toEqual([{ type: "file", messageId: "m3", mimeType: "application/pdf", name: "rapor.pdf",
      sizeBytes: 5000000, dataUrl: "", source: "chat_file" }]);

    serve([delta("Dolar"), data(completed)]);
    expect(await api.streamChat({ ...ARGS, onDelta: () => {} })).toBe(completed.reply);
  });

  test("a spoken turn whose model searches for 30 s stays alive on the server's keep-alives", async () => {
    jest.useFakeTimers();
    serve([
      ...Array.from({ length: 6 }, () => ": keep-alive\n\n"),
      delta("Yarın hava güneşli."),
      data({ type: "assistant_completed", reply: "Yarın hava güneşli.", message_id: "m4" }),
    ], { gapMs: 5000 });
    let result = null;
    api.streamChat({ ...ARGS, voice: true, onDelta: () => {} }).then(
      (value) => { result = { value }; },
      (error) => { result = { error }; },
    );
    for (let k = 0; k < 12 && result === null; k++) {
      await flush();
      jest.advanceTimersByTime(5000);
    }
    await flush();
    expect(result).toEqual({ value: "Yarın hava güneşli." });
  });

  test("...while the same 30 s of total silence still ends a spoken turn after 15 s", async () => {
    jest.useFakeTimers();
    serve([delta("Geç")], { gapMs: 30000 });
    let result = null;
    api.streamChat({ ...ARGS, voice: true, onDelta: () => {} }).then(
      (value) => { result = { value }; },
      (error) => { result = { error }; },
    );
    await flush();
    jest.advanceTimersByTime(15000);
    await flush();
    expect(result.error.name).toBe("TimeoutError");
  });
});

describe("turnResult", () => {
  test("a plain reply string (an older caller or server)", () => {
    expect(api.turnResult("Selam")).toEqual({ reply: "Selam", messageId: null, sources: [], attachments: [], actions: [], safety: null, degraded: false });
  });

  test("what Luna did in the account (agent actions): objects with a type, at most 10, copied", () => {
    const reminder = {
      type: "reminder_created", id: "r1", summary: "Yarın 09:00 — Annemi ara", text: "Annemi ara",
      due_at: "2026-10-14T06:00:00Z", timezone: "Europe/Istanbul", recurrence: "none",
      calendar: { google_url: "https://calendar.google.com/calendar/render?action=TEMPLATE", ics_url: "/api/reminders/r1.ics" },
    };
    const r = api.turnResult({ reply: "Tamam, hatırlatacağım.", actions: [reminder, null, "x", { id: "no-type" }, { type: "Bad Type" }] });
    expect(r.actions).toEqual([reminder]);
    expect(r.actions[0]).not.toBe(reminder);
    const many = Array.from({ length: 14 }, (_, i) => ({ type: "note_created", id: `n${i}` }));
    expect(api.turnResult({ reply: "x", actions: many }).actions).toHaveLength(10);
    expect(api.turnResult({ reply: "x" }).actions).toEqual([]);
  });

  test("a picture answered without attachments still shows from image_base64", () => {
    const r = api.turnResult({ reply: "Düzenledim 🎨", message_id: "m5", image_base64: "BBBB", mime_type: "image/png" });
    expect(r.attachments).toEqual([expect.objectContaining({ type: "image", messageId: "m5", dataUrl: "data:image/png;base64,BBBB" })]);
  });

  test("shaping a result twice keeps it whole (streamChat({ full }) -> Luna.jsx turnResult)", () => {
    const once = api.turnResult({ reply: "x", message_id: "m8", attachments: [{ type: "image", message_id: "m8", mime_type: "image/png", data_base64: "EEEE" }] });
    const twice = api.turnResult(once);
    expect(twice).toBe(once);
    expect(twice.attachments).toHaveLength(1);
    expect(twice.messageId).toBe("m8");
  });

  test("broken attachments are skipped; a non-image 'image' is a file", () => {
    const r = api.turnResult({ reply: "x", attachments: [null, { type: "image" }, { type: "image", message_id: "m6", mime_type: "text/html" }] });
    expect(r.attachments).toEqual([expect.objectContaining({ type: "file", messageId: "m6", mimeType: "text/html", dataUrl: "" })]);
  });
});

describe("media, history, files, gallery", () => {
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
  });
  afterEach(() => {
    delete window.fetch;
  });

  test("sendMedia: the text as before, or with full the picture a photo action made", async () => {
    axios.post.mockResolvedValue({ data: {
      reply: "Düzenledim 🎨", message_id: "m7",
      attachments: [{ type: "image", message_id: "m7", mime_type: "image/jpeg", name: "x.jpg", data_base64: "CCCC" }],
    } });
    const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    expect(await api.sendMedia(file, "bunu anime yap", "friend")).toBe("Düzenledim 🎨");
    const result = await api.sendMedia(file, "bunu anime yap", "friend", { full: true });
    expect(result.attachments[0]).toEqual(expect.objectContaining({ type: "image", dataUrl: "data:image/jpeg;base64,CCCC" }));
    expect(axios.post.mock.calls[0][2].headers["X-Luna-Render"]).toBe("markdown");
  });

  test("fetchMessages keeps a searched reply's sources (meta.web_sources)", async () => {
    axios.get.mockResolvedValue({ data: { messages: [
      { id: "a1", sender: "assistant", content: "Haber [AA](https://aa.com.tr/x)", created_at: "2026-10-13T10:00:00Z",
        meta: { web_sources: [{ title: "AA", url: "https://aa.com.tr/x?utm_source=openai" }] } },
      { id: "u1", sender: "user", content: "haber var mı", created_at: "2026-10-13T09:59:00Z" },
    ] } });
    const [luna, user] = await api.fetchMessages("friend");
    expect(luna.sources).toEqual([{ title: "AA", url: "https://aa.com.tr/x", domain: "aa.com.tr" }]);
    expect(user.sources).toBeUndefined();
  });

  test("fetchMessages keeps what Luna did that turn (meta.agent_actions)", async () => {
    axios.get.mockResolvedValue({ data: { messages: [
      { id: "a2", sender: "assistant", content: "Not aldım.", created_at: "2026-10-13T10:00:00Z",
        meta: { agent_actions: [{ type: "note_created", id: "n1", summary: "Market listesi" }] } },
      { id: "a3", sender: "assistant", content: "Selam", created_at: "2026-10-13T10:01:00Z", meta: {} },
    ] } });
    const [withAction, plain] = await api.fetchMessages("friend");
    expect(withAction.actions).toEqual([{ type: "note_created", id: "n1", summary: "Market listesi" }]);
    expect(plain.actions).toBeUndefined();
  });

  test("fetchMessages keeps a flagged reply's help lines for the user's country (meta.safety_resources)", async () => {
    const us = [{ label: "Acil yardım", label_en: "Emergency", phone: "911" }, { label: "988", label_en: "988", phone: "988" }];
    axios.get.mockResolvedValue({ data: { messages: [
      { id: "a4", sender: "assistant", content: "Yanındayım.", created_at: "2026-10-13T10:00:00Z",
        meta: { safety: "self_harm", safety_resources: us, safety_country: "US" } },
      { id: "a5", sender: "assistant", content: "Yanındayım.", created_at: "2026-10-13T10:01:00Z", meta: { safety: "abuse" } },
      { id: "a6", sender: "assistant", content: "Selam", created_at: "2026-10-13T10:02:00Z", meta: {} },
    ] } });
    const [withLines, olderServer, plain] = await api.fetchMessages("friend");
    expect(withLines.safety).toEqual({ kind: "self_harm", resources: us, country: "US" });
    // (an older server: only the kind — the card then goes by the device's zone, lib/crisis.js)
    expect(olderServer.safety).toEqual({ kind: "abuse" });
    expect(plain.safety).toBeUndefined();
    expect(api.historySafety({ safety: { kind: "abuse", resources: us } })).toEqual({ kind: "abuse", resources: us });
    expect(api.historySafety({ safety: 3 })).toBeUndefined();
    expect(api.historySafety(undefined)).toBeUndefined();
  });

  test("fetchMessageFile asks this API only, with the device's auth", async () => {
    window.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => "BLOB" }));
    expect(await api.fetchMessageFile("65f0a1b2c3d4e5f6a7b8c9d0")).toBe("BLOB");
    const [url, init] = window.fetch.mock.calls[0];
    expect(url).toBe(`${api.API}/messages/65f0a1b2c3d4e5f6a7b8c9d0/file`);
    expect(init.headers).toEqual(expect.objectContaining({ "X-Device-Id": "dev-1", "X-Device-Secret": "secret-1" }));

    window.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: "Dosya bulunamadı" }) }));
    await expect(api.fetchMessageFile("65f0a1b2c3d4e5f6a7b8c9d0")).rejects.toHaveProperty("response.status", 404);

    window.fetch = jest.fn();
    await expect(api.fetchMessageFile("../../account")).rejects.toBeTruthy();
    await expect(api.fetchMessageFile("https://evil.example/x")).rejects.toBeTruthy();
    expect(window.fetch).not.toHaveBeenCalled();
  });

  test("the gallery pages: has_more / next_before, and `before` for the next page", async () => {
    axios.get.mockResolvedValue({ data: {
      images: [{ id: "i1", prompt: "kedi", image_base64: "DDDD", mime_type: "image/png", created_at: "2026-10-12" }],
      has_more: true, next_before: "2026-10-12",
    } });
    const page = await api.fetchGeneratedImagesPage();
    expect(page).toEqual({
      images: [{ id: "i1", prompt: "kedi", imageUrl: "data:image/png;base64,DDDD", createdAt: "2026-10-12" }],
      hasMore: true, nextBefore: "2026-10-12",
    });
    await api.fetchGeneratedImagesPage({ before: "2026-10-12" });
    expect(axios.get.mock.calls[1][1].params).toEqual({ before: "2026-10-12" });
    // (the old first-page call is unchanged)
    expect(await api.fetchGeneratedImages()).toHaveLength(1);
  });
});
