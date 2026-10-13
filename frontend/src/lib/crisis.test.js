/* global describe, test, expect */
// lib/crisis.js — the help card's lines: the user's own country's, as the
// server sends them with a flagged reply (live or reloaded); without them,
// Türkiye's only on a device in Türkiye's time zone. Run with:
//   CI=true npx craco test --watchAll=false src/lib/crisis
import { crisisLines, needsLocalEmergencyHint, HELPLINE_DIRECTORY } from "./crisis";

const US = [
  { label: "Acil yardım", label_en: "Emergency", labels: { tr: "Acil yardım", en: "Emergency", de: "Notruf" }, phone: "911" },
  { label: "988 Suicide & Crisis Lifeline", label_en: "988 Suicide & Crisis Lifeline",
    labels: { tr: "988 Suicide & Crisis Lifeline", en: "988 Suicide & Crisis Lifeline" }, phone: "988" },
  { label: "Ülkendeki destek hatları", label_en: "Helplines in your country",
    labels: { tr: "Ülkendeki destek hatları", en: "Helplines in your country" }, url: "https://findahelpline.com" },
];

describe("crisisLines", () => {
  test("the server's lines for the user's country, in the interface language", () => {
    const lines = crisisLines("self_harm", US, "en");
    expect(lines.map((l) => l.phone || l.url)).toEqual(["911", "988", "https://findahelpline.com"]);
    expect(lines[0]).toEqual(expect.objectContaining({ label: "Emergency", tel: "911" }));
    expect(lines[2].label).toBe("Helplines in your country");
    expect(crisisLines("self_harm", US, "tr")[0].label).toBe("Acil yardım");
    // (a German screen reads English labels, like every non-Turkish one)
    expect(crisisLines("self_harm", US, "de")[0].label).toBe("Emergency");
    expect(needsLocalEmergencyHint(lines)).toBe(false);
  });

  test("Türkiye's card from the server (label / label_en, no labels map)", () => {
    const tr = [
      { label: "Acil yardım", label_en: "Emergency", phone: "112" },
      { label: "ALO 183 Sosyal Destek Hattı", label_en: "ALO 183 support line", phone: "183" },
    ];
    expect(crisisLines("abuse", tr, "tr").map((l) => `${l.phone} ${l.label}`)).toEqual(["112 Acil yardım", "183 ALO 183 Sosyal Destek Hattı"]);
    expect(crisisLines("abuse", tr, "en")[1].label).toBe("ALO 183 support line");
  });

  test("an unknown country: only the directory, and the card says to call the local emergency number", () => {
    const lines = crisisLines("self_harm", [{ label: "x", label_en: "Helplines in your country", url: HELPLINE_DIRECTORY }], "en");
    expect(lines).toEqual([expect.objectContaining({ url: HELPLINE_DIRECTORY })]);
    expect(needsLocalEmergencyHint(lines)).toBe(true);
  });

  test("without the server's list: where the DEVICE is decides, never the interface language", () => {
    // a device in Türkiye: Türkiye's lines on a Turkish or an English screen
    expect(crisisLines("abuse", undefined, "tr", "Europe/Istanbul").map((l) => l.phone)).toEqual(["112", "183"]);
    expect(crisisLines("self_harm", [], "tr", "Europe/Istanbul").map((l) => l.phone)).toEqual(["112"]);
    const enIstanbul = crisisLines("abuse", null, "en", "Europe/Istanbul");
    expect(enIstanbul.map((l) => `${l.phone} ${l.label}`)).toEqual(["112 Emergency", "183 ALO 183 support line"]);
    expect(crisisLines("self_harm", null, "de", "Asia/Istanbul").map((l) => l.phone)).toEqual(["112"]);
    // a Turkish screen in Berlin or New York: no Türkiye-only line, the directory instead
    for (const tz of ["Europe/Berlin", "America/New_York"]) {
      const lines = crisisLines("abuse", null, "tr", tz);
      expect(lines).toEqual([expect.objectContaining({ url: HELPLINE_DIRECTORY, label: "Ülkendeki destek hatları" })]);
      expect(lines.some((l) => l.phone === "183" || l.phone === "112")).toBe(false);
      expect(needsLocalEmergencyHint(lines)).toBe(true);
    }
    const en = crisisLines("self_harm", null, "en", "Europe/London");
    expect(en).toEqual([expect.objectContaining({ url: HELPLINE_DIRECTORY, label: "Helplines in your country" })]);
    expect(crisisLines("unknown_kind", null, "tr", "Europe/Istanbul")).toEqual([]);
  });

  test("a device with no zone that names a place: Türkiye's lines only on a Turkish screen", () => {
    for (const tz of ["", "UTC", "Etc/UTC", "GMT", undefined]) {
      expect(crisisLines("abuse", null, "tr", tz || "").map((l) => l.phone)).toEqual(["112", "183"]);
      expect(crisisLines("abuse", null, "en", tz || "")).toEqual([expect.objectContaining({ url: HELPLINE_DIRECTORY })]);
    }
  });

  test("the server's list wins over the device's zone", () => {
    expect(crisisLines("self_harm", US, "tr", "Europe/Istanbul").map((l) => l.phone || l.url))
      .toEqual(["911", "988", "https://findahelpline.com"]);
  });

  test("unsafe or broken entries are skipped", () => {
    const lines = crisisLines("self_harm", [
      null, "x", { label: "js", url: "javascript:alert(1)" }, { label: "http", url: "http://example.com" },
      { label: "bad phone", phone: "call me" }, { label: "Notruf", label_en: "Emergency", phone: "+49 (0) 112" },
    ], "en");
    expect(lines).toEqual([expect.objectContaining({ phone: "+49 (0) 112", tel: "+490112" })]);
  });
});
