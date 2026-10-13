/* global describe, test, expect, jest, beforeAll, beforeEach, afterEach, require */
// lib/api.js — where this browser is (backend services/user_locale.py): the
// IANA time zone ("X-Luna-Timezone") and the browser language
// ("X-Luna-Locale") go with every request, so Luna's clock, web search,
// reminders and crisis numbers follow the user, not Türkiye. Run with:
//   CI=true npx craco test --watchAll=false src/lib/api.locale
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
const realDateTimeFormat = Intl.DateTimeFormat;
beforeAll(() => {
  process.env.REACT_APP_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://luna.test";
  if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  api = require("./api");
  axios = require("axios").default;
  // (captured now: CRA's Jest resets every jest.fn() before each test)
  requestInterceptor = axios.interceptors.request.use.mock.calls[0]?.[0];
});

function fakeZone(timeZone) {
  Intl.DateTimeFormat = function fake() {
    return { resolvedOptions: () => ({ timeZone }) };
  };
}

function setLanguage(language) {
  Object.defineProperty(window.navigator, "language", { value: language, configurable: true });
  Object.defineProperty(window.navigator, "languages", { value: language ? [language] : [], configurable: true });
}

const encoder = new TextEncoder();

function serve(chunks) {
  const requests = [];
  window.fetch = jest.fn(async (url, init) => {
    requests.push({ url, init });
    const queue = [...chunks];
    const read = () => Promise.resolve(queue.length
      ? { value: encoder.encode(queue.shift()), done: false }
      : { value: undefined, done: true });
    return { ok: true, status: 200, headers: { get: () => null },
      body: { getReader: () => ({ read, cancel: () => Promise.resolve() }) } };
  });
  return requests;
}

describe("locale headers", () => {
  beforeEach(() => {
    localStorage.setItem("luna_device_id", "dev-1");
    localStorage.setItem("luna_device_secret", "secret-1");
  });
  afterEach(() => {
    Intl.DateTimeFormat = realDateTimeFormat;
    setLanguage("en-US");
    delete window.fetch;
  });

  test("the zone and the language of this browser", () => {
    fakeZone("America/New_York");
    setLanguage("de-AT");
    expect(api.localeHeaders()).toEqual({ "X-Luna-Timezone": "America/New_York", "X-Luna-Locale": "de-AT" });
    expect(api.TIMEZONE_HEADER).toBe("X-Luna-Timezone");
    expect(api.LOCALE_HEADER).toBe("X-Luna-Locale");
  });

  test("nothing odd is ever sent: a broken or missing zone or language is left out", () => {
    fakeZone("Europe/Berlin\r\nX-Evil: 1");
    setLanguage("tr TR<script>");
    expect(api.localeHeaders()).toEqual({});
    Intl.DateTimeFormat = function broken() {
      throw new Error("no Intl");
    };
    setLanguage("");
    expect(api.localeHeaders()).toEqual({});
  });

  test("every axios request to the API carries them, other hosts never do", () => {
    fakeZone("Asia/Tokyo");
    setLanguage("ja-JP");
    expect(typeof requestInterceptor).toBe("function");
    const cfg = requestInterceptor({ url: `${api.API}/profile`, headers: {} });
    expect(cfg.headers["X-Luna-Timezone"]).toBe("Asia/Tokyo");
    expect(cfg.headers["X-Luna-Locale"]).toBe("ja-JP");
    expect(cfg.headers["X-Luna-Render"]).toBe("markdown");
    const set = jest.fn();
    requestInterceptor({ url: `${api.API}/features`, headers: { set } });
    expect(set).toHaveBeenCalledWith("X-Luna-Timezone", "Asia/Tokyo");
    expect(set).toHaveBeenCalledWith("X-Luna-Locale", "ja-JP");
    const other = requestInterceptor({ url: "https://other.example/x", headers: {} });
    expect(other.headers["X-Luna-Timezone"]).toBeUndefined();
  });

  test("a streamed turn (fetch, not axios) carries them with the device's auth", async () => {
    fakeZone("Europe/Madrid");
    setLanguage("es-ES");
    const requests = serve([`data: ${JSON.stringify({ type: "assistant_completed", reply: "Hola", message_id: "m1" })}\n\n`]);
    await api.streamChat({ message: "hola", mode: "friend", lang: "es", conversationId: null, mood: null,
      onDelta: () => {} });
    const headers = requests[0].init.headers;
    expect(headers).toEqual(expect.objectContaining({
      "X-Luna-Timezone": "Europe/Madrid", "X-Luna-Locale": "es-ES",
      "X-Device-Id": "dev-1", "X-Device-Secret": "secret-1",
    }));
  });
});
