/* global describe, test, expect */
// The launch's small client helpers: lib/turnExtras.js (what a reply bubble
// carries besides its text), lib/plans.js (the plan catalog in the
// interface language) and lib/countries.js / lib/languages.js (Settings'
// country and the speech recognition locale). Run with:
//   CI=true npx craco test --watchAll=false src/lib/launchGlue
import { replyExtras } from "./turnExtras";
import { formatPlanPrice, planFeatures } from "./plans";
import { COUNTRY_CODES, countryName, countryOptions } from "./countries";
import { LANGUAGES, langLabel, speechLocale } from "./languages";

describe("replyExtras", () => {
  test("only the extras a turn has", () => {
    expect(replyExtras({ reply: "Selam", attachments: [], sources: [] })).toEqual({});
    expect(replyExtras(null)).toEqual({});
  });

  test("a document asked for in chat, the pages a search used and what Luna did", () => {
    const att = { type: "file", messageId: "m1", name: "rapor.pdf" };
    const src = { title: "AA", url: "https://aa.com.tr/x", domain: "aa.com.tr" };
    const act = { type: "reminder_created", title: "Annemi ara" };
    expect(replyExtras({ attachments: [att], sources: [src], actions: [act] }))
      .toEqual({ attachments: [att], sources: [src], actions: [act] });
  });

  test("a result from an older server without actions", () => {
    expect(replyExtras({ attachments: [{ type: "image" }] })).toEqual({ attachments: [{ type: "image" }] });
    expect(replyExtras({ actions: "nope" })).toEqual({});
  });
});

describe("plans", () => {
  const free = {
    id: "free", price_try: 0,
    features: ["Günde 30 mesaj (görsel ve belge üretimi dahil)", "Günde 5 sesli yanıt"],
    features_en: ["30 messages a day (pictures and documents included)", "5 voice replies a day"],
  };

  test("the feature lines in the interface language", () => {
    expect(planFeatures(free, "tr")[0]).toBe("Günde 30 mesaj (görsel ve belge üretimi dahil)");
    expect(planFeatures(free, "en")[0]).toBe("30 messages a day (pictures and documents included)");
    expect(planFeatures(free, "de")[1]).toBe("5 voice replies a day");
  });

  test("an older server without English copy shows the Turkish lines", () => {
    expect(planFeatures({ features: ["Günde 30 mesaj"] }, "en")).toEqual(["Günde 30 mesaj"]);
    expect(planFeatures({}, "en")).toEqual([]);
  });

  test("prices as the interface writes numbers", () => {
    expect(formatPlanPrice({ price_try: 199.9 }, "tr")).toBe("₺199,90");
    expect(formatPlanPrice({ price_try: 199.9 }, "en")).toBe("₺199.90");
    expect(formatPlanPrice({ price_try: 0 }, "en")).toBe("₺0");
    expect(formatPlanPrice({ price_usd: 12.99 }, "tr")).toBe("$12.99");
  });
});

describe("countries", () => {
  test("ISO codes, no duplicates, Türkiye and the big markets in", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    for (const code of ["TR", "US", "DE", "GB", "ES", "IT", "RU", "IN", "BR"]) expect(COUNTRY_CODES).toContain(code);
  });

  test("names in the interface language (the browser's own list), the code when it can't", () => {
    expect(countryName("de", "en")).toMatch(/Germany|DE/);
    expect(countryName("", "en")).toBe("");
    expect(countryName("not-a-code", "tr")).toBe("");
  });

  test("the options are sorted by name", () => {
    const names = countryOptions("en").map((c) => c.name);
    expect(names.length).toBe(COUNTRY_CODES.length);
    expect([...names].sort((a, b) => a.localeCompare(b, "en"))).toEqual(names);
  });
});

describe("languages", () => {
  test("the six reply languages, each with a speech locale", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["tr", "en", "es", "de", "ru", "it"]);
    expect(speechLocale("de")).toBe("de-DE");
    expect(speechLocale("tr")).toBe("tr-TR");
    expect(speechLocale("ru-RU")).toBe("ru-RU");
    expect(speechLocale("fr")).toBe("en-US");
    expect(speechLocale(undefined)).toBe("en-US");
    expect(langLabel("es")).toBe("Español");
    expect(langLabel("xx")).toBe("XX");
  });
});
