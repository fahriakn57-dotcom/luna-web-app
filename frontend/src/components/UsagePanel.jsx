import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines, CalendarDays, CalendarRange, Gauge, Info, InfinityIcon, MessageCircle, RefreshCw, Sparkles,
} from "lucide-react";
import { fetchUsage } from "@/lib/api";
import {
  Panel, PanelHeader, PanelBody, IconButton, SectionLabel, EmptyState, ErrorState, ACCENTS,
  primaryButtonClass, secondaryButtonClass, usePanelTitleId,
} from "@/components/panel/Panel";
import { locale, relativeTime } from "@/lib/dates";

// The backend reports "no daily cap" as a huge sentinel limit.
const NO_LIMIT = 1e9;
const DAY_MS = 86400000;

// /api/usage returns the internal config.PLANS keys; show the names the user
// actually bought. The moon in the plan card fills up with the plan.
const PLANS = {
  free: { tr: "Ücretsiz", en: "Free", tier: "free", accent: "teal", phase: 0.3 },
  plus: { tr: "Premium", en: "Premium", tier: "paid", accent: "violet", phase: 0.55 },
  pro: { tr: "Premium Plus", en: "Premium Plus", tier: "paid", accent: "fuchsia", phase: 0.8 },
  ultra: { tr: "Premium Ultra", en: "Premium Ultra", tier: "paid", accent: "amber", phase: 1 },
  unlimited: { tr: "Sınırsız", en: "Unlimited", tier: "unlimited", accent: "indigo", phase: 1 },
};

const DAILY = [
  { key: "chat", icon: MessageCircle, tr: "Mesajlar", en: "Messages", unitTr: "mesaj", oneEn: "message", manyEn: "messages" },
  { key: "voice", icon: AudioLines, tr: "Sesli yanıtlar", en: "Voice replies", unitTr: "sesli yanıt", oneEn: "voice reply", manyEn: "voice replies" },
];

const QUOTAS = [
  { key: "week", icon: CalendarDays, tr: "Son 7 gün", en: "Last 7 days" },
  { key: "month", icon: CalendarRange, tr: "Son 30 gün", en: "Last 30 days" },
];

const SEVERITY = {
  low: { bar: "bg-gradient-to-r from-teal-300 to-violet-400", text: "text-white/55" },
  mid: { bar: "bg-gradient-to-r from-amber-300 to-amber-400", text: "text-amber-200" },
  high: { bar: "bg-gradient-to-r from-rose-400 to-rose-500", text: "text-rose-300" },
};

const severityOf = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "mid" : "low");

// 100 only when the limit is really reached — 199/200 must not read as full.
function percentOf(used, limit) {
  if (!(limit > 0)) return 0;
  if (used >= limit) return 100;
  return Math.max(0, Math.min(99, Math.round((used / limit) * 100)));
}

function readCounter(raw) {
  if (!raw || typeof raw !== "object") return null;
  const used = Math.max(0, Number(raw.used) || 0);
  const limit = Number(raw.limit);
  return { used, limit: limit > 0 && limit < NO_LIMIT ? limit : null };
}

// Only ever a percentage — the TRY amounts behind it stay server-side.
function readQuota(raw) {
  if (!raw || typeof raw.spent !== "number" || !(raw.limit > 0)) return null;
  return percentOf(raw.spent, raw.limit);
}

// Something we can actually show: a known plan or at least one counter. An
// HTML fallback page or {} must not render as a "Sınırsız" plan.
function isUsable(data) {
  if (!data || typeof data !== "object") return false;
  return Object.prototype.hasOwnProperty.call(PLANS, data.plan) || DAILY.some((d) => readCounter(data[d.key]));
}

function resolvePlan(data) {
  if (Object.prototype.hasOwnProperty.call(PLANS, data.plan)) return PLANS[data.plan];
  if (DAILY.some((d) => readCounter(data[d.key])?.limit)) return PLANS.free;
  return data.cost_try ? PLANS.plus : PLANS.unlimited;
}

// Daily counters reset at UTC midnight. Prefer the server's own day; fall
// back to the client clock when that is stale or implausible.
function nextReset(day, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  const fromServer = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) : 0;
  if (fromServer > now && fromServer - now <= DAY_MS) return fromServer;
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function makeFormat(lang) {
  const tr = lang === "tr";
  const loc = locale(lang);
  const num = new Intl.NumberFormat(loc);
  const pct = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 0 });
  return {
    num: (n) => num.format(n),
    pct: (p) => pct.format(p / 100),
    clock: (ms) => new Date(ms).toLocaleTimeString(loc, { hour: tr ? "2-digit" : "numeric", minute: "2-digit" }),
    countdown: (ms) => {
      const mins = Math.ceil(ms / 60000);
      if (mins <= 1) return tr ? "birazdan" : "in a moment";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const span = (tr ? [h && `${h} sa`, m && `${m} dk`] : [h && `${h} hr`, m && `${m} min`]).filter(Boolean).join(" ");
      return tr ? `${span} sonra` : `in ${span}`;
    },
  };
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    // Background tabs throttle timers; catch up as soon as the tab is back.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
  return now;
}

// Moon phase as an SVG path: the right half of the disc plus an elliptical
// terminator that bulges right (crescent) or left (gibbous).
function moonPath(cx, cy, r, phase) {
  const rx = (Math.abs(1 - 2 * phase) * r).toFixed(2);
  return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx} ${r} 0 0 ${phase < 0.5 ? 0 : 1} ${cx} ${cy - r}Z`;
}

const STARS = [[6, 10, 1.1, 0.7], [57, 7, 0.9, 0.5], [59, 51, 0.8, 0.4], [5, 50, 0.7, 0.35]];

function PlanMoon({ phase, accent, halo }) {
  const tone = ACCENTS[accent] || ACCENTS.teal;
  // useId output contains characters that are awkward inside url(#…).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const cx = 32;
  const cy = 32;
  const r = 17;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="h-14 w-14 shrink-0">
      <defs>
        <radialGradient id={`usage-glow-${uid}`}>
          <stop offset="0%" stopColor={tone.fg} stopOpacity="0.3" />
          <stop offset="100%" stopColor={tone.fg} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`usage-lit-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={tone.fg} />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r + 13} fill={`url(#usage-glow-${uid})`} />
      {STARS.map(([x, y, sr, o]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={sr} fill="#fff" opacity={o} />)}
      {halo && (
        <circle cx={cx} cy={cy} r={r + 5.5} fill="none" stroke={tone.ring} strokeWidth="1"
          strokeDasharray="1.5 3.5" strokeLinecap="round" />
      )}
      <g transform={`rotate(-22 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />
        {phase >= 0.999 ? (
          <circle cx={cx} cy={cy} r={r} fill={`url(#usage-lit-${uid})`} style={{ filter: `drop-shadow(0 0 6px ${tone.ring})` }} />
        ) : (
          <path d={moonPath(cx, cy, r, phase)} fill={`url(#usage-lit-${uid})`} style={{ filter: `drop-shadow(0 0 6px ${tone.ring})` }} />
        )}
      </g>
    </svg>
  );
}

function PlanCard({ plan, description, onOpenPremium, t }) {
  const tone = ACCENTS[plan.accent] || ACCENTS.teal;
  const isFree = plan.tier === "free";
  return (
    <section data-testid="usage-plan-card"
      className="relative overflow-hidden rounded-[22px] border border-white/[0.08] p-4 sm:p-5"
      style={{
        background: `radial-gradient(60% 140% at 0% 0%, ${tone.glow}, transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <PlanMoon phase={plan.phase} accent={plan.accent} halo={plan.tier === "unlimited"} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white/50">{t("Mevcut planın", "Current plan")}</p>
            <p className="mt-0.5 text-lg font-semibold leading-tight tracking-[-0.015em] text-white" data-testid="usage-plan-name">
              {t(plan.tr, plan.en)}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-white/60 [text-wrap:pretty]">{description}</p>
          </div>
        </div>
        {onOpenPremium && plan.tier !== "unlimited" && (
          <button type="button" onClick={onOpenPremium} data-testid="usage-plans-button"
            className={`${isFree ? primaryButtonClass : secondaryButtonClass} w-full shrink-0 sm:w-auto`}>
            {isFree && <Sparkles size={15} aria-hidden="true" />}
            {t("Planları gör", "See plans")}
          </button>
        )}
      </div>
    </section>
  );
}

function RowIcon({ icon: Icon }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/[0.06]">
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

function Meter({ pct, label, valueText }) {
  // A sliver for tiny-but-nonzero usage so 1% doesn't look like nothing.
  const fill = pct > 0 ? Math.max(pct, 2) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText}
      className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
      {fill > 0 && (
        <div className={`h-full rounded-full ${SEVERITY[severityOf(pct)].bar} transition-[width] duration-700 ease-out animate-in slide-in-from-left-full motion-reduce:animate-none motion-reduce:transition-none`}
          style={{ width: `${fill}%` }} />
      )}
    </div>
  );
}

function DailyRow({ row, counter, resetAt, now, fmt, lang, t }) {
  const label = t(row.tr, row.en);
  const testId = `usage-row-${row.key}`;

  // No daily cap: a full bar would read as "limit exhausted", so show the
  // plain count instead.
  if (!counter.limit) {
    const n = <span className="font-semibold tabular-nums text-white/85">{fmt.num(counter.used)}</span>;
    let today;
    if (counter.used === 0) today = t(`Bugün henüz ${row.unitTr} yok`, `No ${row.manyEn} yet today`);
    else if (lang === "tr") today = <>Bugün {n} {row.unitTr}</>;
    else today = <>{n} {counter.used === 1 ? row.oneEn : row.manyEn} today</>;
    return (
      <li className="flex items-center gap-3 p-4" data-testid={testId}>
        <RowIcon icon={row.icon} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="mt-0.5 text-xs text-white/50">{today}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-teal-300/20 bg-teal-300/[0.08] px-2 py-1 text-[11px] font-medium leading-none text-teal-100/90">
          <InfinityIcon size={13} aria-hidden="true" />
          {t("Günlük sınır yok", "No daily limit")}
        </span>
      </li>
    );
  }

  const pct = percentOf(counter.used, counter.limit);
  const full = pct >= 100;
  return (
    <li className="p-4" data-testid={testId}>
      <div className="flex items-center gap-3">
        <RowIcon icon={row.icon} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{label}</p>
        <p className="shrink-0 text-sm tabular-nums text-white/40">
          <span className="font-semibold text-white">{fmt.num(counter.used)}</span> / {fmt.num(counter.limit)}
        </p>
        <span className={`w-10 shrink-0 text-right text-xs font-semibold tabular-nums ${SEVERITY[severityOf(pct)].text}`}>
          {fmt.pct(pct)}
        </span>
      </div>
      <div className="mt-3 pl-11">
        <Meter pct={pct} label={label} valueText={`${fmt.num(counter.used)} / ${fmt.num(counter.limit)}`} />
        <p className="mt-2 text-xs leading-relaxed text-white/45" data-testid={`${testId}-reset`}>
          {full && <span className="font-medium text-rose-200">{t("Bugünlük doldu.", "Used up for today.")} </span>}
          {/* inline-block: the reset phrase moves to its own line as a whole
              rather than splitting around the dot. */}
          <span className="inline-block tabular-nums">
            {t("Sıfırlanma", "Resets")} {fmt.clock(resetAt)} · {fmt.countdown(resetAt - now)}
          </span>
        </p>
      </div>
    </li>
  );
}

function QuotaRow({ row, pct, fmt, t }) {
  const label = t(row.tr, row.en);
  const level = severityOf(pct);
  return (
    <li className="p-4" data-testid={`usage-row-quota-${row.key}`}>
      <div className="flex items-center gap-3">
        <RowIcon icon={row.icon} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{label}</p>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${level === "low" ? "text-white" : SEVERITY[level].text}`}>
          {fmt.pct(pct)}
        </span>
      </div>
      <div className="mt-3 pl-11">
        <Meter pct={pct} label={label} valueText={`${fmt.pct(pct)} ${t("kullanıldı", "used")}`} />
        {level === "high" && (
          <p className="mt-2 text-xs leading-relaxed text-rose-200/90">
            {pct >= 100
              ? t("Kota doldu. Eski kullanımlar pencereden çıktıkça yeniden açılır.", "Quota reached. It frees up as older usage rolls out of the window.")
              : t("Kotanın sonuna yaklaştın.", "You're close to the limit.")}
          </p>
        )}
      </div>
    </li>
  );
}

function UsageSkeleton({ label }) {
  const pulse = "animate-pulse motion-reduce:animate-none";
  return (
    <div role="status" aria-label={label}>
      <div className="flex items-center gap-3.5 rounded-[22px] border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5">
        <div className={`m-[10px] h-9 w-9 shrink-0 rounded-full bg-white/[0.06] ${pulse}`} />
        <div className="min-w-0 flex-1">
          <div className={`h-2.5 w-20 rounded-full bg-white/[0.07] ${pulse}`} />
          <div className={`mt-2.5 h-4 w-28 rounded-full bg-white/[0.1] ${pulse}`} />
          <div className={`mt-2.5 h-3 w-52 max-w-full rounded-full bg-white/[0.06] ${pulse}`} />
        </div>
      </div>
      <div className={`mt-6 h-2.5 w-14 rounded-full bg-white/[0.07] ${pulse}`} />
      <div className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-white/[0.025]">
        {[0, 1].map((i) => (
          <div key={i} className="p-4">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 shrink-0 rounded-[10px] bg-white/[0.06] ${pulse}`} />
              <div className={`h-3 rounded-full bg-white/[0.08] ${pulse}`} style={{ width: `${32 - i * 6}%` }} />
              <div className={`ml-auto h-3 w-16 rounded-full bg-white/[0.07] ${pulse}`} />
            </div>
            <div className={`ml-11 mt-3 h-1.5 rounded-full bg-white/[0.07] ${pulse}`} />
            <div className={`ml-11 mt-2.5 h-2.5 w-40 max-w-[60%] rounded-full bg-white/[0.05] ${pulse}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Plan, today's counters and (for paid plans) the rolling fair-use quota.
// Reachable from the sidebar, so it works on mobile too.
export default function UsagePanel({ lang, onClose, onOpenPremium }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const fmt = useMemo(() => makeFormat(lang), [lang]);
  const now = useNow(30000);
  const [state, setState] = useState({ status: "loading", data: null, updatedAt: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);
  const rollover = useRef({ day: null, tries: 0, at: 0 });
  const anchorRef = useRef(null);

  // A failed first load shows ErrorState; a failed refresh keeps the data on
  // screen and resolves to false so the caller can decide whether to toast.
  const load = useCallback((mode = "initial") => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setRefreshing(mode === "refresh");
    if (mode !== "refresh") setState({ status: "loading", data: null, updatedAt: 0 });
    return fetchUsage().then((data) => {
      if (!isUsable(data)) throw new Error("Unexpected /usage response");
      return data;
    }).then(
      (data) => {
        if (request !== latestRequest.current) return true;
        setState({ status: "ready", data, updatedAt: Date.now() });
        setRefreshing(false);
        return true;
      },
      (err) => {
        // Log the real reason (network blip, 401 before device registration
        // lands, a stale token) — a silent failure here was impossible to
        // diagnose before.
        console.error("fetchUsage failed:", err);
        if (request !== latestRequest.current) return true;
        setRefreshing(false);
        if (mode === "refresh") return false;
        setState({ status: "error", data: null, updatedAt: 0 });
        return true;
      },
    );
  }, []);

  useEffect(() => {
    load();
    // Ignore whatever is still in flight once the panel closes.
    return () => { latestRequest.current = -1; };
  }, [load]);

  const refresh = () => {
    if (refreshing) return;
    load("refresh").then((ok) => {
      if (!ok) {
        toast.error(t("Kullanım bilgisi yenilenemedi", "Couldn't refresh your usage"), {
          description: t("Bağlantını kontrol edip tekrar dene.", "Check your connection and try again."),
        });
      }
    });
  };

  const data = state.status === "ready" ? state.data : null;
  const loadedDay = typeof data?.day === "string" ? data.day : null;
  const utcToday = new Date(now).toISOString().slice(0, 10);
  const resetAt = nextReset(loadedDay, now);

  // The counters reset at UTC midnight while the panel may be open — fetch
  // the fresh day instead of showing yesterday's numbers. At most once a
  // minute and a few times per day, so a failed fetch (or a server clock a
  // little behind ours) gets another chance without polling forever.
  useEffect(() => {
    if (!loadedDay || loadedDay >= utcToday) return;
    if (rollover.current.day !== utcToday) rollover.current = { day: utcToday, tries: 0, at: 0 };
    const r = rollover.current;
    if (r.tries >= 5 || now - r.at < 60000) return;
    r.tries += 1;
    r.at = now;
    load("refresh");
  }, [loadedDay, utcToday, now, load]);

  const retry = () => {
    // The retry button unmounts with the error state; keep focus inside the
    // dialog instead of letting it fall back to <body>.
    anchorRef.current?.closest('[role="dialog"]')?.focus({ preventScroll: true });
    load();
  };

  let body;
  if (state.status === "loading") {
    body = <UsageSkeleton label={t("Kullanım yükleniyor", "Loading usage")} />;
  } else if (state.status === "error") {
    // ErrorState can't carry a test id on its retry button, so the retry
    // lives here (e2e tests look for usage-retry-button).
    body = (
      <div className="flex flex-col items-center pb-10" data-testid="usage-error">
        {/* -mb-5 pulls the button up to where ErrorState's own retry sits. */}
        <div className="-mb-5 w-full">
          <ErrorState
            title={t("Kullanım bilgisi alınamadı", "Couldn't load your usage")}
            body={t("Bağlantıda geçici bir sorun olabilir. Biraz sonra tekrar dene.", "There may be a temporary connection problem. Try again in a moment.")}
          />
        </div>
        <button type="button" onClick={retry} data-testid="usage-retry-button" className={secondaryButtonClass}>
          <RefreshCw size={14} aria-hidden="true" /> {t("Tekrar dene", "Try again")}
        </button>
      </div>
    );
  } else {
    const plan = resolvePlan(data);
    const counters = DAILY.map((row) => ({ row, counter: readCounter(data[row.key]) })).filter((c) => c.counter);
    const costTry = data.cost_try && typeof data.cost_try === "object" ? data.cost_try : null;
    const quotas = costTry
      ? QUOTAS.map((row) => ({ row, pct: readQuota(costTry[row.key]) })).filter((q) => q.pct !== null)
      : [];

    let description;
    if (plan.tier === "free") {
      const chatLimit = readCounter(data.chat)?.limit ?? 5;
      const voiceLimit = readCounter(data.voice)?.limit ?? 5;
      description = t(
        `Günde ${fmt.num(chatLimit)} mesaj ve ${fmt.num(voiceLimit)} sesli yanıt`,
        `${fmt.num(chatLimit)} messages and ${fmt.num(voiceLimit)} voice replies a day`,
      );
    } else if (plan.tier === "paid") {
      description = t("Günlük sınır yok; adil kullanım kotası geçerli", "No daily limits; a fair-use quota applies");
    } else {
      description = t("Hiçbir sınır uygulanmaz", "No limits apply");
    }

    body = (
      <>
        <PlanCard plan={plan} description={description} onOpenPremium={onOpenPremium} t={t} />

        {counters.length > 0 && (
          <section className="mt-6">
            <SectionLabel>{t("Bugün", "Today")}</SectionLabel>
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-white/[0.025]">
              {counters.map(({ row, counter }) => (
                <DailyRow key={row.key} row={row} counter={counter} resetAt={resetAt} now={now} fmt={fmt} lang={lang} t={t} />
              ))}
            </ul>
          </section>
        )}

        {quotas.length > 0 && (
          <section className="mt-6" data-testid="usage-quota">
            <SectionLabel>{t("Adil kullanım kotası", "Fair-use quota")}</SectionLabel>
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-white/[0.025]">
              {quotas.map(({ row, pct }) => <QuotaRow key={row.key} row={row} pct={pct} fmt={fmt} t={t} />)}
            </ul>
            <p className="mt-2.5 flex items-start gap-2 px-1 text-xs leading-relaxed text-white/40">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t(
                "Kota kayan bir pencereyle hesaplanır: eski kullanımlar süresi doldukça düşer, sabit bir sıfırlanma saati yoktur.",
                "The quota uses a rolling window: older usage drops off as it ages, so there's no fixed reset time.",
              )}
            </p>
          </section>
        )}

        {counters.length === 0 && quotas.length === 0 && (
          <EmptyState compact icon={Gauge} accent="teal"
            title={t("Sayaçlar henüz hazır değil", "Usage isn't available yet")}
            body={t("Birazdan yenilemeyi dene.", "Try refreshing in a moment.")} />
        )}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs text-white/40" data-testid="usage-updated">
            {t("Son güncelleme", "Last updated")}: {relativeTime(state.updatedAt, lang)}
          </p>
          <IconButton label={refreshing ? t("Yenileniyor", "Refreshing") : t("Yenile", "Refresh")} onClick={refresh}
            size={40} testId="usage-refresh-button">
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
          </IconButton>
        </div>
      </>
    );
  }

  return (
    <Panel onClose={onClose} size="md" accent="teal" labelledBy={titleId} testId="usage-modal">
      <PanelHeader
        icon={Gauge}
        accent="teal"
        title={t("Kullanım", "Usage")}
        subtitle={t("Planın ve bugünkü kullanımın", "Your plan and today's usage")}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t("Kapat", "Close")}
        closeTestId="usage-close-button"
      />
      <PanelBody>
        <div ref={anchorRef}>{body}</div>
      </PanelBody>
    </Panel>
  );
}
