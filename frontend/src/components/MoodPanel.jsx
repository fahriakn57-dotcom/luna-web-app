import { useId, useLayoutEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Panel, PanelHeader, PanelBody, SectionLabel, ghostButtonClass, usePanelTitleId } from "@/components/panel/Panel";
import { addDays, dayKey, formatDate, locale } from "@/lib/dates";

// Faces are inline SVG rather than emoji so they look the same everywhere —
// Windows drew the old emoji flat and grey. Colours are the 300-level tones
// of the panel ACCENTS, so the picked mood can also tint the panel itself.
const MOODS = [
  {
    key: "great", tr: "Harika", en: "Great", accent: "amber", color: "#fcd34d", rgb: "252,211,77",
    note: ["Luna enerjine eşlik eder; daha sıcak ve canlı konuşur.", "Luna matches your energy and keeps things warm and lively."],
  },
  {
    key: "good", tr: "İyi", en: "Good", accent: "emerald", color: "#6ee7b7", rgb: "110,231,183",
    note: ["Ne güzel! Luna her zamanki doğal tarzıyla devam eder.", "Nice! Luna keeps her usual, natural style."],
  },
  {
    key: "neutral", tr: "Nötr", en: "Neutral", accent: "sky", color: "#7dd3fc", rgb: "125,211,252",
    note: ["Luna her zamanki dengeli tonuyla konuşur.", "Luna keeps her usual, balanced tone."],
  },
  {
    key: "tired", tr: "Yorgun", en: "Tired", accent: "indigo", color: "#a5b4fc", rgb: "165,180,252",
    note: ["Luna bugün daha sakin ve kısa konuşur, seni yormaz.", "Luna keeps things calm and brief today, without wearing you out."],
  },
  {
    key: "bad", tr: "Kötü", en: "Bad", accent: "rose", color: "#fda4af", rgb: "253,164,175",
    note: ["Luna bugün daha nazik ve anlayışlı olur, önce seni dinler.", "Luna will be gentler and more understanding today, and listen first."],
  },
];

// find() instead of a keyed object: the value comes from localStorage, and a
// lookup like MOODS_BY_KEY["constructor"] would be truthy.
const findMood = (key) => MOODS.find((m) => m.key === key) || null;

// Device-local history for the "Son 7 gün" strip: { "YYYY-MM-DD": moodKey }.
const LOG_KEY = "luna_mood_log";
const LOG_DAYS = 30;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Keeps the last 30 days and returns what was kept — even when storage is
// unavailable, so the strip still reflects this session.
function saveLog(log) {
  const oldest = dayKey(addDays(new Date(), -(LOG_DAYS - 1)));
  const kept = {};
  for (const [day, key] of Object.entries(log)) {
    if (DAY_KEY_RE.test(day) && day >= oldest && findMood(key)) kept[day] = key;
  }
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(kept));
  } catch {}
  return kept;
}

// Luna.jsx reads the pick once per page load and only sends it while
// luna_mood_day is today, so a tab left open past midnight still holds
// yesterday's mood in state.
function pickedToday() {
  try {
    return localStorage.getItem("luna_mood_day") === dayKey();
  } catch {
    return true;
  }
}

function FaceFeatures({ kind, color, soft }) {
  const dotEyes = (cy) => (
    <>
      <circle cx="18" cy={cy} r="2.4" fill={color} stroke="none" />
      <circle cx="30" cy={cy} r="2.4" fill={color} stroke="none" />
    </>
  );
  switch (kind) {
    case "great":
      return (
        <>
          <path d="M15.5 21 Q18.5 17 21.5 21" />
          <path d="M26.5 21 Q29.5 17 32.5 21" />
          <path d="M17 27 H31 Q30.5 35 24 35 Q17.5 35 17 27 Z" fill={soft} />
          <circle cx="12.8" cy="26" r="2.2" fill={soft} stroke="none" />
          <circle cx="35.2" cy="26" r="2.2" fill={soft} stroke="none" />
        </>
      );
    case "good":
      return (
        <>
          {dotEyes(20.5)}
          <path d="M16.5 28 Q24 35 31.5 28" />
        </>
      );
    case "neutral":
      return (
        <>
          {dotEyes(20.5)}
          <path d="M17.5 30 H30.5" />
        </>
      );
    case "tired":
      return (
        <>
          <path d="M15 21.5 Q18.25 24.5 21.5 21.5" />
          <path d="M26.5 21.5 Q29.75 24.5 33 21.5" />
          <ellipse cx="24" cy="31" rx="2.6" ry="2.1" fill={soft} />
          <path d="M37.5 2.5 H43 L37.5 8 H43" strokeWidth="2" />
        </>
      );
    default:
      return (
        <>
          <path d="M14.5 16.2 L20 14.4" strokeWidth="2" opacity="0.75" />
          <path d="M28 14.4 L33.5 16.2" strokeWidth="2" opacity="0.75" />
          {dotEyes(21.5)}
          <path d="M17.5 32.5 Q24 27 30.5 32.5" />
        </>
      );
  }
}

function MoodFace({ mood, active = true, className = "" }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false"
      fill="none" stroke={mood.color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="18.5" fill={`rgba(${mood.rgb},${active ? 0.2 : 0.08})`} />
      <FaceFeatures kind={mood.key} color={mood.color} soft={`rgba(${mood.rgb},0.38)`} />
    </svg>
  );
}

// Ruh Halim — today's mood. Luna.jsx keeps the pick for today only and sends
// it with every chat message, so Luna adapts her tone for the day.
export default function MoodPanel({ lang, mood, setMood, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const questionId = useId();
  const historyId = useId();
  const itemRefs = useRef([]);
  const [log, setLog] = useState(readLog);
  const [opened] = useState(() => ({ mood, stale: !!mood && !pickedToday() }));

  // On open: drop a pick from an earlier day (it is no longer sent, so it
  // must not read as today's), and put a pick made before this history
  // existed on today's column. Layout effect so the stale pick never paints.
  useLayoutEffect(() => {
    if (!opened.mood) return;
    if (opened.stale) {
      setMood(null);
      return;
    }
    const stored = readLog();
    const today = dayKey();
    if (stored[today] !== opened.mood) setLog(saveLog({ ...stored, [today]: opened.mood }));
  }, [opened, setMood]);

  const current = findMood(mood);
  const accent = current ? current.accent : "violet";
  const now = new Date();
  const todayKey = dayKey(now);
  const loc = locale(lang);

  // Re-reads storage first so another tab's entries aren't overwritten.
  const recordToday = (key) => {
    const next = readLog();
    if (key) next[todayKey] = key;
    else delete next[todayKey];
    setLog(saveLog(next));
  };

  const choose = (key) => {
    if (key === current?.key) return;
    setMood(key);
    recordToday(key);
  };

  const clear = () => {
    setMood(null);
    recordToday(null);
    // The clear button disappears with the selection; keep focus in the picker.
    itemRefs.current[0]?.focus();
  };

  // Radio-group keyboard pattern: arrows move focus and pick, wrapping around.
  const onGroupKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // e.g. Alt+← is browser back
    const idx = itemRefs.current.indexOf(document.activeElement);
    if (idx < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next;
    if (step) next = (idx + step + MOODS.length) % MOODS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MOODS.length - 1;
    else return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
    choose(MOODS[next].key);
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));

  return (
    <Panel onClose={onClose} size="md" accent={accent} labelledBy={titleId} testId="mood-modal">
      <PanelHeader
        glyph="mood"
        accent={accent}
        title={t("Ruh halim", "My mood")}
        subtitle={t("Seçtiğin ruh hali bugünkü sohbetlerde Luna'ya iletilir.", "The mood you pick is shared with Luna in today's chats.")}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t("Kapat", "Close")}
      />
      <PanelBody>
        <div className="pt-1">
          <p className="text-[13px] text-white/45">{formatDate(now, lang, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h3 id={questionId} className="mt-1 text-[21px] sm:text-[22px] font-semibold leading-tight tracking-[-0.015em] text-white">
            {t("Bugün nasıl hissediyorsun?", "How are you feeling today?")}
          </h3>
        </div>

        <div role="radiogroup" aria-labelledby={questionId} onKeyDown={onGroupKeyDown}
          className="mt-5 grid grid-cols-5 gap-2 sm:gap-2.5" data-testid="mood-picker">
          {MOODS.map((m, i) => {
            const active = current?.key === m.key;
            const focusable = current ? active : i === 0;
            return (
              <button key={m.key} ref={(el) => { itemRefs.current[i] = el; }} type="button" role="radio"
                aria-checked={active} tabIndex={focusable ? 0 : -1} data-testid={`mood-${m.key}`}
                onClick={() => choose(m.key)}
                className={`group flex flex-col items-center gap-2 rounded-2xl border px-1 pt-3 pb-2.5
                  transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--mood-ring)] ${
                  active
                    ? "motion-safe:-translate-y-1"
                    : "border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05] motion-safe:hover:-translate-y-0.5"
                }`}
                style={{
                  "--mood-ring": `rgba(${m.rgb},0.85)`,
                  ...(active ? {
                    borderColor: `rgba(${m.rgb},0.45)`,
                    backgroundColor: `rgba(${m.rgb},0.1)`,
                    boxShadow: `0 14px 30px -16px rgba(${m.rgb},0.85), inset 0 1px 0 rgba(255,255,255,0.06)`,
                  } : null),
                }}>
                <span className="rounded-full transition-shadow duration-200 motion-reduce:transition-none"
                  style={active ? { boxShadow: `0 0 0 4px rgba(${m.rgb},0.14), 0 0 22px rgba(${m.rgb},0.45)` } : undefined}>
                  <MoodFace mood={m} active={active}
                    className={`block w-10 h-10 sm:w-12 sm:h-12 transition-opacity duration-200 motion-reduce:transition-none ${
                      active ? "opacity-100" : "opacity-[0.82] group-hover:opacity-100"
                    }`} />
                </span>
                <span className={`text-[12.5px] leading-none ${active ? "font-semibold text-white" : "font-medium text-white/55 group-hover:text-white/80"}`}>
                  {t(m.tr, m.en)}
                </span>
              </button>
            );
          })}
        </div>

        <div aria-live="polite" className="mt-4" data-testid="mood-status">
          {current ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-h-[84px] rounded-2xl border px-4 py-3.5"
              style={{ borderColor: `rgba(${current.rgb},0.18)`, backgroundColor: `rgba(${current.rgb},0.05)` }}>
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[12.5px] text-white/50">
                  {t("Bugünkü ruh halin", "Today's mood")}:{" "}
                  <span className="font-semibold" style={{ color: current.color }}>{t(current.tr, current.en)}</span>
                </p>
                <p className="mt-1 text-sm leading-relaxed text-white/85 [text-wrap:pretty]">{t(...current.note)}</p>
              </div>
              <button type="button" onClick={clear} data-testid="mood-clear" className={`${ghostButtonClass} min-h-[40px] ml-auto -mr-1.5`}>
                <RotateCcw size={13} aria-hidden="true" /> {t("Seçimi kaldır", "Clear selection")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center min-h-[84px] rounded-2xl border border-dashed border-white/[0.09] px-4 py-3.5">
              <p className="text-center text-[13px] leading-relaxed text-white/45">
                {t("Seçimin sadece bugün için geçerli; yarın yeniden sorarım.", "Your pick only counts for today; I'll ask again tomorrow.")}
              </p>
            </div>
          )}
        </div>

        <section className="mt-7" aria-labelledby={historyId}>
          <SectionLabel><span id={historyId}>{t("Son 7 gün", "Last 7 days")}</span></SectionLabel>
          <ol className="grid grid-cols-7 gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1.5" data-testid="mood-history">
            {days.map((d) => {
              const key = dayKey(d);
              const isToday = key === todayKey;
              const m = isToday ? current : findMood(log[key]);
              const label = `${d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" })}: ${
                m ? t(m.tr, m.en) : t("kayıt yok", "no entry")
              }`;
              return (
                <li key={key} title={label} data-testid={isToday ? "mood-history-today" : undefined}
                  className={`flex flex-col items-center gap-2 rounded-xl py-2.5 ${isToday ? "bg-white/[0.05]" : ""}`}>
                  <span aria-hidden="true" className={`text-[11px] leading-none ${isToday ? "font-semibold text-white/85" : "font-medium text-white/40"}`}>
                    {isToday ? t("Bugün", "Today") : d.toLocaleDateString(loc, { weekday: "short" })}
                  </span>
                  {m ? (
                    <MoodFace mood={m} className="block w-6 h-6" />
                  ) : (
                    <span aria-hidden="true" className="flex w-6 h-6 items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
                    </span>
                  )}
                  <span className="sr-only">{label}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/35">
            {t("Bu geçmiş yalnızca bu cihazda tutulur.", "This history is only kept on this device.")}
          </p>
        </section>
      </PanelBody>
    </Panel>
  );
}
