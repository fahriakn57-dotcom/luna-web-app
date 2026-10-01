// Date helpers shared by the panels. Everything is in the viewer's LOCAL
// time — a "day" is the user's calendar day, not UTC's.

export const locale = (lang) => (lang === "tr" ? "tr-TR" : "en-US");

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" for a Date in local time.
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Parses "YYYY-MM-DD" as LOCAL midnight (new Date("2026-10-01") would be
// UTC midnight, i.e. the previous evening west of Greenwich).
export function parseDayKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Whole calendar days from a to b (b later => positive), DST-safe.
export function daysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDayKey(value);
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

// "az önce", "5 dk önce", "3 saat önce", "dün", "4 gün önce", "2 hafta önce",
// "3 ay önce", "1 yıl önce" — past only; future values read as "az önce".
export function relativeTime(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  const tr = lang === "tr";
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return tr ? "az önce" : "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return tr ? `${mins} dk önce` : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const days = daysBetween(d, new Date());
  if (days === 0) return tr ? `${hours} saat önce` : `${hours} h ago`;
  if (days === 1) return tr ? "dün" : "yesterday";
  if (days < 7) return tr ? `${days} gün önce` : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return tr ? `${w} hafta önce` : `${w} week${w > 1 ? "s" : ""} ago`;
  }
  if (days < 365) {
    const mo = Math.max(1, Math.floor(days / 30));
    return tr ? `${mo} ay önce` : `${mo} month${mo > 1 ? "s" : ""} ago`;
  }
  const y = Math.floor(days / 365);
  return tr ? `${y} yıl önce` : `${y} year${y > 1 ? "s" : ""} ago`;
}

export function formatDate(value, lang, opts = { day: "numeric", month: "long", year: "numeric" }) {
  const d = toDate(value);
  return d ? d.toLocaleDateString(locale(lang), opts) : "";
}

export function formatTime(value, lang) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" }) : "";
}

// "Bugün", "Yarın", "Dün", otherwise "12 Ekim Pzt" (year added when not
// this year).
export function friendlyDay(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  const tr = lang === "tr";
  const diff = daysBetween(new Date(), d);
  if (diff === 0) return tr ? "Bugün" : "Today";
  if (diff === 1) return tr ? "Yarın" : "Tomorrow";
  if (diff === -1) return tr ? "Dün" : "Yesterday";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(lang), sameYear
    ? { day: "numeric", month: "long", weekday: "short" }
    : { day: "numeric", month: "long", year: "numeric" });
}
