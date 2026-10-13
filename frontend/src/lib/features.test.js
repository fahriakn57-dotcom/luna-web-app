/* global describe, test, expect, jest, beforeEach, require */
// lib/features.js — GET /api/features, asked once and cleaned: a flag is on
// only when the server says exactly true; code execution and video are
// never offered. Run with:
//   CI=true npx craco test --watchAll=false src/lib/features
jest.mock("./api", () => ({ fetchFeatures: jest.fn() }));

const api = require("./api");
const { DEFAULT_FEATURES, normalizeFeatures, loadFeatures, resetFeaturesForTest } = require("./features");

beforeEach(() => {
  resetFeaturesForTest();
  api.fetchFeatures.mockReset();
});

describe("normalizeFeatures", () => {
  test("everything off when the server says nothing (an older server, no connection)", () => {
    expect(normalizeFeatures(null)).toEqual({ ...DEFAULT_FEATURES });
    expect(normalizeFeatures({ email: true })).toEqual({ ...DEFAULT_FEATURES, email: true });
  });

  test("a flag is on only for exactly true", () => {
    const f = normalizeFeatures({ realtime_voice: "true", chat_files: 1, chat_images: true, agent_tools: true, web_search: false });
    expect(f.realtime_voice).toBe(false);
    expect(f.chat_files).toBe(false);
    expect(f.chat_images).toBe(true);
    expect(f.agent_tools).toBe(true);
    expect(f.web_search).toBe(false);
  });

  test("code execution and video stay off whatever is said", () => {
    const f = normalizeFeatures({ code_execution: true, video: true });
    expect(f.code_execution).toBe(false);
    expect(f.video).toBe(false);
  });

  test("the free plan's caps and the languages", () => {
    const f = normalizeFeatures({ free_daily_messages: 30, free_daily_voice: 5, languages: ["tr", "en", 3, ""] });
    expect(f.free_daily_messages).toBe(30);
    expect(f.free_daily_voice).toBe(5);
    expect(f.languages).toEqual(["tr", "en"]);
    expect(normalizeFeatures({ free_daily_messages: 1e9, free_daily_voice: "5" }).free_daily_messages).toBeNull();
    expect(normalizeFeatures({ free_daily_voice: "5" }).free_daily_voice).toBeNull();
  });

  test("sales: only an explicit false closes it (as PremiumPanel reads it)", () => {
    expect(normalizeFeatures({}).sales).toBe(true);
    expect(normalizeFeatures({ sales: false }).sales).toBe(false);
  });
});

describe("loadFeatures", () => {
  test("asked once and shared", async () => {
    api.fetchFeatures.mockResolvedValue({ realtime_voice: true });
    const [a, b] = await Promise.all([loadFeatures(), loadFeatures()]);
    expect(a.realtime_voice).toBe(true);
    expect(b).toBe(a);
    expect(await loadFeatures()).toBe(a);
    expect(api.fetchFeatures).toHaveBeenCalledTimes(1);
  });

  test("a failed ask gives the defaults and is asked again next time", async () => {
    api.fetchFeatures.mockResolvedValueOnce(null).mockResolvedValueOnce({ agent_tools: true });
    expect((await loadFeatures()).agent_tools).toBe(false);
    expect((await loadFeatures()).agent_tools).toBe(true);
    expect(api.fetchFeatures).toHaveBeenCalledTimes(2);
  });

  test("a thrown error too", async () => {
    api.fetchFeatures.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ chat_files: true });
    expect((await loadFeatures()).chat_files).toBe(false);
    expect((await loadFeatures()).chat_files).toBe(true);
  });
});
