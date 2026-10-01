import { useEffect, useRef, useState } from "react";
import { CalendarHeart, Flag, Globe, Info, Palette, RefreshCw, ScrollText, Sparkles } from "lucide-react";
import { fetchDayInfo } from "@/lib/api";
import { Panel, PanelHeader, PanelBody, SectionLabel, EmptyState, ErrorState, ACCENTS, secondaryButtonClass, usePanelTitleId } from "@/components/panel/Panel";
import { dayKey, locale } from "@/lib/dates";

const KINDS = {
  international: { icon: Globe, accent: "sky", tr: "Uluslararası gün", en: "International day" },
  national: { icon: Flag, accent: "rose", tr: "Türkiye", en: "Türkiye" },
  history: { icon: ScrollText, accent: "amber", tr: "Tarihte bugün", en: "On this day" },
  culture: { icon: Palette, accent: "fuchsia", tr: "Kültür", en: "Culture" },
  other: { icon: Sparkles, accent: "violet", tr: "Bugün", en: "Today" },
};

const str = (v) => (typeof v === "string" ? v.trim() : "");

// Older backends send only `text`; a quiet day may send an empty `items`.
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && typeof it === "object")
    .map((it) => ({
      title: str(it.title),
      text: str(it.text),
      kind: Object.prototype.hasOwnProperty.call(KINDS, it.kind) ? it.kind : "other",
    }))
    .filter((it) => it.title || it.text);
}

// A faint sunrise on the horizon with the last stars of the night above it.
const RAYS = [-165, -135, -105, -75, -45, -15].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const at = (r) => [+(112 + r * Math.cos(a)).toFixed(2), +(96 + r * Math.sin(a)).toFixed(2)];
  return [...at(27), ...at(34)];
});
const STARS = [[18, 16, 1.1, 0.55], [46, 34, 0.8, 0.35], [70, 12, 1, 0.45], [138, 18, 0.9, 0.4], [152, 46, 0.7, 0.3], [94, 30, 0.7, 0.3]];

function DawnArt() {
  return (
    <svg viewBox="0 0 160 96" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false"
      className="pointer-events-none absolute right-0 bottom-0 h-full w-auto max-w-[62%]">
      {STARS.map(([cx, cy, r, o]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#fff" opacity={o} />)}
      {RAYS.map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(252,211,77,0.35)" strokeWidth="1.4" strokeLinecap="round" />
      ))}
      <circle cx="112" cy="96" r="20" fill="rgba(252,211,77,0.16)" stroke="rgba(252,211,77,0.45)" strokeWidth="1" />
    </svg>
  );
}

function DateHero({ date, lang }) {
  const loc = locale(lang);
  return (
    <section data-testid="day-info-hero"
      className="relative overflow-hidden rounded-[22px] border border-white/[0.07] px-5 py-6"
      style={{
        background:
          "radial-gradient(60% 110% at 88% 118%, rgba(252,211,77,0.20), transparent 62%), " +
          "linear-gradient(180deg, rgba(129,140,248,0.07) 0%, rgba(251,191,36,0.06) 100%)",
      }}>
      <DawnArt />
      <time dateTime={dayKey(date)} className="relative flex items-end gap-3.5">
        {/* Proportional figures on purpose: the tabular "1" has a foot serif
            that looks like a typewriter glyph at this size. */}
        <span className="text-[52px] font-light leading-[0.8] tracking-[-0.045em] text-white">{date.getDate()}</span>
        <span className="flex min-w-0 flex-col pb-px">
          <span className="text-[17px] font-semibold leading-tight text-white">{date.toLocaleDateString(loc, { month: "long" })}</span>
          <span className="mt-1 text-[13px] leading-tight text-white/55">
            {date.toLocaleDateString(loc, { weekday: "long" })} · <span className="tabular-nums">{date.getFullYear()}</span>
          </span>
        </span>
      </time>
    </section>
  );
}

function ItemsSkeleton({ label }) {
  const bar = "rounded-full animate-pulse motion-reduce:animate-none";
  return (
    <div role="status" aria-label={label} className="divide-y divide-white/[0.06]">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3.5 py-4">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-white/[0.06] animate-pulse motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className={`h-2.5 w-20 bg-white/[0.07] ${bar}`} />
            <div className={`mt-2.5 h-3.5 bg-white/[0.09] ${bar}`} style={{ width: `${62 - i * 10}%` }} />
            <div className={`mt-2.5 h-3 w-[92%] bg-white/[0.05] ${bar}`} />
            <div className={`mt-2 h-3 bg-white/[0.05] ${bar}`} style={{ width: `${68 + i * 8}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Günün anlam ve önemi — what today is known for, in the viewer's local day
// (the server's UTC day lags behind Turkey between 00:00 and 03:00).
export default function DayInfoPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const [today] = useState(() => new Date());
  const todayKey = dayKey(today);
  const [state, setState] = useState({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null });
    fetchDayInfo(lang, todayKey)
      .then((d) => { if (!cancelled) setState({ status: "ready", data: d && typeof d === "object" ? d : {} }); })
      .catch(() => { if (!cancelled) setState({ status: "error", data: null }); });
    return () => { cancelled = true; };
  }, [lang, todayKey, attempt]);

  // The retry button unmounts while reloading; keep focus inside the dialog.
  const retry = () => {
    setAttempt((a) => a + 1);
    contentRef.current?.focus({ preventScroll: true });
  };

  const items = state.status === "ready" ? normalizeItems(state.data.items) : [];
  const paragraphs = state.status === "ready" && !items.length
    ? str(state.data.text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    : [];

  let body;
  if (state.status === "loading") {
    body = (
      <div className="mt-5">
        <ItemsSkeleton label={t("Yükleniyor", "Loading")} />
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="mt-2" data-testid="day-info-error">
        <ErrorState
          title={t("Bugünün bilgilerini getiremedim", "Couldn't load today's notes")}
          body={t("Bağlantıda bir sorun olabilir. Biraz sonra yeniden dene.", "There may be a connection problem. Try again in a moment.")}
          onRetry={retry}
          retryLabel={t("Tekrar dene", "Try again")}
        />
      </div>
    );
  } else if (items.length) {
    body = (
      <section className="mt-6">
        <SectionLabel>{t("Bugünün öne çıkanları", "Today's highlights")}</SectionLabel>
        <ul className="divide-y divide-white/[0.06]" data-testid="day-info-items">
          {items.map((it, i) => {
            const kind = KINDS[it.kind];
            const tone = ACCENTS[kind.accent];
            const Icon = kind.icon;
            return (
              <li key={`${i}-${it.title}`} className="flex gap-3.5 py-4 first:pt-1" data-testid="day-info-item">
                <span className="mt-0.5 w-9 h-9 shrink-0 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: tone.tile, boxShadow: `inset 0 0 0 1px ${tone.tile}` }}>
                  <Icon size={17} style={{ color: tone.fg }} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug" style={{ color: tone.fg }}>{t(kind.tr, kind.en)}</p>
                  {it.title && (
                    <h4 className="mt-0.5 text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{it.title}</h4>
                  )}
                  {it.text && <p className="mt-1 text-[13.5px] leading-relaxed text-white/65 [text-wrap:pretty] [overflow-wrap:anywhere]">{it.text}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  } else if (paragraphs.length) {
    body = (
      <div className="mt-6 space-y-3.5" data-testid="day-info-text">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[15px] leading-[1.75] text-white/75 [text-wrap:pretty] [overflow-wrap:anywhere]">{p}</p>
        ))}
      </div>
    );
  } else {
    // A quiet day still comes with a short note in `text`; nothing at all
    // usually means the model call failed, and the backend doesn't cache
    // that, so checking again can help.
    body = (
      <div className="mt-2" data-testid="day-info-empty">
        <EmptyState
          compact
          icon={Sparkles}
          accent="amber"
          title={t("Sakin bir gün", "A quiet day")}
          body={t("Bugün için özel bir not bulamadım — her gün yeni bir başlangıç.", "I couldn't find anything special for today — every day is a fresh start.")}
          action={
            <button type="button" onClick={retry} className={secondaryButtonClass} data-testid="day-info-empty-retry">
              <RefreshCw size={14} aria-hidden="true" /> {t("Tekrar kontrol et", "Check again")}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <Panel onClose={onClose} size="md" accent="amber" labelledBy={titleId} testId="day-info-modal">
      <PanelHeader
        icon={CalendarHeart}
        accent="amber"
        title={t("Günün anlam ve önemi", "Today's significance")}
        subtitle={t("Özel günler ve tarihte bugün", "Observances and this day in history")}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t("Kapat", "Close")}
      />
      <PanelBody>
        <DateHero date={today} lang={lang} />
        <div ref={contentRef} tabIndex={-1} className="outline-none">{body}</div>
        {(items.length > 0 || paragraphs.length > 0) && (
          <p className="mt-6 flex items-start gap-2 border-t border-white/[0.06] pt-4 text-[11.5px] leading-relaxed text-white/35">
            <Info size={13} className="mt-px shrink-0" aria-hidden="true" />
            {t("Bu bilgiler yapay zekâ ile derlenir; önemli konularda doğrulamanı öneririm.", "This is compiled with AI; please double-check anything important.")}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
