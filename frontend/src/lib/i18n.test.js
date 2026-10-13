/* global describe, test, expect, beforeEach */
// lib/i18n.js — the interface language (TR/EN) and the reply language for
// a worldwide Luna: the browser's language decides for someone new, never a
// hard-coded Turkish default. Run with:
//   CI=true npx craco test --watchAll=false src/lib/i18n
import {
  baseLang, supportedLang, uiLang, makeT, detectLang, initialUiLang, initialReplyLang, seedReplyLang,
  deviceFirstSeen, accountPredatesDevice, accountLanguage, justCreatedHere,
} from "./i18n";

const nav = (languages, language = languages[0]) => ({ languages, language });

beforeEach(() => {
  localStorage.clear();
});

describe("codes", () => {
  test("baseLang / supportedLang", () => {
    expect(baseLang("de-AT")).toBe("de");
    expect(baseLang(" TR ")).toBe("tr");
    expect(baseLang("zh_Hant_TW")).toBe("zh");
    expect(baseLang("")).toBe("");
    expect(baseLang(null)).toBe("");
    expect(supportedLang("es-419")).toBe("es");
    expect(supportedLang("fr-FR")).toBe("");
  });

  test("the interface is Turkish only for Turkish — every other language reads English", () => {
    expect(uiLang("tr")).toBe("tr");
    expect(uiLang("tr-TR")).toBe("tr");
    for (const code of ["en", "de", "es", "ru", "it", "fr", "", undefined]) expect(uiLang(code)).toBe("en");
  });

  test("makeT never falls back to Turkish for a German screen", () => {
    expect(makeT("tr")("Merhaba", "Hello")).toBe("Merhaba");
    expect(makeT("en")("Merhaba", "Hello")).toBe("Hello");
    expect(makeT("de")("Merhaba", "Hello")).toBe("Hello");
  });
});

describe("detectLang", () => {
  test("the first browser language Luna speaks", () => {
    expect(detectLang(nav(["fr-FR", "de-DE", "en-US"]))).toBe("de");
    expect(detectLang(nav(["tr-TR", "en"]))).toBe("tr");
    expect(detectLang(nav(["es-MX"]))).toBe("es");
  });

  test("English when none is one of hers, or the browser says nothing", () => {
    expect(detectLang(nav(["ja-JP", "fr"]))).toBe("en");
    expect(detectLang({ languages: [], language: "" })).toBe("en");
    expect(detectLang(null)).toBe("en");
  });

  test("an old browser with only navigator.language", () => {
    expect(detectLang({ language: "ru-RU" })).toBe("ru");
  });
});

describe("initialUiLang", () => {
  test("a first visit from abroad is English, from Türkiye Turkish", () => {
    expect(initialUiLang(nav(["en-GB"]))).toBe("en");
    expect(initialUiLang(nav(["de-DE"]))).toBe("en");
    expect(initialUiLang(nav(["tr-TR"]))).toBe("tr");
  });

  test("the language saved on this device wins, as an interface language", () => {
    localStorage.setItem("luna_lang", "tr");
    expect(initialUiLang(nav(["de-DE"]))).toBe("tr");
    localStorage.setItem("luna_lang", "en");
    expect(initialUiLang(nav(["tr-TR"]))).toBe("en");
    localStorage.setItem("luna_lang", "it");
    expect(initialUiLang(nav(["tr-TR"]))).toBe("en");
    localStorage.setItem("luna_lang", "xx");
    expect(initialUiLang(nav(["tr-TR"]))).toBe("tr");
  });
});

describe("the reply language for someone who never picked one", () => {
  test("a German browser on the English screens: German replies", () => {
    expect(initialReplyLang("en", nav(["de-DE", "en"]))).toBe("de");
  });

  test("Turkish or English browsers follow the interface (null)", () => {
    expect(initialReplyLang("tr", nav(["tr-TR"]))).toBeNull();
    expect(initialReplyLang("en", nav(["en-US"]))).toBeNull();
    expect(initialReplyLang("en", nav(["ja-JP"]))).toBeNull();
  });

  test("someone who switched the screens to Turkish wants Turkish, whatever the browser says", () => {
    expect(initialReplyLang("tr", nav(["de-DE"]))).toBeNull();
  });

  test("a choice made on this device, or the old landing page's saved language, wins", () => {
    localStorage.setItem("luna_lang", "es");
    expect(initialReplyLang("en", nav(["de-DE"]))).toBe("es");
    localStorage.setItem("luna_reply_lang", "ru");
    expect(initialReplyLang("tr", nav(["de-DE"]))).toBe("ru");
  });

  test("seedReplyLang keeps the browser's language, never over a choice", () => {
    expect(seedReplyLang("de")).toBe("de");
    expect(localStorage.getItem("luna_reply_lang")).toBe("de");
    expect(seedReplyLang("it")).toBe("de");
    expect(localStorage.getItem("luna_reply_lang")).toBe("de");
  });

  test("seedReplyLang stores nothing for TR/EN or an unknown language", () => {
    expect(seedReplyLang(null)).toBeNull();
    expect(seedReplyLang("en")).toBeNull();
    expect(seedReplyLang("fr")).toBeNull();
    expect(localStorage.getItem("luna_reply_lang")).toBeNull();
  });
});

describe("an existing account on a new browser keeps its own language", () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60;
  const profile = (language, ageSeconds) => ({ profile: { language }, account_age_seconds: ageSeconds });

  test("deviceFirstSeen is stamped once; a browser that used Luna before is 0", () => {
    expect(deviceFirstSeen(NOW)).toBe(NOW);
    expect(localStorage.getItem("luna_first_seen")).toBe(String(NOW));
    expect(deviceFirstSeen(NOW + 5000)).toBe(NOW);
    localStorage.clear();
    localStorage.setItem("luna_lang", "tr");
    expect(deviceFirstSeen(NOW)).toBe(0);
    expect(deviceFirstSeen(NOW + 5000)).toBe(0);
  });

  test("initialUiLang stamps the browser before luna_lang is saved", () => {
    initialUiLang(nav(["de-DE"]));
    expect(Number(localStorage.getItem("luna_first_seen"))).toBeGreaterThan(0);
  });

  test("accountPredatesDevice: older than this browser's first visit, by both clocks", () => {
    expect(accountPredatesDevice(400 * DAY, NOW - 60_000, NOW)).toBe(true);
    // created on this browser after it first opened Luna (a sign-up here)
    expect(accountPredatesDevice(30, NOW - 60_000, NOW)).toBe(false);
    expect(accountPredatesDevice(2 * DAY, NOW - 3 * DAY * 1000, NOW)).toBe(false);
    // unknown age, an older server, or a browser that used Luna before
    expect(accountPredatesDevice(null, NOW - 60_000, NOW)).toBe(false);
    expect(accountPredatesDevice(undefined, NOW - 60_000, NOW)).toBe(false);
    expect(accountPredatesDevice(400 * DAY, 0, NOW)).toBe(false);
  });

  test("a Turkish account signing in on a German browser stays Turkish (screens and replies)", () => {
    const opts = { now: NOW, firstSeen: NOW - 30_000 };
    expect(accountLanguage(profile("tr", 300 * DAY), opts)).toEqual({ reply: "tr", ui: "tr" });
    expect(accountLanguage(profile("en", 300 * DAY), opts)).toEqual({ reply: "en", ui: "en" });
    expect(accountLanguage(profile("de", 300 * DAY), opts)).toEqual({ reply: "de", ui: "en" });
  });

  test("an account just created here takes the browser's language (the server's tr is only a default)", () => {
    const opts = { now: NOW, firstSeen: NOW - 90_000 };
    expect(accountLanguage(profile("tr", 20), opts)).toBeNull();
    expect(accountLanguage(profile("en", 20), opts)).toBeNull();
    // a non-TR/EN language is always a choice made in Settings
    expect(accountLanguage(profile("ru", 20), opts)).toEqual({ reply: "ru", ui: null });
    expect(justCreatedHere(profile("tr", 20), opts)).toBe(true);
    expect(justCreatedHere(profile("tr", 300 * DAY), { now: NOW, firstSeen: NOW - 30_000 })).toBe(false);
    expect(justCreatedHere(profile("tr", 20), { now: NOW, firstSeen: 0 })).toBe(false);
    expect(justCreatedHere({ profile: { language: "tr" } }, opts)).toBe(false);
  });

  test("a reply language chosen on this device always wins", () => {
    localStorage.setItem("luna_reply_lang", "es");
    expect(accountLanguage(profile("tr", 300 * DAY), { now: NOW, firstSeen: NOW - 30_000 })).toBeNull();
  });

  test("an older server (no account age) or a browser that used Luna before: as before", () => {
    expect(accountLanguage({ profile: { language: "tr" } }, { now: NOW, firstSeen: NOW - 30_000 })).toBeNull();
    expect(accountLanguage({ profile: { language: "de" } }, { now: NOW, firstSeen: NOW - 30_000 }))
      .toEqual({ reply: "de", ui: null });
    expect(accountLanguage(profile("tr", 300 * DAY), { now: NOW, firstSeen: 0 })).toBeNull();
    expect(accountLanguage(null, { now: NOW, firstSeen: NOW })).toBeNull();
    expect(accountLanguage(profile("xx", 300 * DAY), { now: NOW, firstSeen: NOW - 30_000 })).toBeNull();
  });
});
