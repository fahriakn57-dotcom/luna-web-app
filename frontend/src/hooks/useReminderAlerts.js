import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fetchReminders } from "@/lib/api";
import { formatTime } from "@/lib/dates";

// In-app reminder alerts. The server only delivers reminders to native push
// tokens and webhooks, so on the web nothing would ever ring — this hook
// watches the user's reminders while Luna is open and shows a toast, plays a
// short chime and (when the tab is in the background and the user allowed
// it) a system notification when one comes due.

const POLL_MS = 5 * 60 * 1000;
// Only the next few hours get a timer; the 5-minute poll picks up the rest.
const WINDOW_MS = 6 * 60 * 60 * 1000;
// A timer this late means the tab or the machine was asleep.
const LATE_MS = 2 * 60 * 1000;
const DAY_MS = 86400000;

export const isRecurring = (r) => !!r && (r.recurrence === "daily" || r.recurrence === "weekly" || r.recurrence === "monthly");

// Mirrors the server's _next_occurrence (services/background.py), in UTC
// like the server does it: daily +1 day, weekly +7 days, monthly +1
// calendar month with the day clamped (and it stays clamped: 31 → 28 → 28).
export function nextOccurrence(date, recurrence) {
  if (recurrence === "daily") return new Date(date.getTime() + DAY_MS);
  if (recurrence === "weekly") return new Date(date.getTime() + 7 * DAY_MS);
  if (recurrence === "monthly") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  }
  return null;
}

// The first occurrence of a series starting at `date` that falls after
// `afterMs` (null for a one-time reminder that's already past). The server
// moves due_at on about a minute after each firing — or not at all while its
// scheduler is down — so a series is never trusted to be current.
export function occurrenceAfter(date, recurrence, afterMs) {
  let at = date;
  const step = recurrence === "daily" ? DAY_MS : recurrence === "weekly" ? 7 * DAY_MS : 0;
  if (step && at.getTime() <= afterMs) {
    at = new Date(at.getTime() + (Math.floor((afterMs - at.getTime()) / step) + 1) * step);
  }
  for (let i = 0; i < 1200 && at && at.getTime() <= afterMs; i += 1) at = nextOccurrence(at, recurrence);
  return at;
}

// Phones can't show a notification made by the page: Chrome on Android (and
// so the Play Store app, a TWA) throws on `new Notification()` without a
// service worker, and iOS only offers them to installed apps through one.
// Reporting "unsupported" there keeps the panel from asking for a permission
// that would change nothing.
export function notificationPermission() {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")) return "unsupported";
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

// Module-level so a remount (e.g. a route change) never fires the same
// occurrence twice in one tab session. Keyed by id + occurrence time:
// a recurring reminder keeps its id but gets a new due_at every cycle.
const firedKeys = new Set();

let audioContext = null;

function getAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioContext) audioContext = new Ctx();
    if (audioContext.state === "suspended") {
      const resumed = audioContext.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

// A soft two-tone chime, synthesised so no audio file has to load.
function playChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const start = ctx.currentTime + 0.03;
    [[659.25, 0], [987.77, 0.17]].forEach(([frequency, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = start + offset;
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.15);
    });
  } catch {}
}

// Only when the user isn't looking at Luna: its tab is hidden, or its
// window sits behind another app (still "visible", but not focused).
function showSystemNotification(reminder) {
  try {
    const away = document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus());
    if (!away || notificationPermission() !== "granted") return;
    const notification = new Notification("Luna", {
      body: reminder.text,
      tag: String(reminder.id),
      icon: `${process.env.PUBLIC_URL || ""}/icon-192.png`,
    });
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {}
    };
  } catch {}
}

export function useReminderAlerts({ lang }) {
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let loadAgain = false;
    let warned = false;
    let audioUnlockAttached = false;
    const pending = new Map(); // occurrence key -> { timer, reminder, dueMs }

    const fire = (key, reminder, dueMs) => {
      if (firedKeys.has(key)) return;
      firedKeys.add(key);
      const currentLang = langRef.current;
      const tr = currentLang === "tr";
      const time = formatTime(new Date(dueMs), currentLang);
      const late = Date.now() - dueMs > LATE_MS;
      const title = late
        ? (tr ? `Kaçırılan hatırlatma · ${time}` : `Missed reminder · ${time}`)
        : (tr ? `Hatırlatma · ${time}` : `Reminder · ${time}`);
      toast(title, {
        id: key,
        description: reminder.text,
        duration: 20000,
        action: { label: tr ? "Tamam" : "OK", onClick: () => {} },
      });
      playChime();
      showSystemNotification(reminder);
    };

    // Browsers only let audio start after a user gesture (Safari is the
    // strictest), so unlock the chime on the next tap or key press once
    // something is actually scheduled.
    const unlockAudio = () => {
      detachAudioUnlock();
      getAudioContext();
    };
    const detachAudioUnlock = () => {
      if (!audioUnlockAttached) return;
      audioUnlockAttached = false;
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
    const attachAudioUnlock = () => {
      if (audioUnlockAttached || (audioContext && audioContext.state === "running")) return;
      audioUnlockAttached = true;
      window.addEventListener("pointerdown", unlockAudio, true);
      window.addEventListener("keydown", unlockAudio, true);
    };

    const clearPending = ({ flushOverdue }) => {
      const now = Date.now();
      pending.forEach(({ timer, reminder, dueMs }, key) => {
        clearTimeout(timer);
        // A timer still waiting past its due time was held up by a sleeping
        // tab; the fresh list may already mark it sent, so show it now
        // instead of dropping it.
        if (flushOverdue && dueMs <= now) fire(key, reminder, dueMs);
      });
      pending.clear();
    };

    const schedule = (reminders) => {
      clearPending({ flushOverdue: true });
      const now = Date.now();
      for (const reminder of reminders) {
        if (!reminder || reminder.sent || reminder.id == null || !reminder.text) continue;
        const due = new Date(reminder.due_at);
        if (isNaN(due)) continue;
        const at = isRecurring(reminder) ? occurrenceAfter(due, reminder.recurrence, now - 1) : due;
        if (!at) continue;
        const dueMs = at.getTime();
        if (dueMs < now || dueMs > now + WINDOW_MS) continue;
        const key = `${reminder.id}|${at.toISOString()}`;
        if (firedKeys.has(key) || pending.has(key)) continue;
        const timer = setTimeout(() => {
          pending.delete(key);
          fire(key, reminder, dueMs);
        }, dueMs - now);
        pending.set(key, { timer, reminder, dueMs });
      }
      if (pending.size > 0) attachAudioUnlock();
    };

    const load = async () => {
      if (loading) {
        loadAgain = true;
        return;
      }
      loading = true;
      try {
        const reminders = await fetchReminders();
        if (!disposed) schedule(Array.isArray(reminders) ? reminders : []);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn("Reminder alerts: could not load reminders", err?.message || err);
        }
      } finally {
        loading = false;
        if (loadAgain && !disposed) {
          loadAgain = false;
          load();
        }
      }
    };

    const onVisibility = () => {
      if (!document.hidden) load();
    };

    load();
    const poll = setInterval(load, POLL_MS);
    window.addEventListener("luna:reminders-changed", load);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      clearInterval(poll);
      window.removeEventListener("luna:reminders-changed", load);
      document.removeEventListener("visibilitychange", onVisibility);
      detachAudioUnlock();
      clearPending({ flushOverdue: false });
    };
  }, []);
}
