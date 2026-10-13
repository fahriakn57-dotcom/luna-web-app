/* global describe, test, expect */
import { bucketOf, fold, groupConversations, matches, timeLabel } from "./conversationGroups";

const NOW = new Date(2026, 9, 13, 15, 30); // 13 Oct 2026, 15:30 local
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();

describe("bucketOf", () => {
  test("today, yesterday, the last week, this month, older", () => {
    expect(bucketOf(at(2026, 10, 13, 9), NOW)).toBe("today");
    expect(bucketOf(at(2026, 10, 12, 23), NOW)).toBe("yesterday");
    expect(bucketOf(at(2026, 10, 8), NOW)).toBe("week");
    expect(bucketOf(at(2026, 10, 2), NOW)).toBe("month");
    expect(bucketOf(at(2026, 8, 20), NOW)).toBe("older:2026-08");
    expect(bucketOf("not a date", NOW)).toBe("older:unknown");
  });
});

describe("groupConversations", () => {
  const list = [
    { id: "a", title: "Bugünkü", updated_at: at(2026, 10, 13, 11) },
    { id: "b", title: "Dünkü", updated_at: at(2026, 10, 12) },
    { id: "c", title: "Sabit", updated_at: at(2025, 1, 1), pinned: true },
    { id: "d", title: "Geçen hafta", updated_at: at(2026, 10, 9) },
    { id: "e", title: "Ağustos", updated_at: at(2026, 8, 3) },
    { id: "f", title: "Geçen yıl", updated_at: at(2025, 12, 30) },
  ];

  test("pinned first, then by day, months last (newest month first)", () => {
    const groups = groupConversations(list, { lang: "tr", now: NOW });
    expect(groups.map((g) => g.label)).toEqual(["Sabitlenenler", "Bugün", "Dün", "Son 7 gün", "Ağustos", "Aralık 2025"]);
    expect(groups[0].items.map((c) => c.id)).toEqual(["c"]);
  });

  test("English labels", () => {
    const groups = groupConversations(list, { lang: "en", now: NOW });
    expect(groups.slice(0, 4).map((g) => g.label)).toEqual(["Pinned", "Today", "Yesterday", "Previous 7 days"]);
  });

  test("search matches title or preview, ignoring case and Turkish letters", () => {
    const rows = [
      { id: "1", title: "Işık ayarları", updated_at: at(2026, 10, 13) },
      { id: "2", title: "Tatil", preview: "Antalya'da otel önerisi", updated_at: at(2026, 10, 13) },
    ];
    expect(groupConversations(rows, { now: NOW, query: "isik" })[0].items.map((c) => c.id)).toEqual(["1"]);
    expect(groupConversations(rows, { now: NOW, query: "OTEL" })[0].items.map((c) => c.id)).toEqual(["2"]);
    expect(groupConversations(rows, { now: NOW, query: "yok" })).toEqual([]);
    expect(matches(rows[0], "")).toBe(true);
    expect(fold("ŞEKER İçin")).toBe("seker icin");
  });

  test("rows without an id are ignored", () => {
    expect(groupConversations([{ title: "x" }, null], { now: NOW })).toEqual([]);
  });
});

describe("timeLabel", () => {
  test("clock today, Dün, a weekday this week, a date before", () => {
    expect(timeLabel(at(2026, 10, 13, 9), { lang: "tr", now: NOW })).toMatch(/09[.:]00/);
    expect(timeLabel(at(2026, 10, 12), { lang: "tr", now: NOW })).toBe("Dün");
    expect(timeLabel(at(2026, 10, 9), { lang: "tr", now: NOW }).length).toBeGreaterThan(1);
    expect(timeLabel(at(2026, 9, 1), { lang: "tr", now: NOW })).toMatch(/1/);
    expect(timeLabel("bad", { now: NOW })).toBe("");
  });
});
