// Goals & plans: data rules shared by the panel and its parts.
import { Briefcase, GraduationCap, HeartPulse, Shapes, User, Users, Wallet } from "lucide-react";
import { ACCENTS } from "@/components/panel/Panel";
import { addDays, dayKey, daysBetween, formatDate, parseDayKey } from "@/lib/dates";

// Server-side limits (backend/luna/routers/goals.py) — capped here so a
// save never fails on length.
export const MAX_STEPS = 30;
export const STEP_MAX = 200;
export const TITLE_MAX = 300;
export const DESCRIPTION_MAX = 2000;
export const PROGRESS_DEBOUNCE_MS = 400;
// A just-completed item stays where it is this long, so the check animation
// is seen before it moves down into "Tamamlananlar".
export const LINGER_MS = 1400;

export const CATEGORY_META = {
  "kişisel": { tr: "Kişisel", en: "Personal", icon: User, accent: "violet" },
  "sağlık": { tr: "Sağlık", en: "Health", icon: HeartPulse, accent: "rose" },
  "kariyer": { tr: "Kariyer", en: "Career", icon: Briefcase, accent: "sky" },
  "eğitim": { tr: "Eğitim", en: "Education", icon: GraduationCap, accent: "amber" },
  "finans": { tr: "Finans", en: "Finance", icon: Wallet, accent: "emerald" },
  "ilişkiler": { tr: "İlişkiler", en: "Relationships", icon: Users, accent: "fuchsia" },
  "diğer": { tr: "Diğer", en: "Other", icon: Shapes, accent: "indigo" },
};
export const DEFAULT_CATEGORIES = Object.keys(CATEGORY_META);

export const EXAMPLES = {
  goal: [["Yılda 24 kitap oku", "Read 24 books this year"], ["10 km koş", "Run 10 km"]],
  plan: [["Hafta sonu İzmir gezisi", "Weekend trip to İzmir"], ["Taşınma listesi", "Moving checklist"]],
};

export const BUCKETS = [
  { key: "overdue", tr: "Gecikmiş", en: "Overdue" },
  { key: "today", tr: "Bugün", en: "Today" },
  { key: "tomorrow", tr: "Yarın", en: "Tomorrow" },
  { key: "week", tr: "Bu hafta", en: "This week" },
  { key: "later", tr: "Daha sonra", en: "Later" },
  { key: "undated", tr: "Tarihsiz", en: "No date" },
];

// One request at a time per item, in order: each step tap sends the whole
// step list, so two quick taps must not reach the server out of order, and a
// toggle must not race a PATCH (the server answers that with 409).
export function enqueue(queues, id, request) {
  const run = (queues.get(id) || Promise.resolve()).then(request);
  const tail = run.then(() => {}, () => {});
  queues.set(id, tail);
  tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return run;
}

export const kindOf = (item) => (item?.kind === "plan" ? "plan" : "goal");
export const clampProgress = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

// Old docs have no kind/steps; everything downstream can rely on these.
export function normalize(item) {
  return {
    ...item,
    kind: kindOf(item),
    title: item.title || "",
    description: item.description || "",
    deadline: item.deadline || null,
    steps: Array.isArray(item.steps) ? item.steps : [],
    progress: clampProgress(item.progress),
    done: !!item.done,
  };
}

export function newStepId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Same rule as the server: with steps, progress and done follow them.
export function withSteps(item, steps) {
  if (!steps.length) return { ...item, steps };
  const doneCount = steps.filter((s) => s.done).length;
  return { ...item, steps, progress: Math.round((100 * doneCount) / steps.length), done: doneCount === steps.length };
}

// Trims, drops blank steps and keeps a step that was typed but not yet added.
export function cleanSteps(steps, pending) {
  const out = steps.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
  const extra = (pending || "").trim();
  if (extra && out.length < MAX_STEPS) out.push({ id: newStepId(), text: extra.slice(0, STEP_MAX), done: false });
  return out;
}

export const sameSteps = (a, b) =>
  a.length === b.length && a.every((s, i) => s.id === b[i].id && s.text === b[i].text && !!s.done === !!b[i].done);

export const stripBullet = (line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, "").trim();

export const formatPercent = (value, lang) =>
  new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(value / 100);

export const daysUntil = (key) => {
  const date = parseDayKey(key);
  return date ? daysBetween(new Date(), date) : null;
};

export function bucketOf(item) {
  const days = daysUntil(item.deadline);
  if (days === null) return "undated";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

export const timeOf = (value) => {
  const d = value ? new Date(value) : null;
  return d && !isNaN(d) ? d.getTime() : 0;
};
// Soonest date first, undated last; newest first among equals.
export const byDeadline = (a, b) => {
  if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
  if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
  return timeOf(b.created_at) - timeOf(a.created_at);
};
export const byCompleted = (a, b) => timeOf(b.updated_at || b.created_at) - timeOf(a.updated_at || a.created_at);

export function deadlineInfo(key, lang) {
  const date = parseDayKey(key);
  if (!date) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    date,
    days: daysBetween(new Date(), date),
    short: formatDate(date, lang, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }),
    full: formatDate(date, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  };
}

export function quickDates(kind, t) {
  const today = new Date();
  if (kind === "plan") {
    const dow = today.getDay();
    // On a Sunday "hafta sonu" is still today.
    const weekend = addDays(today, dow === 0 ? 0 : 6 - dow);
    return [
      { key: "today", label: t("Bugün", "Today"), value: dayKey(today) },
      { key: "tomorrow", label: t("Yarın", "Tomorrow"), value: dayKey(addDays(today, 1)) },
      { key: "weekend", label: t("Hafta sonu", "Weekend"), value: dayKey(weekend) },
    ];
  }
  // 31 Ocak + 1 ay = 28/29 Şubat, not 3 Mart.
  const inMonths = (n) => {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + n + 1, 0).getDate();
    return dayKey(new Date(today.getFullYear(), today.getMonth() + n, Math.min(today.getDate(), lastDay)));
  };
  return [
    { key: "1m", label: t("1 ay sonra", "In a month"), value: inMonths(1) },
    { key: "3m", label: t("3 ay sonra", "In 3 months"), value: inMonths(3) },
    { key: "eoy", label: t("Yıl sonu", "End of year"), value: `${today.getFullYear()}-12-31` },
  ];
}

// `hue` lights the category glyph (a Celestial hue family, same as the
// accent); `color`/`tile` tint the tag, the label and the progress bar.
export function categoryInfo(key, lang) {
  const meta = CATEGORY_META[key];
  const hue = meta?.accent || "indigo";
  const tone = ACCENTS[hue];
  // An unknown category (e.g. one added on the server later) still reads
  // like a label rather than a lower-case key.
  const label = meta
    ? (lang === "tr" ? meta.tr : meta.en)
    : key ? key.charAt(0).toLocaleUpperCase("tr-TR") + key.slice(1) : (lang === "tr" ? "Diğer" : "Other");
  return { icon: meta?.icon || Shapes, hue, color: tone.fg, tile: tone.tile, label };
}

export const emptyDraft = (kind, title, category) => ({
  kind, title: title || "", description: "", category, deadline: "", steps: [], stepDraft: "",
});
export const draftFrom = (item) => ({
  kind: item.kind, title: item.title, description: item.description, category: item.category || "kişisel",
  deadline: item.deadline || "", steps: item.steps.map((s) => ({ ...s })), stepDraft: "",
});
export const isDraftDirty = (d) => !!(d.title.trim() || d.description.trim() || d.steps.length || d.stepDraft.trim());
export const isEditDirty = (d, item) =>
  !!item && (d.title.trim() !== item.title || d.description.trim() !== item.description ||
    (d.deadline || "") !== (item.deadline || "") || d.category !== (item.category || "kişisel") ||
    !!d.stepDraft.trim() || !sameSteps(cleanSteps(d.steps), item.steps));

// The API answers 400/409 with a Turkish, user-facing `detail`.
export function errorDetail(err, lang, fallback) {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (lang === "tr" && (status === 400 || status === 409) && typeof detail === "string") return detail;
  return fallback;
}
