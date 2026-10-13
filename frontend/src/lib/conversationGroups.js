// Sohbetlerim: the chat list grouped the way people think about it —
// pinned chats first, then by day ("Bugün", "Dün", "Son 7 gün", "Bu ay",
// then month names) — plus the search filter and the short time label each
// row shows. Pure functions, so the panel stays simple and this is tested.

const LABELS = {
  pinned: { tr: "Sabitlenenler", en: "Pinned" },
  today: { tr: "Bugün", en: "Today" },
  yesterday: { tr: "Dün", en: "Yesterday" },
  week: { tr: "Son 7 gün", en: "Previous 7 days" },
  month: { tr: "Bu ay", en: "This month" },
};

const pick = (key, lang) => (LABELS[key] || {})[lang === "tr" ? "tr" : "en"];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Which bucket a chat updated at `iso` falls in, seen from `now`.
export function bucketOf(iso, now = new Date()) {
  const d = toDate(iso);
  if (!d) return "older:unknown";
  const today = startOfDay(now);
  const day = startOfDay(d);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return "week";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "month";
  return `older:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function olderLabel(key, lang, now) {
  const [, ym] = key.split(":");
  if (!ym || ym === "unknown") return lang === "tr" ? "Daha eski" : "Older";
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const opts = { month: "long", ...(y !== now.getFullYear() ? { year: "numeric" } : {}) };
  const label = d.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", opts);
  return label.charAt(0).toLocaleUpperCase(lang === "tr" ? "tr-TR" : "en-US") + label.slice(1);
}

// Lower-cased, diacritic-insensitive text for matching ("ışık" ~ "isik").
export function fold(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function matches(convo, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return fold(`${convo.title || ""} ${convo.preview || ""}`).includes(q);
}

// [{ key, label, items }] in display order; empty groups are left out.
export function groupConversations(list, { lang = "tr", now = new Date(), query = "" } = {}) {
  const rows = (Array.isArray(list) ? list : []).filter((c) => c && c.id && matches(c, query));
  const groups = new Map();
  const add = (key, label, c) => {
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(c);
  };
  const sorted = [...rows].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  for (const c of sorted) {
    if (c.pinned) {
      add("pinned", pick("pinned", lang), c);
      continue;
    }
    const key = bucketOf(c.updated_at, now);
    const label = key.startsWith("older:") ? olderLabel(key, lang, now) : pick(key, lang);
    add(key, label, c);
  }
  const order = ["pinned", "today", "yesterday", "week", "month"];
  const fixed = order.filter((k) => groups.has(k)).map((k) => groups.get(k));
  const older = [...groups.keys()].filter((k) => k.startsWith("older:")).sort().reverse().map((k) => groups.get(k));
  return [...fixed, ...older];
}

// The short time on the right of a row: a clock time today, "Dün", a weekday
// this week, else a short date.
export function timeLabel(iso, { lang = "tr", now = new Date() } = {}) {
  const d = toDate(iso);
  if (!d) return "";
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const b = bucketOf(iso, now);
  if (b === "today") return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (b === "yesterday") return pick("yesterday", lang);
  if (b === "week") return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}) });
}
