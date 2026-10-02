import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlarmClock, Bell, BellOff, BellRing, ChevronLeft, ChevronRight, Loader2, Plus, Repeat, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { fetchReminders, createReminder, cancelReminder } from "@/lib/api";
import { GlowIcon, GlyphTile } from "@/components/icons/GlyphTile";
import {
  Panel, PanelHeader, PanelBody, IconButton, Chip, Segmented, SectionLabel, EmptyState, SkeletonList, ErrorState,
  usePanelTitleId, fieldClass, primaryButtonClass, secondaryButtonClass, ghostButtonClass,
} from "@/components/panel/Panel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { addDays, dayKey, daysBetween, formatDate, formatTime, friendlyDay, locale, parseDayKey } from "@/lib/dates";
import { isRecurring, nextOccurrence, notificationPermission, occurrenceAfter } from "@/hooks/useReminderAlerts";

// The API cuts reminder text at 500 characters, so cap the field instead.
const MAX_TEXT = 500;
const DAY_MS = 86400000;
const QUICK_TIMES = ["09:00", "12:00", "18:00", "21:00"];
const NOTIFY_DISMISSED_KEY = "luna_reminder_notify_dismissed";

const RECURRENCE = {
  none: ["Bir kez", "Once"],
  daily: ["Her gün", "Daily"],
  weekly: ["Her hafta", "Weekly"],
  monthly: ["Her ay", "Monthly"],
};

// Ordered by the week start of each language: Monday for TR, Sunday for EN.
const WEEKDAYS = {
  tr: {
    short: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"],
    long: ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"],
  },
  en: {
    short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    long: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
};

const pad2 = (n) => String(n).padStart(2, "0");
const byTime = (a, b) => a.at - b.at;
const notifyRemindersChanged = () => window.dispatchEvent(new Event("luna:reminders-changed"));

// Rolls a series that would start in the past forward to its first future
// occurrence; otherwise the server would fire it the moment it's saved.
const firstFutureOccurrence = (date, recurrence, nowMs) => occurrenceAfter(date, recurrence, nowMs) || date;

function makeOccurrence(reminder, at, nowMs) {
  return {
    key: `${reminder.id}|${at.getTime()}`,
    reminder,
    at,
    past: at.getTime() < nowMs || (!isRecurring(reminder) && !!reminder.sent),
  };
}

// Every occurrence in [fromMs, toMs). One-time reminders show once (fired
// ones too); a series expands from its next due_at forward — the server
// moves due_at to the next occurrence after each firing.
function occurrencesBetween(reminders, fromMs, toMs, nowMs) {
  const out = [];
  for (const r of reminders) {
    let at = r?.due_at ? new Date(r.due_at) : null;
    if (!at || isNaN(at)) continue;
    if (!isRecurring(r)) {
      if (at.getTime() >= fromMs && at.getTime() < toMs) out.push(makeOccurrence(r, at, nowMs));
      continue;
    }
    const step = r.recurrence === "daily" ? DAY_MS : r.recurrence === "weekly" ? 7 * DAY_MS : 0;
    if (step && at.getTime() < fromMs) {
      at = new Date(at.getTime() + Math.floor((fromMs - at.getTime()) / step) * step);
    }
    for (let i = 0; i < 1000 && at && at.getTime() < toMs; i += 1) {
      if (at.getTime() >= fromMs) out.push(makeOccurrence(r, at, nowMs));
      at = nextOccurrence(at, r.recurrence);
    }
  }
  return out.sort(byTime);
}

// A series appears once, at its next time — otherwise one daily reminder
// would fill the whole list and push every other reminder out of it.
function upcomingOccurrences(reminders, nowMs, limit) {
  const out = [];
  for (const r of reminders) {
    if (!r?.due_at || r.sent) continue;
    const due = new Date(r.due_at);
    if (isNaN(due)) continue;
    const at = isRecurring(r) ? occurrenceAfter(due, r.recurrence, nowMs - 1) : due;
    if (at && at.getTime() >= nowMs) out.push(makeOccurrence(r, at, nowMs));
  }
  return out.sort(byTime).slice(0, limit);
}

function groupByDay(occurrences) {
  const map = new Map();
  for (const o of occurrences) {
    const key = dayKey(o.at);
    const list = map.get(key);
    if (list) list.push(o);
    else map.set(key, [o]);
  }
  return map;
}

// Always six weeks, so the calendar keeps its height from month to month.
function monthGrid(year, month, weekStartsOn) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -((first.getDay() - weekStartsOn + 7) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return { weeks, startMs: start.getTime(), endMs: addDays(start, 42).getTime() };
}

function addMonthsClamped(date, n) {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

// A date input reports half-typed years ("0002-10-01") while the user types,
// so only a plausible, complete day may move the calendar.
function plausibleDayKey(value) {
  const d = parseDayKey(value);
  return !!d && dayKey(d) === value && d.getFullYear() >= 2000 && d.getFullYear() <= 2200;
}

function parseLocalDateTime(date, time) {
  if (!parseDayKey(date) || !/^\d{2}:\d{2}/.test(time || "")) return null;
  const d = new Date(`${date}T${time.slice(0, 5)}:00`);
  return isNaN(d) ? null : d;
}

// Today: the next full hour; any other day: 09:00.
function defaultTime(key, nowMs) {
  const now = new Date(nowMs);
  if (key !== dayKey(now) || now.getHours() >= 23) return "09:00";
  return `${pad2(now.getHours() + 1)}:00`;
}

// "şimdi", "25 dk sonra", "2 saat sonra", "yarın 09:00", "Cuma 09:00", "12 Eki 09:00"
function untilLabel(at, nowMs, lang) {
  const tr = lang === "tr";
  const mins = Math.round((at.getTime() - nowMs) / 60000);
  if (mins < 1) return tr ? "şimdi" : "now";
  if (mins < 60) return tr ? `${mins} dk sonra` : `in ${mins} min`;
  const days = daysBetween(new Date(nowMs), at);
  const time = formatTime(at, lang);
  if (days === 0) {
    const hours = Math.min(23, Math.round(mins / 60));
    return tr ? `${hours} saat sonra` : `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (days === 1) return tr ? `yarın ${time}` : `tomorrow ${time}`;
  if (days < 7) return `${formatDate(at, lang, { weekday: "long" })} ${time}`;
  return `${formatDate(at, lang, { day: "numeric", month: "short" })} ${time}`;
}

const countLabel = (n, lang) => (lang === "tr" ? `${n} hatırlatma` : `${n} reminder${n === 1 ? "" : "s"}`);
const shorten = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const timeFormatters = {};
function timeParts(date, lang) {
  const loc = locale(lang);
  if (!timeFormatters[loc]) timeFormatters[loc] = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
  const parts = timeFormatters[loc].formatToParts(date);
  return {
    main: parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value || "",
  };
}

// "09:00", or "09:00" with a smaller "AM" in English.
function TimeText({ date, lang, className, periodClassName }) {
  const { main, period } = timeParts(date, lang);
  return (
    <time dateTime={date.toISOString()} className={className}>
      {main}
      {period && <span className={periodClassName}> {period}</span>}
    </time>
  );
}

function MonthCalendar({ t, lang, grid, selectedKey, todayKey, byDay, onSelect, onStepMonth, onToday }) {
  const titleId = useId();
  const gridRef = useRef(null);
  const focusPending = useRef(false);
  const selected = parseDayKey(selectedKey);
  const month = selected.getMonth();
  const weekStartsOn = lang === "tr" ? 1 : 0;
  const names = WEEKDAYS[lang === "tr" ? "tr" : "en"];
  const title = formatDate(new Date(selected.getFullYear(), month, 1), lang, { month: "long", year: "numeric" });

  // Keyboard moves (and clicks on a day of another month, which re-render
  // the grid) keep focus on the newly selected day.
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector(`[data-day="${selectedKey}"]`)?.focus();
  }, [selectedKey]);

  const pick = (key) => {
    if (key === selectedKey) return;
    focusPending.current = true;
    onSelect(key);
  };

  const onKeyDown = (e) => {
    // Leave Alt+Arrow (browser back/forward) and other shortcuts alone.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const offset = (selected.getDay() - weekStartsOn + 7) % 7;
    let next = null;
    switch (e.key) {
      case "ArrowLeft": next = addDays(selected, -1); break;
      case "ArrowRight": next = addDays(selected, 1); break;
      case "ArrowUp": next = addDays(selected, -7); break;
      case "ArrowDown": next = addDays(selected, 7); break;
      case "Home": next = addDays(selected, -offset); break;
      case "End": next = addDays(selected, 6 - offset); break;
      case "PageUp": next = addMonthsClamped(selected, -1); break;
      case "PageDown": next = addMonthsClamped(selected, 1); break;
      default: return;
    }
    e.preventDefault();
    pick(dayKey(next));
  };

  return (
    <div className="mx-auto w-full max-w-[400px] rounded-[22px] border border-white/[0.06] bg-white/[0.025] p-3 md:max-w-none" data-testid="reminder-calendar">
      <div className="mb-1.5 flex items-center gap-1 pl-2">
        <h3 id={titleId} aria-live="polite" className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-white tabular-nums">
          {title}
        </h3>
        <button type="button" onClick={onToday} className={`${ghostButtonClass} h-9 px-3`} data-testid="reminder-today-button">
          {t("Bugün", "Today")}
        </button>
        <IconButton label={t("Önceki ay", "Previous month")} onClick={() => onStepMonth(-1)} size={40} testId="reminder-prev-month">
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton label={t("Sonraki ay", "Next month")} onClick={() => onStepMonth(1)} size={40} testId="reminder-next-month">
          <ChevronRight size={18} />
        </IconButton>
      </div>

      <div role="grid" aria-labelledby={titleId} ref={gridRef} onKeyDown={onKeyDown}>
        <div role="row" className="grid grid-cols-7">
          {names.short.map((name, i) => (
            <div key={name} role="columnheader" aria-label={names.long[i]} title={names.long[i]}
              className="pb-1.5 pt-1 text-center text-[11px] font-medium text-white/35">
              {name}
            </div>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={dayKey(week[0])} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const key = dayKey(day);
              const inMonth = day.getMonth() === month;
              const isSelected = key === selectedKey;
              const isToday = key === todayKey;
              const occurrences = byDay.get(key) || [];
              const label = [
                formatDate(day, lang, { day: "numeric", month: "long", year: "numeric" }),
                occurrences.length ? countLabel(occurrences.length, lang) : null,
                isToday ? t("bugün", "today") : null,
              ].filter(Boolean).join(", ");

              let tone;
              if (isSelected) tone = "bg-sky-300 font-semibold text-slate-950 shadow-[0_6px_16px_-6px_rgba(56,189,248,0.75)]";
              else if (isToday) tone = "font-semibold text-sky-200 ring-1 ring-inset ring-sky-300/55 hover:bg-sky-300/10";
              else if (!inMonth) tone = "text-white/25 hover:bg-white/[0.04] hover:text-white/55";
              else if (key < todayKey) tone = "text-white/50 hover:bg-white/[0.06] hover:text-white/80";
              else tone = "text-white/85 hover:bg-white/[0.07] hover:text-white";

              return (
                <div key={key} role="gridcell" aria-selected={isSelected} className="flex min-w-0 justify-center py-0.5">
                  <button type="button" data-day={key} tabIndex={isSelected ? 0 : -1} aria-label={label}
                    aria-current={isToday ? "date" : undefined} onClick={() => pick(key)} data-testid="reminder-calendar-day"
                    className={`flex aspect-square w-full max-w-[40px] flex-col items-center justify-center gap-[3px] rounded-full text-[13px] leading-none tabular-nums transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0b1d] ${tone}`}>
                    <span>{day.getDate()}</span>
                    <span aria-hidden="true" className="flex h-1 items-center gap-[3px]">
                      {occurrences.slice(0, 3).map((o) => {
                        let dot;
                        if (isSelected) dot = o.past ? "bg-slate-950/35" : "bg-slate-950/75";
                        else if (o.past) dot = "bg-white/25";
                        else dot = inMonth ? "bg-sky-300" : "bg-sky-300/40";
                        return <span key={o.key} className={`h-1 w-1 rounded-full ${dot}`} />;
                      })}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecurrencePill({ t, recurrence }) {
  const label = RECURRENCE[recurrence];
  if (!label || recurrence === "none") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-200">
      <GlowIcon icon={Repeat} hue="sky" size={12} />
      {t(label[0], label[1])}
    </span>
  );
}

function AgendaItem({ t, lang, occurrence, nowMs, onDelete }) {
  const { reminder, at, past } = occurrence;
  const soon = !past && daysBetween(new Date(nowMs), at) === 0;
  return (
    <li data-testid="reminder-item"
      className="group flex items-start gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] py-3 pl-4 pr-2 transition-colors hover:border-white/10 hover:bg-white/[0.035]">
      <TimeText date={at} lang={lang}
        className={`min-w-[3.25rem] shrink-0 whitespace-nowrap pt-px text-[20px] font-semibold leading-6 tracking-[-0.02em] tabular-nums ${past ? "text-white/35" : "text-white"}`}
        periodClassName="text-[11px] font-medium tracking-normal text-white/45" />
      <div className="min-w-0 flex-1 border-l border-white/[0.06] pl-3.5">
        <p className={`break-words text-[15px] leading-6 ${past ? "text-white/45" : "text-white/90"}`}>{reminder.text}</p>
        {(past || soon || isRecurring(reminder)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RecurrencePill t={t} recurrence={reminder.recurrence} />
            {past && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/45">{t("Geçti", "Passed")}</span>
            )}
            {soon && <span className="text-xs tabular-nums text-sky-200/75">{untilLabel(at, nowMs, lang)}</span>}
          </div>
        )}
      </div>
      <div className="-my-1 shrink-0 transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label={t("Hatırlatmayı sil", "Delete reminder")} onClick={onDelete} testId="reminder-cancel-button">
          <Trash2 size={15} />
        </IconButton>
      </div>
    </li>
  );
}

function UpcomingList({ t, lang, items, nowMs, loading, onPick }) {
  let content;
  if (loading) {
    content = <SkeletonList rows={2} label={t("Yaklaşan hatırlatmalar yükleniyor", "Loading upcoming reminders")} />;
  } else if (items.length === 0) {
    content = (
      <p className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-3.5 text-[13px] text-white/40">
        {t("Yaklaşan hatırlatma yok.", "Nothing coming up.")}
      </p>
    );
  } else {
    content = (
      <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        {items.map((o) => (
          <li key={o.key}>
            <button type="button" onClick={() => onPick(dayKey(o.at))} data-testid="reminder-upcoming-item"
              className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300/60">
              <GlowIcon icon={AlarmClock} hue="sky" size={15} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white/85">{o.reminder.text}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs tabular-nums text-sky-200/75">
                  {untilLabel(o.at, nowMs, lang)}
                  {isRecurring(o.reminder) && (
                    <>
                      <GlowIcon icon={Repeat} hue="sky" size={12} className="opacity-70" />
                      <span className="sr-only">{t(RECURRENCE[o.reminder.recurrence][0], RECURRENCE[o.reminder.recurrence][1])}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section aria-label={t("Yaklaşan hatırlatmalar", "Upcoming reminders")} data-testid="reminder-upcoming">
      <SectionLabel>{t("Yaklaşan", "Coming up")}</SectionLabel>
      {content}
    </section>
  );
}

function ReminderComposer({ t, lang, draft, onChange, onSubmit, onCancel, saving, nowMs, todayKey, inputRef }) {
  const textId = useId();
  const dateId = useId();
  const timeId = useId();
  const hintId = useId();
  const due = parseLocalDateTime(draft.date, draft.time);
  const recurring = draft.recurrence !== "none";
  const isPast = !!due && due.getTime() <= nowMs;
  const blocked = isPast && !recurring;
  const firstAt = isPast && recurring ? firstFutureOccurrence(due, draft.recurrence, nowMs) : null;
  const canSave = !!draft.text.trim() && !!due && !blocked && !saving;

  let hint = null;
  if (!due) {
    hint = { tone: "text-amber-200/85", text: t("Bir tarih ve saat seç.", "Pick a date and a time.") };
  } else if (blocked) {
    hint = { tone: "text-amber-200/85", text: t("Bu saat geçti. İleri bir tarih ya da saat seç.", "That time has passed. Pick a later date or time."), testId: "reminder-past-warning" };
  } else if (firstAt) {
    hint = { tone: "text-sky-200/80", text: t(`İlk hatırlatma: ${untilLabel(firstAt, nowMs, lang)}`, `First reminder: ${untilLabel(firstAt, nowMs, lang)}`) };
  } else {
    hint = { tone: "text-white/45", text: `${friendlyDay(due, lang)}, ${formatTime(due, lang)}` };
  }

  const onKeyDown = (e) => {
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // While saving, closing would throw away the text the error toast
      // promises is still here.
      if (!saving) onCancel();
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (canSave) onSubmit();
  };

  const quickTimeLabel = (value) => {
    const [h, m] = value.split(":").map(Number);
    return formatTime(new Date(2000, 0, 1, h, m), lang);
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} noValidate aria-label={t("Yeni hatırlatma", "New reminder")} data-testid="reminder-composer"
      className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] transition-[border-color,box-shadow] focus-within:border-sky-300/30 focus-within:ring-4 focus-within:ring-sky-400/10 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <label htmlFor={textId} className="sr-only">{t("Ne hatırlatılsın?", "What should Luna remind you about?")}</label>
      <input id={textId} ref={inputRef} value={draft.text} onChange={(e) => onChange({ text: e.target.value })}
        maxLength={MAX_TEXT} autoComplete="off" enterKeyHint="done" readOnly={saving} data-testid="reminder-text-input"
        placeholder={t("Ne hatırlatayım?", "What should I remind you about?")}
        className="block w-full rounded-t-2xl bg-transparent px-4 pb-3 pt-3.5 text-[15px] text-white outline-none placeholder:text-white/30" />

      <div className="space-y-3.5 border-t border-white/[0.06] px-4 py-3.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0">
            <label htmlFor={dateId} className="mb-1.5 block text-xs font-medium text-white/45">{t("Tarih", "Date")}</label>
            <input id={dateId} type="date" value={draft.date} min={todayKey} required
              onChange={(e) => onChange({ date: e.target.value })} data-testid="reminder-date-input"
              className={`${fieldClass} min-h-[42px] min-w-0 tabular-nums [color-scheme:dark]`} />
          </div>
          <div className="min-w-0">
            <label htmlFor={timeId} className="mb-1.5 block text-xs font-medium text-white/45">{t("Saat", "Time")}</label>
            <input id={timeId} type="time" value={draft.time} required aria-describedby={hintId}
              onChange={(e) => onChange({ time: e.target.value })} data-testid="reminder-time-input"
              className={`${fieldClass} min-h-[42px] min-w-0 tabular-nums [color-scheme:dark]`} />
          </div>
        </div>

        <div role="group" aria-label={t("Hızlı saat seçimi", "Quick times")} className="flex flex-wrap gap-1.5">
          {QUICK_TIMES.map((value) => (
            <Chip key={value} active={draft.time === value} onClick={() => onChange({ time: value })} testId="reminder-time-chip">
              <span className="tabular-nums">{quickTimeLabel(value)}</span>
            </Chip>
          ))}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-white/45">{t("Tekrar", "Repeat")}</p>
          <div data-testid="reminder-recurrence-select" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Segmented size="sm" label={t("Tekrar", "Repeat")} value={draft.recurrence} testIdPrefix="reminder-recurrence"
              onChange={(value) => onChange({ recurrence: value })}
              options={Object.entries(RECURRENCE).map(([value, [tr, en]]) => ({ value, label: t(tr, en) }))} />
          </div>
        </div>

        <p id={hintId} aria-live="polite" data-testid={hint.testId} className={`min-h-[18px] text-xs leading-relaxed tabular-nums ${hint.tone}`}>
          {hint.text}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryButtonClass} data-testid="reminder-cancel-compose">
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="submit" disabled={!canSave} aria-busy={saving} className={primaryButtonClass} data-testid="reminder-save-button">
          {saving && <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          {t("Kaydet", "Save")}
        </button>
      </div>
    </form>
  );
}

function NotifyBanner({ t, onAllow, onDismiss }) {
  return (
    <div data-testid="reminder-notify-banner"
      className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-300/15 bg-sky-400/[0.06] py-3.5 pl-3.5 pr-2">
      <GlyphTile icon={BellRing} hue="sky" size={36} />
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <p className="pt-0.5 text-[13px] leading-snug text-white/60 sm:flex-1 sm:pt-0">
          <span className="font-medium text-white/90">{t("Hatırlatmalar Luna açıkken ekranda çıkar.", "Reminders appear on screen while Luna is open.")}</span>{" "}
          {t("Sekme arka plandayken de haber alman için bildirimlere izin ver.", "Allow notifications to hear about them while the tab is in the background too.")}
        </p>
        <button type="button" onClick={onAllow} className={`${secondaryButtonClass} mt-3 shrink-0 sm:mt-0`} data-testid="reminder-notify-button">
          <Bell size={14} aria-hidden="true" /> {t("Bildirimlere izin ver", "Allow notifications")}
        </button>
      </div>
      <IconButton label={t("Şimdi değil", "Not now")} onClick={onDismiss} size={32} testId="reminder-notify-dismiss">
        <X size={15} />
      </IconButton>
    </div>
  );
}

// The bell's hue follows the notification state: sky (on screen only),
// emerald (notifications on), amber (blocked by the browser).
function DeliveryNote({ t, permission, onAllow }) {
  let Icon = Bell;
  let hue = "sky";
  let text = t("Hatırlatmalar Luna açıkken ekranda çıkar.", "Reminders appear on screen while Luna is open.");
  if (permission === "granted") {
    Icon = BellRing;
    hue = "emerald";
    text = t("Hatırlatmalar Luna açıkken ekranda ve bildirim olarak çıkar.", "Reminders appear on screen and as notifications while Luna is open.");
  } else if (permission === "denied") {
    Icon = BellOff;
    hue = "amber";
    text = t(
      "Tarayıcın bu site için bildirimleri engelliyor; hatırlatmalar Luna açıkken yine ekranda çıkar. İzni adres çubuğundaki site ayarlarından açabilirsin.",
      "Your browser blocks notifications for this site; reminders still appear on screen while Luna is open. You can allow them in the site settings next to the address bar.",
    );
  }
  return (
    <div className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-white/40" data-testid="reminder-delivery-note">
      <GlowIcon icon={Icon} hue={hue} size={14} className="mt-0.5 opacity-80" />
      <p>
        {text}
        {permission === "default" && (
          <>
            {" "}
            <button type="button" onClick={onAllow} data-testid="reminder-notify-button"
              className="rounded font-semibold text-sky-200/85 underline-offset-2 hover:text-sky-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60">
              {t("Bildirimlere izin ver", "Allow notifications")}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

export default function RemindersPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const agendaTitleId = useId();
  const [reminders, setReminders] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading" | "error" | "ready"
  const [now, setNow] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState(() => dayKey());
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({ text: "", date: dayKey(), time: "09:00", recurrence: "none" }));
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [permission, setPermission] = useState(notificationPermission);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [focusRequest, setFocusRequest] = useState(0);
  const textRef = useRef(null);
  const agendaHeadingRef = useRef(null);
  // Synchronous guard: two quick Enters can land before `saving` re-renders.
  const savingRef = useRef(false);
  const deleteTriggerRef = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const list = await fetchReminders();
      setReminders(Array.isArray(list) ? list : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keeps "Geçti" badges, countdowns and the today ring current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // The permission can change in the browser's site settings meanwhile.
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (focusRequest) textRef.current?.focus();
  }, [focusRequest]);

  const todayKey = dayKey(new Date(now));
  const selectedDate = parseDayKey(selectedKey);
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const weekStartsOn = lang === "tr" ? 1 : 0;

  const grid = useMemo(() => monthGrid(year, month, weekStartsOn), [year, month, weekStartsOn]);
  const byDay = useMemo(() => groupByDay(occurrencesBetween(reminders, grid.startMs, grid.endMs, now)), [reminders, grid, now]);
  const agenda = useMemo(() => {
    const start = parseDayKey(selectedKey);
    return occurrencesBetween(reminders, start.getTime(), addDays(start, 1).getTime(), now);
  }, [reminders, selectedKey, now]);
  const upcoming = useMemo(() => upcomingOccurrences(reminders, now, 5), [reminders, now]);

  const selectDay = useCallback((key) => {
    setSelectedKey(key);
    setDraft((d) => (d.date === key ? d : { ...d, date: key }));
  }, []);

  const stepMonth = (n) => {
    const target = new Date(year, month + n, 1);
    const today = new Date(now);
    const isCurrentMonth = target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
    selectDay(isCurrentMonth ? dayKey(today) : dayKey(target));
  };

  const goToToday = () => selectDay(dayKey(new Date()));

  const showAgendaFor = (key) => {
    selectDay(key);
    const heading = agendaHeadingRef.current;
    if (!heading) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  };

  const openComposer = () => {
    if (!composerOpen) {
      const nowMs = Date.now();
      const nowDate = new Date(nowMs);
      const today = dayKey(nowDate);
      // Past days can't take a new reminder; start from today instead —
      // or tomorrow once today has no full hour left.
      let startKey = selectedKey < today ? today : selectedKey;
      if (startKey === today && nowDate.getHours() >= 23) startKey = dayKey(addDays(parseDayKey(today), 1));
      if (startKey !== selectedKey) setSelectedKey(startKey);
      setDraft({ text: "", date: startKey, time: defaultTime(startKey, nowMs), recurrence: "none" });
      setNow(nowMs);
      setComposerOpen(true);
    }
    setFocusRequest((n) => n + 1);
  };

  // The control that had focus (composer field, delete button) is about to
  // unmount; park focus on the day heading instead of losing it to <body>.
  const focusAgendaHeading = () => {
    requestAnimationFrame(() => agendaHeadingRef.current?.focus({ preventScroll: true }));
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setDraft((d) => ({ ...d, text: "", recurrence: "none" }));
    focusAgendaHeading();
  };

  const updateDraft = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.date && plausibleDayKey(patch.date)) setSelectedKey(patch.date);
  };

  const saveReminder = async () => {
    if (savingRef.current) return;
    const text = draft.text.trim();
    const due = parseLocalDateTime(draft.date, draft.time);
    if (!text || !due) return;
    const nowMs = Date.now();
    const recurring = draft.recurrence !== "none";
    if (!recurring && due.getTime() <= nowMs) {
      setNow(nowMs); // the composer then explains why nothing was saved
      return;
    }
    const first = recurring ? firstFutureOccurrence(due, draft.recurrence, nowMs) : due;
    savingRef.current = true;
    setSaving(true);
    try {
      const created = await createReminder({ text, due_at: first.toISOString(), recurrence: draft.recurrence });
      if (created && created.id != null) {
        setReminders((list) => [...list.filter((r) => r.id !== created.id), created]);
      } else {
        load();
      }
      setComposerOpen(false);
      setDraft((d) => ({ ...d, text: "", recurrence: "none" }));
      selectDay(dayKey(first));
      setNow(Date.now());
      focusAgendaHeading();
      const repeat = recurring ? ` · ${t(RECURRENCE[draft.recurrence][0], RECURRENCE[draft.recurrence][1])}` : "";
      toast.success(t("Hatırlatma kuruldu", "Reminder set"), {
        description: `${friendlyDay(first, lang)}, ${formatTime(first, lang)}${repeat}`,
      });
      notifyRemindersChanged();
    } catch {
      toast.error(t("Hatırlatma kaydedilemedi", "Couldn't save the reminder"), {
        description: t("Yazdıkların duruyor. Bağlantını kontrol edip tekrar dene.", "Your text is still here. Check your connection and try again."),
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deleteReminder = async (reminder) => {
    setReminders((list) => list.filter((r) => r.id !== reminder.id));
    try {
      await cancelReminder(reminder.id);
      toast.success(isRecurring(reminder) ? t("Tekrarlayan hatırlatma silindi", "Recurring reminder deleted") : t("Hatırlatma silindi", "Reminder deleted"));
    } catch (err) {
      // A 404 means it's already gone (e.g. deleted on another device).
      if (err?.response?.status !== 404) {
        setReminders((list) => (list.some((r) => r.id === reminder.id) ? list : [...list, reminder]));
        toast.error(t("Hatırlatma silinemedi", "Couldn't delete the reminder"), {
          description: t("Hatırlatma yerinde duruyor. Bağlantını kontrol edip tekrar dene.", "It's still in your list. Check your connection and try again."),
        });
        return;
      }
    }
    notifyRemindersChanged();
  };

  const askDelete = (reminder) => {
    deleteTriggerRef.current = document.activeElement;
    setPendingDelete(reminder);
  };

  const confirmDelete = () => {
    const reminder = pendingDelete;
    setPendingDelete(null);
    deleteTriggerRef.current = null;
    if (!reminder) return;
    deleteReminder(reminder);
    focusAgendaHeading();
  };

  // Back to the delete button that opened the dialog, not to <body>.
  const cancelDelete = () => {
    setPendingDelete(null);
    const trigger = deleteTriggerRef.current;
    deleteTriggerRef.current = null;
    if (trigger && trigger !== document.body && trigger.isConnected) {
      requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    }
  };

  const askPermission = () => {
    if (notificationPermission() !== "default") return;
    // Older Safari only takes a callback; newer browsers return a promise
    // (and may call the callback too), so settle once.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const value = notificationPermission();
      setPermission(value);
      if (value === "granted") {
        toast.success(t("Bildirimler açık", "Notifications are on"), {
          description: t("Luna açıkken, sekmesi arka planda olsa bile hatırlatmalar bildirim olarak gelir.", "While Luna is open, reminders also arrive as notifications when its tab is in the background."),
        });
      }
    };
    try {
      const request = Notification.requestPermission(done);
      if (request && typeof request.then === "function") request.then(done, done);
    } catch {
      done();
    }
  };

  const dismissBanner = () => {
    setBannerDismissed(true);
    try {
      localStorage.setItem(NOTIFY_DISMISSED_KEY, "1");
    } catch {}
  };

  const recurringDelete = !!pendingDelete && isRecurring(pendingDelete);
  const deleteText = pendingDelete ? shorten(pendingDelete.text || "") : "";
  const deleteCopy = recurringDelete
    ? {
      title: t("Tekrarlayan hatırlatma silinsin mi?", "Delete this recurring reminder?"),
      body: t(`“${deleteText}” serisinin tamamı silinir; sonraki tekrarlar da gelmez. Bu işlem geri alınamaz.`,
        `The whole “${deleteText}” series is removed, including every future repeat. This can't be undone.`),
      confirmLabel: t("Seriyi sil", "Delete series"),
    }
    : {
      title: t("Hatırlatma silinsin mi?", "Delete this reminder?"),
      body: t(`“${deleteText}” silinecek. Bu işlem geri alınamaz.`, `“${deleteText}” will be removed. This can't be undone.`),
      confirmLabel: t("Sil", "Delete"),
    };

  const loading = status === "loading";
  const isPastDay = selectedKey < todayKey;
  const nearToday = Math.abs(daysBetween(new Date(now), selectedDate)) <= 1;
  const agendaSubtitle = [
    nearToday ? formatDate(selectedDate, lang, { day: "numeric", month: "long", weekday: "long" }) : null,
    !loading && agenda.length ? countLabel(agenda.length, lang) : null,
  ].filter(Boolean).join(" · ");

  let agendaContent;
  if (loading) {
    agendaContent = <SkeletonList rows={2} label={t("Hatırlatmalar yükleniyor", "Loading reminders")} />;
  } else if (agenda.length > 0) {
    agendaContent = (
      <ul key={selectedKey} className="space-y-2 animate-in fade-in-0 duration-200 motion-reduce:animate-none" aria-labelledby={agendaTitleId}>
        {agenda.map((o) => (
          <AgendaItem key={o.key} t={t} lang={lang} occurrence={o} nowMs={now} onDelete={() => askDelete(o.reminder)} />
        ))}
      </ul>
    );
  } else if (!composerOpen) {
    agendaContent = (
      <div className="rounded-2xl border border-dashed border-white/[0.08]">
        <EmptyState glyph="alarms" accent="sky" compact
          title={t("Bu gün için hatırlatma yok", "No reminders for this day")}
          body={isPastDay
            ? t("Geçmiş bir gün. Yeni hatırlatmayı bugün ya da ileri bir tarih için kurabilirsin.", "This day has passed. You can set a new reminder for today or a later date.")
            : t("Bir saat seç ve birkaç kelimeyle ne hatırlatılacağını yaz.", "Pick a time and jot down what to remind you about.")}
          action={isPastDay ? (
            <button type="button" onClick={goToToday} className={secondaryButtonClass} data-testid="reminder-empty-today">
              {t("Bugüne git", "Go to today")}
            </button>
          ) : (
            <button type="button" onClick={openComposer} className={primaryButtonClass} data-testid="reminder-empty-add">
              <Plus size={15} aria-hidden="true" /> {t("Hatırlatma ekle", "Add a reminder")}
            </button>
          )}
        />
      </div>
    );
  } else {
    agendaContent = null;
  }

  return (
    <Panel onClose={onClose} size="2xl" accent="sky" labelledBy={titleId} testId="reminders-panel">
      <PanelHeader
        glyph="alarms"
        accent="sky"
        title={t("Alarmlar", "Reminders")}
        subtitle={t("Takvimden bir gün seç, saatli hatırlatma kur.", "Pick a day on the calendar and set a timed reminder.")}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t("Kapat", "Close")}
        actions={(
          <IconButton variant="primary" size={40} label={t("Yeni hatırlatma", "New reminder")} onClick={openComposer}
            disabled={status !== "ready"} testId="reminder-add-toggle">
            <Plus size={18} />
          </IconButton>
        )}
      />
      <PanelBody>
        {status === "error" ? (
          <ErrorState
            title={t("Hatırlatmaların yüklenemedi", "Couldn't load your reminders")}
            body={t("Bağlantında bir sorun olabilir. Birazdan tekrar dene.", "There may be a connection problem. Try again in a moment.")}
            onRetry={load}
            retryLabel={t("Tekrar dene", "Try again")}
          />
        ) : (
          <>
            {permission === "default" && !bannerDismissed && (
              <NotifyBanner t={t} onAllow={askPermission} onDismiss={dismissBanner} />
            )}

            <div className="grid gap-6 md:grid-cols-[316px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:gap-x-7">
              <div className="md:col-start-1 md:row-start-1">
                <MonthCalendar t={t} lang={lang} grid={grid} selectedKey={selectedKey} todayKey={todayKey} byDay={byDay}
                  onSelect={selectDay} onStepMonth={stepMonth} onToday={goToToday} />
              </div>

              <section aria-labelledby={agendaTitleId} data-testid="reminder-agenda" className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
                <div className="mb-3 flex min-h-[40px] items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={agendaTitleId} ref={agendaHeadingRef} tabIndex={-1}
                      className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white outline-none">
                      {friendlyDay(selectedDate, lang)}
                    </h3>
                    {agendaSubtitle && <p className="mt-1 text-[13px] text-white/45 tabular-nums">{agendaSubtitle}</p>}
                  </div>
                  {!composerOpen && !loading && agenda.length > 0 && !isPastDay && (
                    <button type="button" onClick={openComposer} className={`${ghostButtonClass} h-9 shrink-0 px-3`} data-testid="reminder-agenda-add">
                      <Plus size={14} aria-hidden="true" /> {t("Ekle", "Add")}
                    </button>
                  )}
                </div>

                {composerOpen && (
                  <ReminderComposer t={t} lang={lang} draft={draft} onChange={updateDraft} onSubmit={saveReminder}
                    onCancel={closeComposer} saving={saving} nowMs={now} todayKey={todayKey} inputRef={textRef} />
                )}
                {agendaContent}
              </section>

              <div className="md:col-start-1 md:row-start-2">
                <UpcomingList t={t} lang={lang} items={upcoming} nowMs={now} loading={loading} onPick={showAgendaFor} />
              </div>
            </div>

            {!loading && !(permission === "default" && !bannerDismissed) && (
              <DeliveryNote t={t} permission={permission} onAllow={askPermission} />
            )}
          </>
        )}
      </PanelBody>

      <ConfirmDialog
        open={!!pendingDelete}
        danger
        title={deleteCopy.title}
        body={deleteCopy.body}
        confirmLabel={deleteCopy.confirmLabel}
        cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </Panel>
  );
}
