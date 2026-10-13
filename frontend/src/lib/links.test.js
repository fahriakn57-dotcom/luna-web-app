/* global describe, test, expect */
// lib/links.js — run with:  CI=true npx craco test --watchAll=false src/lib/links
import { hostLabel, normalizeSources, safeHref, stripTracking } from "./links";

describe("links", () => {
  test("stripTracking drops utm_* (and click ids), keeps everything else", () => {
    expect(stripTracking("https://a.com/x?utm_source=openai")).toBe("https://a.com/x");
    expect(stripTracking("https://a.com/x?id=5&utm_source=openai&utm_medium=chat")).toBe("https://a.com/x?id=5");
    expect(stripTracking("https://a.com/x?id=5")).toBe("https://a.com/x?id=5");
    expect(stripTracking("https://a.com/x")).toBe("https://a.com/x");
  });

  test("safeHref allows only http(s) and mailto", () => {
    expect(safeHref("https://lunai.tr/app?utm_source=openai")).toBe("https://lunai.tr/app");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:destek@lunai.tr")).toBe("mailto:destek@lunai.tr");
    expect(safeHref("<https://example.com/a>")).toBe("https://example.com/a");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeHref("/api/account")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  test("hostLabel is the bare host name", () => {
    expect(hostLabel("https://www.hurriyet.com.tr/ekonomi/x")).toBe("hurriyet.com.tr");
    expect(hostLabel("nonsense")).toBe("");
  });

  test("normalizeSources: safe links only, tracking stripped, each page once, a title for each", () => {
    expect(normalizeSources([
      { title: "Hava durumu", url: "https://www.mgm.gov.tr/tahmin?utm_source=openai" },
      { title: "Tekrar", url: "https://www.mgm.gov.tr/tahmin" },
      { title: "", url: "https://aa.com.tr/tr/ekonomi" },
      { title: "Kötü", url: "javascript:alert(1)" },
      null,
      "metin",
    ])).toEqual([
      { title: "Hava durumu", url: "https://www.mgm.gov.tr/tahmin", domain: "mgm.gov.tr" },
      { title: "aa.com.tr", url: "https://aa.com.tr/tr/ekonomi", domain: "aa.com.tr" },
    ]);
    expect(normalizeSources(undefined)).toEqual([]);
    expect(normalizeSources(3)).toEqual([]);
  });

  test("normalizeSources keeps at most 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ title: `s${i}`, url: `https://s${i}.example.com/` }));
    expect(normalizeSources(many)).toHaveLength(10);
  });
});
