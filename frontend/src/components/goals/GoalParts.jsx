// Goals & plans: the presentational pieces of GoalsPanel.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle, AlignLeft, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheck, Clock,
  ListChecks, Loader2, Pencil, Plus, Target, Trash2, TrendingUp, X,
} from "lucide-react";
import {
  IconButton, Chip, Segmented, EmptyState, fieldClass, primaryButtonClass, secondaryButtonClass,
  ghostButtonClass,
} from "@/components/panel/Panel";
import { GlowIcon } from "@/components/icons/GlyphTile";
import { friendlyDay, relativeTime } from "@/lib/dates";
import {
  MAX_STEPS, STEP_MAX, TITLE_MAX, DESCRIPTION_MAX, EXAMPLES, newStepId, stripBullet, formatPercent, daysUntil,
  deadlineInfo, quickDates, categoryInfo,
} from "@/components/goals/goalModel";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
export const CHECK_PATH = "M5 12.5l4.5 4.5L19 7.5";

export const labelClass = "mb-1.5 block text-xs font-medium text-white/60";
export const optionalClass = "font-normal text-white/30";
export const kbdClass =
  "rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-white/50 [font-family:inherit]";
export const linkButtonClass =
  "-ml-1 mt-0.5 rounded-md px-1 py-1 text-xs font-semibold text-emerald-300/90 transition-colors hover:text-emerald-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60";
export const rowActionClass =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white/55 " +
  "transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60";
export const groupListClass = "divide-y divide-white/[0.05] rounded-2xl border border-white/[0.07] bg-white/[0.025]";
export const chipBase = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium tabular-nums";
export const CHIP_TONES = {
  neutral: "bg-white/[0.05] text-white/60",
  soon: "bg-amber-400/[0.12] text-amber-200",
  late: "bg-rose-400/[0.14] text-rose-200",
  done: "bg-white/[0.04] text-white/40",
};
// Meta-chip glyphs glow in the chip's status hue (calm moonlight violet when
// nothing is pressing); a finished item's chip stays quiet.
const CHIP_GLOW = { neutral: "violet", soon: "amber", late: "rose" };

function ChipGlyph({ icon: Icon, hue }) {
  return hue ? <GlowIcon icon={Icon} hue={hue} size={12} /> : <Icon size={12} aria-hidden="true" />;
}

// Chip draws its own `icon` in plain currentColor; hand it the category glyph
// already lit in the category's hue. Cached per glyph and hue, so a re-render
// never swaps the component (which would remount the icon).
const litGlyphs = new WeakMap();
function litGlyph(icon, hue) {
  let byHue = litGlyphs.get(icon);
  if (!byHue) litGlyphs.set(icon, (byHue = new Map()));
  if (!byHue.has(hue)) {
    byHue.set(hue, function LitGlyph({ size }) {
      return <GlowIcon icon={icon} hue={hue} size={size} />;
    });
  }
  return byHue.get(hue);
}

// Custom range: the filled part of the track is painted from --track.
export const rangeClass = [
  "block h-8 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:var(--track)]",
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:[background:var(--track)]",
  "[&::-webkit-slider-thumb]:-mt-[6px] [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none",
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_5px_rgba(0,0,0,0.55)]",
  "[&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0",
  "[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_5px_rgba(0,0,0,0.55)]",
  "[&:focus-visible::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(110,231,183,0.35)] [&:focus-visible::-moz-range-thumb]:shadow-[0_0_0_4px_rgba(110,231,183,0.35)]",
].join(" ");

// Round "done" check with a drawn tick and a one-off ring burst on completion.
export function CheckToggle({ checked, onToggle, label, testId, size = 22 }) {
  const [burst, setBurst] = useState(0);
  const wasChecked = useRef(checked);

  useEffect(() => {
    if (checked && !wasChecked.current) setBurst((n) => n + 1);
    wasChecked.current = checked;
  }, [checked]);

  const icon = Math.round(size * 0.68);
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} title={label} onClick={onToggle}
      data-testid={testId}
      className="group/check relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60">
      <span aria-hidden="true" style={{ width: size, height: size }}
        className={`relative flex items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-200 ease-out motion-reduce:transition-none group-active/check:scale-90 ${
          checked ? "border-emerald-400 bg-emerald-400" : "border-white/30 [@media(hover:hover)]:group-hover/check:border-emerald-300/70"
        }`}>
        <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          {!checked && (
            <path d={CHECK_PATH} stroke="rgba(110,231,183,0.6)"
              className="opacity-0 transition-opacity [@media(hover:hover)]:group-hover/check:opacity-100" />
          )}
          <path d={CHECK_PATH} pathLength={1} stroke="#052e1f"
            style={{ strokeDasharray: 1, strokeDashoffset: checked ? 0 : 1 }}
            className="transition-[stroke-dashoffset] delay-75 duration-300 ease-out motion-reduce:transition-none" />
        </svg>
        {burst > 0 && (
          <span key={burst}
            className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-emerald-300/80 animate-out fade-out-0 zoom-out-150 fill-mode-forwards duration-500 ease-out motion-reduce:hidden" />
        )}
      </span>
    </button>
  );
}

export function CategoryTag({ category, lang }) {
  const info = categoryInfo(category, lang);
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium"
      style={{ backgroundColor: info.tile, color: info.color }}>
      <GlowIcon icon={info.icon} hue={info.hue} size={12} />
      {info.label}
    </span>
  );
}

export function GoalDueChip({ t, lang, deadline, done }) {
  const info = deadlineInfo(deadline, lang);
  if (!info) return null;
  const { days, short, full } = info;
  let tone = "neutral";
  let text;
  if (done) {
    tone = "done";
    text = short;
  } else if (days < 0) {
    tone = "late";
    text = t(`${-days} gün gecikti`, `${-days} ${days === -1 ? "day" : "days"} overdue`);
  } else if (days === 0) {
    tone = "soon";
    text = t("Bugün son gün", "Due today");
  } else if (days === 1) {
    tone = "soon";
    text = t("Yarın son gün", "Due tomorrow");
  } else {
    tone = days <= 7 ? "soon" : "neutral";
    text = t(`${days} gün kaldı`, `${days} days left`);
  }
  const withDate = !done && (days > 1 || days < 0);
  return (
    <span className={`${chipBase} ${CHIP_TONES[tone]}`} title={full}>
      <ChipGlyph icon={Clock} hue={CHIP_GLOW[tone]} />
      {withDate && (
        <>
          <span>{short}</span>
          <span aria-hidden="true" className="opacity-50">·</span>
        </>
      )}
      <span>{text}</span>
    </span>
  );
}

export function PlanDateChip({ lang, deadline, done }) {
  const info = deadlineInfo(deadline, lang);
  if (!info) return null;
  const tone = done ? "done" : info.days < 0 ? "late" : info.days === 0 ? "soon" : "neutral";
  return (
    <span className={`${chipBase} ${CHIP_TONES[tone]}`} title={info.full}>
      <ChipGlyph icon={CalendarDays} hue={CHIP_GLOW[tone]} />
      {friendlyDay(info.date, lang)}
    </span>
  );
}

export function ProgressSlider({ value, color, label, lang, onChange }) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <input type="range" min={0} max={100} step={5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label} aria-valuetext={formatPercent(value, lang)} data-testid="goal-progress-slider"
        className={rangeClass}
        style={{ "--track": `linear-gradient(90deg, ${color}99 0%, ${color} ${value}%, rgba(255,255,255,0.09) ${value}%)` }} />
      <span aria-hidden="true" className="w-11 shrink-0 text-right text-[13px] font-semibold tabular-nums text-white/80">
        {formatPercent(value, lang)}
      </span>
    </div>
  );
}

export function ProgressBar({ value, color, label, lang }) {
  return (
    <div className="mt-2 flex min-h-[32px] items-center gap-3">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
        aria-valuetext={formatPercent(value, lang)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.09]">
        <div className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
      </div>
      <span aria-hidden="true" className="w-11 shrink-0 text-right text-[13px] font-semibold tabular-nums text-white/80">
        {formatPercent(value, lang)}
      </span>
    </div>
  );
}

export function StepItem({ t, step, onToggle }) {
  return (
    <li data-testid="goal-step-item">
      <button type="button" role="checkbox" aria-checked={!!step.done} onClick={onToggle} data-testid="goal-step-toggle"
        title={step.done ? t("Yapılmadı olarak işaretle", "Mark as not done") : t("Yapıldı olarak işaretle", "Mark as done")}
        className="group/step -mx-2 flex min-h-[40px] w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50">
        <span aria-hidden="true"
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-colors duration-200 motion-reduce:transition-none ${
            step.done ? "border-emerald-400 bg-emerald-400" : "border-white/25 [@media(hover:hover)]:group-hover/step:border-emerald-300/60"
          }`}>
          <Check size={12} strokeWidth={3.25}
            className={`text-[#052e1f] transition-transform duration-200 ease-out motion-reduce:transition-none ${step.done ? "scale-100" : "scale-0"}`} />
        </span>
        <span className={`min-w-0 flex-1 break-words text-[13.5px] leading-snug transition-colors ${
          step.done ? "text-white/40 line-through decoration-white/25" : "text-white/80"
        }`}>
          {step.text}
        </span>
      </button>
    </li>
  );
}

// Goal cards fold their steps behind a "3/5 adım" header (showing the next
// open step); plan rows list them straight away.
export function StepChecklist({ t, steps, onToggleStep, collapsible }) {
  const [open, setOpen] = useState(!collapsible);
  const listId = useId();
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const list = (
    <ul id={listId} hidden={!open} className="mt-0.5">
      {steps.map((step) => (
        <StepItem key={step.id} t={t} step={step} onToggle={() => onToggleStep(step.id)} />
      ))}
    </ul>
  );
  if (!collapsible) return list;
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={listId}
        data-testid="goal-steps-toggle"
        className="-mx-2 flex min-h-[40px] w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 text-left text-[13px] transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
        <ChevronRight size={15} aria-hidden="true"
          className={`shrink-0 text-white/40 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0 font-medium tabular-nums text-white/75">
          {t(`${doneCount}/${steps.length} adım`, `${doneCount} of ${steps.length} steps`)}
        </span>
        {!open && next && (
          <span className="min-w-0 truncate text-white/40">
            <span aria-hidden="true">· </span>{t("Sıradaki", "Next")}: {next.text}
          </span>
        )}
      </button>
      {list}
    </div>
  );
}

// Clamps to two lines and offers a toggle only when something is hidden.
export function ClampedText({ t, text, className }) {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return undefined;
    const measure = () => setClamped(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="mt-2.5">
      <p ref={ref} className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-2"} ${className}`}>{text}</p>
      {(clamped || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className={linkButtonClass}
          data-testid="goal-description-toggle">
          {expanded ? t("Daha az", "Show less") : t("Devamını gör", "Show more")}
        </button>
      )}
    </div>
  );
}

export function StepsEditor({ t, kind, steps, draft, onPatch, testIdPrefix }) {
  const inputId = useId();
  const hintId = useId();
  const draftRef = useRef(null);
  const full = steps.length >= MAX_STEPS;

  const add = (texts, clearDraft) => {
    const room = MAX_STEPS - steps.length;
    const fresh = texts.map((s) => s.trim().slice(0, STEP_MAX)).filter(Boolean).slice(0, room)
      .map((text) => ({ id: newStepId(), text, done: false }));
    if (!fresh.length) return;
    onPatch(clearDraft ? { steps: [...steps, ...fresh], stepDraft: "" } : { steps: [...steps, ...fresh] });
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      add([draft], true);
    }
  };

  // Enter in an existing step jumps to the new-step field instead of
  // submitting the whole form.
  const onStepKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      draftRef.current?.focus();
    }
  };

  // A pasted list ("- süt\n- yumurta") becomes one step per line.
  const onPaste = (e) => {
    const lines = (e.clipboardData?.getData("text") || "").split(/\r?\n/).map(stripBullet).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    add(lines, false);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className={labelClass}>
          {kind === "plan" ? t("Yapılacaklar", "To-dos") : t("Adımlar", "Steps")}{" "}
          <span className={optionalClass}>{t("isteğe bağlı", "optional")}</span>
        </label>
        {steps.length > 0 && <span className="text-xs tabular-nums text-white/35">{steps.length}/{MAX_STEPS}</span>}
      </div>
      {steps.length > 0 && (
        <ol className="mb-2 space-y-1.5" data-testid={`${testIdPrefix}-list`}>
          {steps.map((step, i) => (
            <li key={step.id}
              className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] pl-3 pr-1 transition-colors focus-within:border-violet-300/40">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-white/35">{i + 1}</span>
              <input value={step.text} maxLength={STEP_MAX}
                onChange={(e) => onPatch({ steps: steps.map((s) => (s.id === step.id ? { ...s, text: e.target.value } : s)) })}
                onKeyDown={onStepKeyDown}
                aria-label={t(`${i + 1}. adım`, `Step ${i + 1}`)} data-testid={`${testIdPrefix}-text`}
                className={`min-w-0 flex-1 bg-transparent py-2 text-sm outline-none ${step.done ? "text-white/45 line-through" : "text-white/85"}`} />
              <IconButton size={34} label={t(`${i + 1}. adımı kaldır`, `Remove step ${i + 1}`)}
                onClick={() => onPatch({ steps: steps.filter((s) => s.id !== step.id) })} testId={`${testIdPrefix}-remove`}>
                <X size={15} />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center gap-2">
        <input ref={draftRef} id={inputId} value={draft} maxLength={STEP_MAX} disabled={full} autoComplete="off"
          onChange={(e) => onPatch({ stepDraft: e.target.value })} onKeyDown={onKeyDown} onPaste={onPaste}
          placeholder={full ? t(`En fazla ${MAX_STEPS} adım eklenebilir`, `Up to ${MAX_STEPS} steps`) : t("Bir adım yaz, Enter'a bas", "Type a step, press Enter")}
          aria-describedby={hintId} data-testid={`${testIdPrefix}-input`} className={fieldClass} />
        <IconButton variant="soft" size={42} label={t("Adımı ekle", "Add step")} onClick={() => { add([draft], true); draftRef.current?.focus(); }}
          disabled={!draft.trim() || full} testId={`${testIdPrefix}-add`}>
          <Plus size={17} />
        </IconButton>
      </div>
      <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-white/35">
        {kind === "plan"
          ? t("Yaptıkça tek tek işaretlersin; liste yapıştırırsan her satır ayrı adım olur.", "Tick them off one by one; paste a list and each line becomes a step.")
          : t("Adımlara böldüğünde ilerleme kendiliğinden hesaplanır.", "With steps, progress is calculated for you.")}
      </p>
    </div>
  );
}

// Fields shared by the add form and the inline editor.
export function ItemFields({ t, lang, draft, onPatch, categories, testIds, focusSignal }) {
  const uid = useId();
  const titleRef = useRef(null);
  const isGoal = draft.kind === "goal";
  const picks = quickDates(draft.kind, t);

  useEffect(() => {
    if (!focusSignal) return;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [focusSignal]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${uid}-title`} className={labelClass}>
          {isGoal ? t("Hedefin ne?", "What's your goal?") : t("Ne planlıyorsun?", "What are you planning?")}
        </label>
        <input ref={titleRef} id={`${uid}-title`} value={draft.title} maxLength={TITLE_MAX} autoComplete="off"
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder={isGoal ? t("Ör. Yılda 24 kitap oku", "e.g. Read 24 books this year") : t("Ör. Hafta sonu İzmir gezisi", "e.g. Weekend trip to İzmir")}
          className={`${fieldClass} text-[15px]`} data-testid={testIds.title} />
      </div>

      <div>
        <label htmlFor={`${uid}-description`} className={labelClass}>
          {t("Açıklama", "Description")} <span className={optionalClass}>{t("isteğe bağlı", "optional")}</span>
        </label>
        <textarea id={`${uid}-description`} rows={2} value={draft.description} maxLength={DESCRIPTION_MAX}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder={isGoal ? t("Neden önemli, nasıl ilerleyeceksin?", "Why it matters, how you'll get there") : t("Saat, adres, notlar…", "Time, address, notes…")}
          className={`${fieldClass} max-h-48 min-h-[68px] resize-none [field-sizing:content]`} data-testid={testIds.description} />
      </div>

      {isGoal && (
        <div>
          <p id={`${uid}-category`} className={labelClass}>{t("Kategori", "Category")}</p>
          <div role="group" aria-labelledby={`${uid}-category`} data-testid={testIds.category} className="flex flex-wrap gap-1.5">
            {categories.map((key) => {
              const info = categoryInfo(key, lang);
              return (
                <Chip key={key} active={draft.category === key} onClick={() => onPatch({ category: key })}
                  icon={litGlyph(info.icon, info.hue)} testId={`${testIds.category}-${key}`}>
                  {info.label}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label htmlFor={`${uid}-date`} className={labelClass}>
          {isGoal ? t("Hedef tarihi", "Target date") : t("Tarih", "Date")}{" "}
          <span className={optionalClass}>{t("isteğe bağlı", "optional")}</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input id={`${uid}-date`} type="date" value={draft.deadline} onChange={(e) => onPatch({ deadline: e.target.value })}
            className={`${fieldClass} min-h-[44px] text-left [color-scheme:dark] sm:w-[190px] sm:shrink-0`} data-testid={testIds.deadline} />
          <div role="group" aria-label={t("Hızlı tarih seçimi", "Quick dates")} className="flex flex-wrap items-center gap-1.5">
            {picks.map((pick) => (
              <Chip key={pick.key} active={draft.deadline === pick.value} testId={`goal-date-quick-${pick.key}`}
                onClick={() => onPatch({ deadline: draft.deadline === pick.value ? "" : pick.value })}>
                {pick.label}
              </Chip>
            ))}
            {draft.deadline && (
              <button type="button" onClick={() => onPatch({ deadline: "" })} className={ghostButtonClass} data-testid="goal-date-clear">
                <X size={13} aria-hidden="true" /> {t("Tarihi kaldır", "Clear date")}
              </button>
            )}
          </div>
        </div>
      </div>

      <StepsEditor t={t} kind={draft.kind} steps={draft.steps} draft={draft.stepDraft} onPatch={onPatch} testIdPrefix={testIds.steps} />
    </div>
  );
}

// Escape cancels (preventDefault keeps the panel open), Ctrl/Cmd+Enter saves.
export function formKeys(onCancel, onSave) {
  return (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave();
    }
  };
}

export function AddForm({ t, lang, draft, onPatch, categories, saving, focusSignal, onCancel, onSubmit }) {
  const headingId = useId();
  const isGoal = draft.kind === "goal";
  return (
    <section aria-labelledby={headingId} data-testid="goal-add-form"
      className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} onKeyDown={formKeys(onCancel, onSubmit)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id={headingId} className="text-[15px] font-semibold text-white">
            {isGoal ? t("Yeni hedef", "New goal") : t("Yeni plan", "New plan")}
          </h3>
          <Segmented size="sm" label={t("Tür", "Type")} value={draft.kind} onChange={(kind) => onPatch({ kind })} testIdPrefix="goal-kind"
            options={[
              { value: "goal", label: t("Hedef", "Goal"), icon: Target },
              { value: "plan", label: t("Plan", "Plan"), icon: CalendarCheck },
            ]} />
        </div>
        <ItemFields t={t} lang={lang} draft={draft} onPatch={onPatch} categories={categories} focusSignal={focusSignal}
          testIds={{ title: "goal-input", description: "goal-description-input", category: "goal-category-select", deadline: "goal-deadline-input", steps: "goal-step" }} />
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
          <span className="mr-auto hidden items-center gap-1 whitespace-nowrap text-xs text-white/35 sm:[@media(hover:hover)]:inline-flex">
            <kbd className={kbdClass}>{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd className={kbdClass}>Enter</kbd>
            <span>{t("ile kaydet", "to save")}</span>
          </span>
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryButtonClass} data-testid="goal-cancel-button">
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="submit" disabled={!draft.title.trim() || saving} aria-busy={saving} className={primaryButtonClass}
            data-testid="goal-add-button">
            {saving && <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {isGoal ? t("Hedefi kaydet", "Save goal") : t("Planı kaydet", "Save plan")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ItemEditor({ t, lang, draft, onPatch, categories, onCancel, onSave }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} onKeyDown={formKeys(onCancel, onSave)}
      aria-label={draft.kind === "plan" ? t("Planı düzenle", "Edit plan") : t("Hedefi düzenle", "Edit goal")}
      data-testid="goal-editor" className="space-y-4">
      <ItemFields t={t} lang={lang} draft={draft} onPatch={onPatch} categories={categories} focusSignal={1}
        testIds={{ title: "goal-edit-title-input", description: "goal-edit-description-input", category: "goal-edit-category", deadline: "goal-edit-deadline-input", steps: "goal-edit-step" }} />
      <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
        <button type="button" onClick={onCancel} className={secondaryButtonClass} data-testid="goal-edit-cancel">
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="submit" disabled={!draft.title.trim()} className={primaryButtonClass} data-testid="goal-edit-save">
          {t("Kaydet", "Save")}
        </button>
      </div>
    </form>
  );
}

// When an inline editor closes (save, Vazgeç, Escape) the focused field goes
// away and focus would fall to <body>; put it back on the item's edit button.
export function useEditFocusReturn(isEditing, ref, selector) {
  const wasEditing = useRef(isEditing);
  useEffect(() => {
    if (wasEditing.current && !isEditing) {
      const active = document.activeElement;
      if (!active || active === document.body) ref.current?.querySelector(selector)?.focus({ preventScroll: true });
    }
    wasEditing.current = isEditing;
  }, [isEditing, ref, selector]);
}

export function GoalCard({ t, lang, goal, editor, onToggle, onToggleStep, onProgress, onEdit, onDelete }) {
  const cardRef = useRef(null);
  useEditFocusReturn(!!editor, cardRef, '[data-testid="goal-edit-button"]');
  const cat = categoryInfo(goal.category, lang);
  const hasSteps = goal.steps.length > 0;
  const progressLabel = t(`İlerleme: ${goal.title}`, `Progress: ${goal.title}`);
  return (
    <article ref={cardRef} data-testid="goal-item"
      className={`group rounded-2xl border p-4 transition-colors animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none ${
        goal.done && !editor
          ? "border-white/[0.05] bg-white/[0.015]"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.11] hover:bg-white/[0.04]"
      }`}>
      {editor || (
        <div className="flex items-start gap-2.5">
          <div className="-ml-2 -mt-2">
            <CheckToggle checked={goal.done} onToggle={onToggle} testId="goal-toggle-button"
              label={goal.done ? t(`Tamamlanmadı olarak işaretle: ${goal.title}`, `Mark as not done: ${goal.title}`) : t(`Tamamlandı olarak işaretle: ${goal.title}`, `Mark as done: ${goal.title}`)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className={`min-w-0 flex-1 break-words pt-px text-[15px] font-semibold leading-snug transition-colors ${
                goal.done ? "text-white/45 line-through decoration-white/25" : "text-white"
              }`}>
                {goal.title}
              </h3>
              <div className="-mr-2 -mt-1.5 flex shrink-0 items-center transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <IconButton label={t("Hedefi düzenle", "Edit goal")} size={34} onClick={onEdit} testId="goal-edit-button">
                  <Pencil size={15} />
                </IconButton>
                <IconButton label={t("Hedefi sil", "Delete goal")} size={34} onClick={onDelete} testId="goal-delete-button">
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CategoryTag category={goal.category} lang={lang} />
              {goal.deadline && <GoalDueChip t={t} lang={lang} deadline={goal.deadline} done={goal.done} />}
              {goal.done && goal.updated_at && (
                <span className="px-1 text-xs text-white/35">{t("Tamamlandı", "Completed")} · {relativeTime(goal.updated_at, lang)}</span>
              )}
            </div>
            {goal.description && (
              <ClampedText t={t} text={goal.description} className="text-[13px] leading-relaxed text-white/55" />
            )}
            {!goal.done && (hasSteps
              ? <ProgressBar value={goal.progress} color={cat.color} label={progressLabel} lang={lang} />
              : <ProgressSlider value={goal.progress} color={cat.color} label={progressLabel} lang={lang} onChange={onProgress} />)}
            {hasSteps && <StepChecklist t={t} steps={goal.steps} onToggleStep={onToggleStep} collapsible />}
          </div>
        </div>
      )}
    </article>
  );
}

export function PlanRow({ t, lang, plan, bucket, editor, onToggle, onToggleStep, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const rowRef = useRef(null);
  useEditFocusReturn(!!editor, rowRef, '[data-testid="plan-edit-button"]');
  if (editor) return <li ref={rowRef} data-testid="plan-item" className="p-4">{editor}</li>;

  const total = plan.steps.length;
  const doneCount = plan.steps.filter((s) => s.done).length;
  // Under "Bugün" / "Yarın" the section heading already says the day.
  const showDate = !!plan.deadline && bucket !== "today" && bucket !== "tomorrow";
  const hasMeta = showDate || total > 0 || (!!plan.description && !open);

  return (
    <li ref={rowRef} data-testid="plan-item" className="animate-in fade-in-0 duration-300 motion-reduce:animate-none">
      <div className="flex items-start gap-1 py-1.5 pl-2 pr-1.5">
        <CheckToggle checked={plan.done} onToggle={onToggle} size={20} testId="plan-toggle-button"
          label={plan.done ? t(`Yapılmadı olarak işaretle: ${plan.title}`, `Mark as not done: ${plan.title}`) : t(`Yapıldı olarak işaretle: ${plan.title}`, `Mark as done: ${plan.title}`)} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={detailsId}
          data-testid="plan-expand-button"
          className="flex min-h-[40px] min-w-0 flex-1 items-start gap-2 rounded-xl py-2.5 pl-1 pr-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
          <span className="min-w-0 flex-1">
            <span className={`block break-words text-[14px] font-medium leading-snug transition-colors ${
              plan.done ? "text-white/45 line-through decoration-white/25" : "text-white/90"
            }`}>
              {plan.title}
            </span>
            {hasMeta && (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {showDate && <PlanDateChip lang={lang} deadline={plan.deadline} done={plan.done} />}
                {total > 0 && (
                  <span className={`${chipBase} ${doneCount === total ? "bg-emerald-400/[0.12] text-emerald-200" : CHIP_TONES.neutral}`}>
                    <ChipGlyph icon={ListChecks} hue={doneCount === total ? "emerald" : CHIP_GLOW.neutral} />
                    {doneCount}/{total}
                    <span className="sr-only"> {t("adım", "steps")}</span>
                  </span>
                )}
                {plan.description && !open && (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-white/40">
                    <GlowIcon icon={AlignLeft} hue={CHIP_GLOW.neutral} size={12} glow={false} className="opacity-70" />
                    <span className="truncate">{plan.description.split("\n")[0]}</span>
                  </span>
                )}
              </span>
            )}
          </span>
          <ChevronDown size={16} aria-hidden="true"
            className={`mt-0.5 shrink-0 text-white/35 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div id={detailsId} hidden={!open} className="pb-3 pl-14 pr-4">
        {plan.description && (
          <p className="mb-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/60">{plan.description}</p>
        )}
        {total > 0 && <StepChecklist t={t} steps={plan.steps} onToggleStep={onToggleStep} collapsible={false} />}
        <div className="-ml-3 mt-1 flex flex-wrap items-center gap-1">
          <button type="button" onClick={onEdit} className={`${rowActionClass} hover:text-white`} data-testid="plan-edit-button">
            <Pencil size={13} aria-hidden="true" /> {t("Düzenle", "Edit")}
          </button>
          <button type="button" onClick={onDelete} className={`${rowActionClass} hover:text-rose-200`} data-testid="plan-delete-button">
            <Trash2 size={13} aria-hidden="true" /> {t("Sil", "Delete")}
          </button>
        </div>
      </div>
    </li>
  );
}

export function CompletedSection({ t, count, open, onToggle, children }) {
  const regionId = useId();
  return (
    <section className="pt-2">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={regionId} data-testid="goals-completed-toggle"
        className="-ml-1 flex min-h-[40px] items-center gap-2 rounded-xl px-1 pr-3 text-left text-[13px] font-semibold text-white/50 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
        <ChevronRight size={15} aria-hidden="true"
          className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        {t("Tamamlananlar", "Completed")}
        <span className="font-medium tabular-nums text-white/30">{count}</span>
      </button>
      <div id={regionId} hidden={!open} className="mt-2">{children}</div>
    </section>
  );
}

export function GoalStats({ t, lang, active, doneCount }) {
  const average = Math.round(active.reduce((sum, g) => sum + g.progress, 0) / active.length);
  const overdue = active.filter((g) => !g.done && g.deadline && daysUntil(g.deadline) < 0).length;
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap";
  const num = "font-semibold tabular-nums text-white/85";
  return (
    <ul aria-label={t("Hedef özeti", "Goal summary")} data-testid="goal-stats"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/50">
      <li className={item}>
        <GlowIcon icon={TrendingUp} hue="emerald" size={14} />
        <span>{t("Ortalama ilerleme", "Average progress")} <span className={num}>{formatPercent(average, lang)}</span></span>
      </li>
      {overdue > 0 && (
        <li className={`${item} text-rose-200/80`}>
          <GlowIcon icon={AlertCircle} hue="rose" size={14} />
          <span><span className="font-semibold tabular-nums">{overdue}</span> {t("gecikmiş", "overdue")}</span>
        </li>
      )}
      {doneCount > 0 && (
        <li className={item}>
          <GlowIcon icon={CircleCheck} hue="emerald" size={14} glow={false} className="opacity-60" />
          <span><span className={num}>{doneCount}</span> {t("tamamlandı", "completed")}</span>
        </li>
      )}
    </ul>
  );
}

export function TabEmpty({ t, kind, hasDone, showCta, onCreate }) {
  const isGoal = kind === "goal";
  let title;
  let body;
  if (hasDone) {
    title = isGoal ? t("Aktif hedefin kalmadı", "No active goals") : t("Bekleyen planın yok", "Nothing planned");
    body = isGoal
      ? t("Hepsini tamamladın. Sıradaki hedefin ne olsun?", "You've finished them all. What's next?")
      : t("Hepsini bitirdin. Sıradaki planı yapmaya ne dersin?", "All done. Ready to plan the next thing?");
  } else {
    title = isGoal ? t("İlk hedefini belirle", "Set your first goal") : t("İlk planını yap", "Make your first plan");
    body = isGoal
      ? t("Ulaşmak istediğin bir şeyi yaz, adımlara böl ve ilerlemeni buradan takip et.", "Write down something you want to achieve, break it into steps and track your progress here.")
      : t("Tarihi olan işlerini adım adım planla; burada güne göre sıralanır.", "Plan dated things step by step; they're sorted by day here.");
  }
  return (
    <EmptyState glyph="goals" accent="emerald" compact={hasDone || !showCta} title={title} body={body}
      action={showCta ? (
        <div className="flex flex-col items-center gap-4">
          <button type="button" onClick={() => onCreate("")} className={primaryButtonClass} data-testid={`${kind}-empty-cta`}>
            <Plus size={16} aria-hidden="true" /> {isGoal ? t("Hedef ekle", "Add a goal") : t("Plan ekle", "Add a plan")}
          </button>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-xs text-white/35">{t("Ör.", "e.g.")}</span>
            {EXAMPLES[kind].map(([tr, en]) => (
              <Chip key={tr} onClick={() => onCreate(t(tr, en))} testId="goal-example">{t(tr, en)}</Chip>
            ))}
          </div>
        </div>
      ) : null} />
  );
}

export function GoalsSkeleton({ label }) {
  const bar = "rounded-full animate-pulse motion-reduce:animate-none";
  return (
    <div role="status" aria-label={label} className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-white/10" />
          <div className="flex-1 space-y-3 pt-0.5">
            <div className={`h-3.5 bg-white/[0.08] ${bar}`} style={{ width: `${68 - i * 14}%` }} />
            <div className="flex gap-1.5">
              <div className={`h-5 w-16 bg-white/[0.06] ${bar}`} />
              <div className={`h-5 w-24 bg-white/[0.05] ${bar}`} />
            </div>
            <div className={`h-1.5 w-full bg-white/[0.06] ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
