// What Luna's agent tools did in a turn (backend services/agent_tools.py):
// a live turn's `actions` and a stored reply's meta.agent_actions, cleaned
// for components/MessageExtras.jsx ActionCards — a reminder card with
// "Takvime ekle" (a Google Calendar link) and ".ics indir", a note, a goal,
// a memory, a reply preference.
//
// Backend contract: [{ type, id, summary, ...type fields }], a reminder with
// { text, due_at (UTC ISO), timezone, recurrence, calendar: { google_url,
// ics_url: "/api/reminders/{id}.ics" } }.

export const ACTION_TYPES = [
  "reminder_created", "reminder_cancelled", "note_created", "goal_added", "goal_completed",
  "memory_saved", "memory_forgotten", "preference_set",
];
const KNOWN = new Set(ACTION_TYPES);
const RECURRENCES = new Set(["none", "daily", "weekly", "monthly"]);
// Only Google Calendar's own "add event" page is ever opened from a card.
const GOOGLE_CALENDAR = "https://calendar.google.com/calendar/render?";
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_ACTIONS = 10;

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function validZone(zone) {
  if (typeof zone !== "string" || !zone || zone.length > 64) return "";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone ? zone : "";
  } catch (_) {
    return "";
  }
}

// Takes the backend's objects (lib/api.js passes them on as copies) and
// returns { type, id, summary, at, ...a reminder's text, dueAt, timezone,
// recurrence, googleUrl, icsId } — an already cleaned list passes unchanged.
export function normalizeActions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== "object" || !KNOWN.has(a.type)) continue;
    const id = typeof a.id === "string" || typeof a.id === "number" ? String(a.id) : "";
    const at = typeof a.at === "string" && !Number.isNaN(new Date(a.at).getTime()) ? a.at : "";
    const item = { type: a.type, id, summary: text(a.summary, 300), at };
    if (a.type === "reminder_created") {
      const rawDue = typeof a.due_at === "string" ? a.due_at : a.dueAt;
      const due = typeof rawDue === "string" && rawDue ? new Date(rawDue) : null;
      const cal = a.calendar && typeof a.calendar === "object" ? a.calendar : {};
      const google = typeof cal.google_url === "string" ? cal.google_url : a.googleUrl;
      const hasIcs = (typeof cal.ics_url === "string" && cal.ics_url) || a.icsId === id;
      item.text = text(a.text, 300);
      item.dueAt = due && !Number.isNaN(due.getTime()) ? due.toISOString() : "";
      item.timezone = validZone(a.timezone);
      item.recurrence = RECURRENCES.has(a.recurrence) ? a.recurrence : "none";
      item.googleUrl = typeof google === "string" && google.startsWith(GOOGLE_CALENDAR) ? google : "";
      item.icsId = OBJECT_ID.test(id) && hasIcs ? id : "";
    } else if (a.type === "reminder_cancelled") {
      item.text = text(a.text, 300);
    } else if (a.type === "preference_set" && typeof a.language === "string") {
      item.language = text(a.language, 8);
    }
    if (!item.summary && !item.text) continue;
    out.push(item);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

// A reminder's time for the person reading the card: in the reminder's own
// zone (where the user set it), in the interface language; "" when unknown.
export function formatDue(action, lang = "tr") {
  if (!action || !action.dueAt) return "";
  const date = new Date(action.dueAt);
  if (Number.isNaN(date.getTime())) return "";
  const locale = lang === "en" ? "en-GB" : lang === "tr" ? "tr-TR" : lang;
  const options = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  if (action.timezone) options.timeZone = action.timezone;
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch (_) {
    try {
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch (__) {
      return "";
    }
  }
}

// An action is "fresh" for this long after the server did it: only a fresh
// one changes anything on this device (a reloaded history never does).
export const FRESH_MS = 2 * 60 * 1000;
// Actions whose effects this tab already applied (a bubble re-rendering or
// re-mounting must not apply them again).
const applied = new Set();

export function isFresh(action, now = Date.now()) {
  if (!action || !action.at) return false;
  const at = new Date(action.at).getTime();
  return Number.isFinite(at) && now - at <= FRESH_MS && at - now <= FRESH_MS;
}

// What fresh actions change on this device, once each: the in-app reminder
// alerts (hooks/useReminderAlerts.js) and the Alarmlar panel pick up a new
// or deleted reminder at once, and a reply language Luna saved in the
// user's settings becomes this device's choice too — every message re-posts
// the device's choice (lib/api.js chatBody), which would otherwise switch it
// straight back. setReplyLang is passed in (lib/api.js owns it). Returns
// how many actions it applied.
// An action is applied once: a reminder or a note by its type and id (the
// same stored action re-rendered, or re-sent with a fresh timestamp, is the
// same action); a preference change also by its time, since every change of
// a user's preference carries the user's own id.
function actionKey(a) {
  return a.type === "preference_set" || !a.id ? `${a.type}:${a.id}:${a.at}:${a.summary}` : `${a.type}:${a.id}`;
}

export function applyActions(actions, { setReplyLang, now = Date.now() } = {}) {
  const list = normalizeActions(actions).filter((a) => isFresh(a, now) && !applied.has(actionKey(a)));
  if (!list.length) return 0;
  list.forEach((a) => applied.add(actionKey(a)));
  if (list.some((a) => a.type === "reminder_created" || a.type === "reminder_cancelled")) {
    try {
      window.dispatchEvent(new Event("luna:reminders-changed"));
    } catch (_) {}
  }
  const pref = list.find((a) => a.type === "preference_set" && a.language);
  if (pref && typeof setReplyLang === "function") setReplyLang(pref.language);
  return list.length;
}
