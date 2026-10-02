import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Flame, Loader2, PenLine, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJournal, createJournalEntry, editJournalEntry, deleteJournalEntry } from "@/lib/api";
import { GlowIcon, GlyphTile } from "@/components/icons/GlyphTile";
import {
  Panel, PanelHeader, PanelBody, IconButton, Segmented, SectionLabel, EmptyState, ErrorState,
  usePanelTitleId, fieldClass, primaryButtonClass, secondaryButtonClass,
} from "@/components/panel/Panel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { addDays, dayKey, formatDate, formatTime, startOfDay, toDate } from "@/lib/dates";

// The API silently truncates longer entries, so cap the field instead.
const MAX_LENGTH = 8000;
// Matches `leading-6` on the auto-growing textareas.
const LINE_PX = 24;

const PROMPTS = [
  ["Bugün beni mutlu eden…", "Today I felt happy when…"],
  ["Bugün zorlandığım…", "Today I struggled with…"],
  ["Öğrendiğim bir şey…", "Something I learned…"],
  ["Yarın için niyetim…", "Tomorrow I intend to…"],
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");

// A draft whose save failed after the panel was already closed. The next
// time the journal opens, the composer starts with it instead of losing it.
let unsavedDraft = "";

const editFieldClass = fieldClass.replace("text-sm", "text-[15px]");
const kbdClass =
  "rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-white/50 [font-family:inherit]";
const linkButtonClass =
  "rounded-md px-1 py-1 text-[13px] font-semibold text-violet-300 transition-colors hover:text-violet-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60";

const timeOf = (iso) => toDate(iso)?.getTime() || 0;
const byNewest = (a, b) => timeOf(b.created_at) - timeOf(a.created_at);

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function wasEdited(entry) {
  const created = timeOf(entry.created_at);
  const updated = timeOf(entry.updated_at);
  return created > 0 && updated - created > 60000;
}

function journalStats(entries) {
  const now = new Date();
  const days = new Set();
  let thisMonth = 0;
  for (const entry of entries) {
    const d = toDate(entry.created_at);
    if (!d) continue;
    days.add(dayKey(d));
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth += 1;
  }
  // A streak is still alive until today ends: yesterday's run counts even
  // before today's page is written.
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { total: entries.length, thisMonth, streak, wroteToday: days.has(dayKey(now)) };
}

// Items arrive newest first, so consecutive runs of the same month form a group.
function groupByMonth(items, getDate) {
  const groups = [];
  for (const item of items) {
    const date = getDate(item);
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : "undated";
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, date, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function AutoGrowTextarea({ inputRef, value, minRows, maxRows, className = "", ...rest }) {
  const ownRef = useRef(null);
  const setRef = useCallback((el) => {
    ownRef.current = el;
    if (inputRef) inputRef.current = el;
  }, [inputRef]);

  const fit = useCallback(() => {
    const el = ownRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = el.offsetHeight - el.clientHeight;
    const max = maxRows * LINE_PX + padding;
    el.style.height = "auto";
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(needed, max) + border}px`;
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [maxRows]);

  useLayoutEffect(() => { fit(); }, [fit, value]);

  // Line wrapping changes with the width (rotation, window resize).
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  return <textarea ref={setRef} rows={minRows} value={value} className={`resize-none leading-6 ${className}`} {...rest} />;
}

function Composer({ t, todayLabel, draft, onDraftChange, saving, onSave, onCancel, onPrompt, inputRef }) {
  const inputId = useId();
  const hintId = useId();
  const words = wordCount(draft);
  const remaining = MAX_LENGTH - draft.length;

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      // Always claimed here, so the panel never closes from inside the field
      // (an IME's Escape only cancels the composition). stopPropagation too:
      // the discard dialog opened below registers its own document Escape
      // listener before this same keydown reaches document, and would
      // dismiss itself instantly.
      e.preventDefault();
      e.stopPropagation();
      if (!e.nativeEvent.isComposing && !saving) onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <section aria-label={t("Yeni günlük kaydı", "New journal entry")} data-testid="journal-composer"
      className="rounded-2xl border border-white/10 bg-white/[0.035] transition-[border-color,box-shadow] focus-within:border-violet-300/40 focus-within:ring-4 focus-within:ring-violet-400/10 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <p className="flex items-center gap-1.5 px-4 pt-3.5 text-xs">
        <span className="font-semibold text-violet-200">{t("Bugün", "Today")}</span>
        <span aria-hidden="true" className="text-white/25">·</span>
        <span className="truncate text-white/50">{todayLabel}</span>
      </p>
      <label htmlFor={inputId} className="sr-only">{t("Günlük kaydın", "Your journal entry")}</label>
      <AutoGrowTextarea id={inputId} inputRef={inputRef} value={draft} minRows={4} maxRows={12}
        onChange={(e) => onDraftChange(e.target.value)} onKeyDown={onKeyDown} readOnly={saving}
        maxLength={MAX_LENGTH} aria-describedby={hintId} data-testid="journal-input"
        placeholder={t("Bugün nasıl geçti? Aklında neler var?", "How was your day? What's on your mind?")}
        className="block w-full bg-transparent px-4 pt-2 pb-3 text-[15px] text-white placeholder:text-white/30 outline-none" />

      <div role="group" aria-label={t("Yazma önerileri", "Writing prompts")}
        className="flex gap-1.5 overflow-x-auto px-4 pb-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
        {PROMPTS.map(([tr, en]) => {
          const label = t(tr, en);
          return (
            // preventDefault on mousedown keeps the caret (and the phone's
            // keyboard) in the textarea while a prompt is inserted.
            <button key={tr} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPrompt(label)}
              disabled={saving} data-testid="journal-prompt"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-40">
              <Plus size={12} aria-hidden="true" className="text-white/35" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-white/40">
          {remaining < 400 ? (
            <span className="truncate tabular-nums text-amber-200/80">{t(`${remaining} karakter kaldı`, `${remaining} characters left`)}</span>
          ) : (
            <span className="truncate tabular-nums">{t(`${words} kelime`, `${words} ${words === 1 ? "word" : "words"}`)}</span>
          )}
          <span id={hintId} className="hidden sm:[@media(hover:hover)]:inline-flex items-center gap-1 whitespace-nowrap text-white/35">
            <kbd className={kbdClass}>{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd className={kbdClass}>Enter</kbd>
            <span>{t("ile kaydet", "to save")}</span>
          </span>
        </div>
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryButtonClass} data-testid="journal-cancel-button">
          {t("Vazgeç", "Cancel")}
        </button>
        {/* Not `disabled` while saving: that would grey the button out
            mid-save; onSave ignores repeat presses instead. */}
        <button type="button" onClick={onSave} disabled={!draft.trim()}
          aria-disabled={saving || undefined} aria-busy={saving || undefined}
          className={`${primaryButtonClass} ${saving ? "cursor-wait" : ""}`} data-testid="journal-save-button">
          {saving && <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          {t("Kaydet", "Save")}
        </button>
      </div>
    </section>
  );
}

function ComposePrompt({ t, todayLabel, wroteToday, onOpen }) {
  return (
    <button type="button" onClick={onOpen} data-testid="journal-compose-prompt"
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-left transition-colors hover:border-violet-300/25 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
      <GlyphTile icon={PenLine} hue="violet" size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white/85">
          {wroteToday ? t("Bugün için bir sayfa daha yaz", "Write another page for today") : t("Bugün neler yaşadın?", "How was your day?")}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/40">{t("Bugün", "Today")} · {todayLabel}</span>
      </span>
      <Plus size={16} aria-hidden="true" className="shrink-0 text-white/30 transition-colors group-hover:text-white/60" />
    </button>
  );
}

function StatsStrip({ t, tr, stats }) {
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap";
  const num = "font-semibold tabular-nums text-white/85";
  return (
    <ul aria-label={t("Günlük istatistikleri", "Journal stats")} data-testid="journal-stats"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/50">
      <li className={item}>
        <GlowIcon icon={PenLine} hue="violet" size={14} />
        <span><span className={num}>{stats.total}</span> {t("kayıt", stats.total === 1 ? "entry" : "entries")}</span>
      </li>
      <li className={item}>
        <GlowIcon icon={CalendarDays} hue="sky" size={14} />
        {tr
          ? <span>Bu ay <span className={num}>{stats.thisMonth}</span></span>
          : <span><span className={num}>{stats.thisMonth}</span> this month</span>}
      </li>
      <li className={item} title={t("Art arda yazdığın gün sayısı", "Days in a row you've written")}>
        {/* The flame only lights up while a streak is alive. */}
        {stats.streak
          ? <GlowIcon icon={Flame} hue="amber" size={14} />
          : <Flame size={14} aria-hidden="true" className="text-white/30" />}
        {stats.streak
          ? <span><span className={num}>{stats.streak}</span>{t(" günlük seri", "-day streak")}</span>
          : <span>{t("Seri yok", "No streak yet")}</span>}
      </li>
    </ul>
  );
}

function DateColumn({ date, lang, highlight }) {
  return (
    <div aria-hidden="true" className="w-10 shrink-0 pt-0.5 text-center">
      {date ? (
        <>
          <div className={`text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${highlight ? "text-violet-200" : "text-white/90"}`}>
            {date.getDate()}
          </div>
          <div className={`mt-1.5 text-[11px] font-medium ${highlight ? "text-violet-200/70" : "text-white/40"}`}>
            {formatDate(date, lang, { weekday: "short" })}
          </div>
        </>
      ) : (
        <div className="text-white/30">–</div>
      )}
    </div>
  );
}

const fullDateLabel = (date, lang) =>
  date ? formatDate(date, lang, { day: "numeric", month: "long", year: "numeric", weekday: "long" }) : "";

// Clamps long text to six lines and offers a toggle only when something is
// actually hidden — measured, since the cut-off depends on the panel width.
function ClampedText({ t, text, className }) {
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
    <>
      <p ref={ref} className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-6"} ${className}`}>{text}</p>
      {(clamped || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
          className={`${linkButtonClass} mt-1 -ml-1`} data-testid="journal-read-more">
          {expanded ? t("Daha az", "Show less") : t("Devamını oku", "Read more")}
        </button>
      )}
    </>
  );
}

function EntryEditor({ t, inputRef, value, onChange, onCancel, onSave }) {
  const inputId = useId();

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [inputRef]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.nativeEvent.isComposing) onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <div className="mt-2 space-y-2.5">
      <label htmlFor={inputId} className="sr-only">{t("Kaydı düzenle", "Edit entry")}</label>
      <AutoGrowTextarea id={inputId} inputRef={inputRef} value={value} minRows={3} maxRows={12} maxLength={MAX_LENGTH}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
        className={editFieldClass} data-testid="journal-edit-input" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass} data-testid="journal-edit-cancel">
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="button" onClick={onSave} disabled={!value.trim()} className={primaryButtonClass} data-testid="journal-edit-save">
          {t("Kaydet", "Save")}
        </button>
      </div>
    </div>
  );
}

function EntryCard({ t, lang, entry, editText, editInputRef, onEditTextChange, onStartEdit, onCancelEdit, onSaveEdit, onDelete }) {
  const date = toDate(entry.created_at);
  const isToday = !!date && dayKey(date) === dayKey(new Date());
  const editing = editText !== null;
  const edited = wasEdited(entry);
  const actionsRef = useRef(null);
  const wasEditing = useRef(editing);

  // Closing the editor unmounts the focused field; hand focus back to the
  // edit button so keyboard users stay on this entry.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const active = document.activeElement;
      if (!active || active === document.body) actionsRef.current?.querySelector("button")?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);

  const editedAt = edited ? `${formatDate(entry.updated_at, lang, { day: "numeric", month: "long" })}, ${formatTime(entry.updated_at, lang)}` : "";

  return (
    <article data-testid="journal-entry"
      className="group flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 transition-colors hover:border-white/10 hover:bg-white/[0.035]">
      <DateColumn date={date} lang={lang} highlight={isToday} />
      <div className="min-w-0 flex-1 border-l border-white/[0.06] pl-3.5">
        <div className="flex min-h-[28px] items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-white/45">
            <span className="sr-only">{fullDateLabel(date, lang)}, </span>
            <time dateTime={entry.created_at} className="font-medium tabular-nums">{formatTime(entry.created_at, lang)}</time>
            {edited && (
              <>
                <span aria-hidden="true" className="mx-1.5 text-white/20">·</span>
                <span className="text-white/35" title={t(`Son düzenleme: ${editedAt}`, `Last edited ${editedAt}`)}>
                  {t("düzenlendi", "edited")}
                </span>
              </>
            )}
          </p>
          {!editing && (
            <div ref={actionsRef} className="-my-1.5 -mr-2 flex items-center transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label={t("Kaydı düzenle", "Edit entry")} onClick={onStartEdit} size={34} testId="journal-edit-button">
                <Pencil size={15} />
              </IconButton>
              <IconButton label={t("Kaydı sil", "Delete entry")} onClick={onDelete} size={34} testId="journal-delete-button">
                <Trash2 size={15} />
              </IconButton>
            </div>
          )}
        </div>
        {editing ? (
          <EntryEditor t={t} inputRef={editInputRef} value={editText} onChange={onEditTextChange} onCancel={onCancelEdit} onSave={onSaveEdit} />
        ) : (
          <ClampedText t={t} text={entry.content} className="mt-1 text-[15px] leading-relaxed text-white/85" />
        )}
      </div>
    </article>
  );
}

function SummaryCard({ t, lang, summary }) {
  const date = toDate(summary.day);
  const isToday = !!date && dayKey(date) === dayKey(new Date());
  return (
    <article data-testid="journal-ai-summary" className="flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
      <DateColumn date={date} lang={lang} highlight={isToday} />
      <div className="min-w-0 flex-1 border-l border-white/[0.06] pl-3.5">
        <p className="flex min-h-[20px] items-center gap-1.5 text-xs font-medium text-violet-200/80">
          <GlowIcon icon={Sparkles} hue="violet" size={13} />
          {t("Luna'nın özeti", "Luna's recap")}
          <span className="sr-only">, {fullDateLabel(date, lang)}</span>
        </p>
        <ClampedText t={t} text={summary.summary} className="mt-1.5 text-sm leading-relaxed text-white/75" />
      </div>
    </article>
  );
}

function MonthGroup({ label, countLabel, children }) {
  return (
    <section>
      <SectionLabel action={<span className="text-xs tabular-nums text-white/30">{countLabel}</span>}>{label}</SectionLabel>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function TimelineSkeleton({ label }) {
  const bar = "rounded-full animate-pulse motion-reduce:animate-none";
  return (
    <div role="status" aria-label={label} className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="flex w-10 shrink-0 flex-col items-center gap-2 pt-0.5">
            <div className="h-5 w-7 rounded-md bg-white/[0.08] animate-pulse motion-reduce:animate-none" />
            <div className={`h-2.5 w-6 bg-white/[0.06] ${bar}`} />
          </div>
          <div className="flex-1 space-y-2.5 border-l border-white/[0.06] pl-3.5 pt-1">
            <div className={`h-2.5 w-10 bg-white/[0.07] ${bar}`} />
            <div className={`h-3 bg-white/[0.07] ${bar}`} style={{ width: `${90 - i * 12}%` }} />
            <div className={`h-3 bg-white/[0.05] ${bar}`} style={{ width: `${58 + i * 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function JournalPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const [entries, setEntries] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading" | "error" | "ready"
  const [tab, setTab] = useState("entries"); // "entries" | "ai"
  const [composerOpen, setComposerOpen] = useState(() => !!unsavedDraft);
  const [draft, setDraft] = useState(() => unsavedDraft);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }
  // { kind: "delete", entry } | { kind: "discard", then: "collapse" | "close" } | { kind: "discardEdit" }
  const [confirm, setConfirm] = useState(null);
  const [focusRequest, setFocusRequest] = useState(() => (unsavedDraft ? 1 : 0));
  const composerRef = useRef(null);
  const editInputRef = useRef(null);
  const writeToggleRef = useRef(null);
  const confirmOpenerRef = useRef(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const loadSeq = useRef(0);
  const wasComposerOpen = useRef(composerOpen);

  useEffect(() => {
    mountedRef.current = true;
    unsavedDraft = "";
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    // Only the latest request may write state (retry pressed twice, etc.).
    const seq = ++loadSeq.current;
    setStatus("loading");
    try {
      const data = await fetchJournal();
      if (seq !== loadSeq.current) return;
      setEntries([...data.entries].sort(byNewest));
      setSummaries(data.aiSummaries);
      setStatus("ready");
    } catch {
      if (seq === loadSeq.current) setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Runs after the composer has mounted / the inserted prompt has rendered.
  useEffect(() => {
    if (!focusRequest) return;
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    el.scrollTop = el.scrollHeight;
  }, [focusRequest]);

  const focusWriteToggle = useCallback(() => {
    writeToggleRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);

  // When the composer closes (saved, Vazgeç, Escape) the focused field goes
  // with it; land on the "+" button instead of the page behind the panel.
  useEffect(() => {
    if (wasComposerOpen.current && !composerOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) focusWriteToggle();
    }
    wasComposerOpen.current = composerOpen;
  }, [composerOpen, focusWriteToggle]);

  const stats = useMemo(() => journalStats(entries), [entries]);
  const entryGroups = useMemo(() => groupByMonth(entries, (e) => toDate(e.created_at)), [entries]);
  const summaryGroups = useMemo(() => groupByMonth(summaries, (s) => toDate(s.day)), [summaries]);
  const todayLabel = formatDate(new Date(), lang, { day: "numeric", month: "long", weekday: "long" });
  const editingEntry = editing ? entries.find((e) => e.id === editing.id) : null;
  const editDirty = !!editingEntry && editing.text.trim() !== editingEntry.content;

  const askConfirm = (next) => {
    confirmOpenerRef.current = document.activeElement;
    setConfirm(next);
  };

  const openComposer = () => {
    setComposerOpen(true);
    setFocusRequest((n) => n + 1);
  };

  const collapseComposer = () => {
    setComposerOpen(false);
    setDraft("");
  };

  const cancelComposer = () => {
    if (draft.trim()) askConfirm({ kind: "discard", then: "collapse" });
    else collapseComposer();
  };

  // Closing the panel with unsaved writing asks first instead of losing it.
  // A draft that is already being saved needs no question: the request
  // finishes on its own and its toast reports the outcome.
  const requestClose = () => {
    if (composerOpen && draft.trim() && !saving) askConfirm({ kind: "discard", then: "close" });
    else if (editDirty) askConfirm({ kind: "discardEdit" });
    else onClose();
  };

  const insertPrompt = (label) => {
    const stem = label.endsWith("…") ? label.slice(0, -1) : label;
    // Focus inside the tap itself; iOS only raises the keyboard for that.
    composerRef.current?.focus({ preventScroll: true });
    setDraft((current) => {
      const base = current.trimEnd();
      return `${base ? `${base}\n` : ""}${stem} `.slice(0, MAX_LENGTH);
    });
    setFocusRequest((n) => n + 1);
  };

  const saveDraft = async () => {
    const text = draft.trim();
    if (!text || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const entry = await createJournalEntry(text);
      setEntries((list) => [entry, ...list.filter((e) => e.id !== entry.id)].sort(byNewest));
      setDraft("");
      setComposerOpen(false);
      setTab("entries");
      toast.success(t("Günlük kaydedildi", "Journal entry saved"));
    } catch {
      if (mountedRef.current) {
        toast.error(t("Günlük kaydedilemedi", "Couldn't save your entry"), {
          description: t("Yazdıkların duruyor. Bağlantını kontrol edip tekrar dene.", "Your text is still here. Check your connection and try again."),
        });
      } else {
        unsavedDraft = text;
        toast.error(t("Günlük kaydedilemedi", "Couldn't save your entry"), {
          description: t("Yazdıkların kaybolmadı; günlüğü yeniden açtığında seni bekliyor olacak.",
            "Your text isn't lost. It'll be waiting when you open the journal again."),
        });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const text = editing.text.trim();
    const previous = entries.find((e) => e.id === editing.id);
    if (!text || !previous) return;
    setEditing(null);
    if (text === previous.content) return;
    const optimistic = { ...previous, content: text, updated_at: new Date().toISOString() };
    setEntries((list) => list.map((e) => (e.id === previous.id ? optimistic : e)));
    // The content checks below leave the entry alone if a newer edit of it
    // was made meanwhile; that request owns the outcome now.
    try {
      const saved = await editJournalEntry(previous.id, text);
      if (saved && saved.id === previous.id) {
        setEntries((list) => list.map((e) => (e.id === previous.id && e.content === text ? { ...e, ...saved } : e)));
      }
    } catch {
      setEntries((list) => list.map((e) => (e.id === previous.id && e.content === text ? previous : e)));
      if (mountedRef.current) {
        // Give the user their wording back so a retry is one click away.
        setEditing((current) => current || { id: previous.id, text });
      }
      toast.error(t("Değişiklik kaydedilemedi", "Couldn't save your changes"), {
        description: mountedRef.current
          ? t("Kayıt önceki haline döndü; düzenlemen açık duruyor. Bağlantını kontrol edip tekrar dene.",
            "The entry was restored and your edit is still open. Check your connection and try again.")
          : t("Kayıt önceki haliyle duruyor. Bağlantını kontrol edip tekrar dene.",
            "The entry keeps its previous text. Check your connection and try again."),
      });
    }
  };

  const deleteEntry = async (entry) => {
    if (editing?.id === entry.id) setEditing(null);
    setEntries((list) => list.filter((e) => e.id !== entry.id));
    try {
      await deleteJournalEntry(entry.id);
    } catch (err) {
      // A 404 means it's already gone on the server (e.g. deleted on another
      // device), which is the outcome the user asked for.
      if (err?.response?.status !== 404) {
        setEntries((list) => (list.some((e) => e.id === entry.id) ? list : [...list, entry].sort(byNewest)));
        toast.error(t("Kayıt silinemedi", "Couldn't delete the entry"), {
          description: t("Kayıt günlüğüne geri eklendi. Bağlantını kontrol edip tekrar dene.", "It's back in your journal. Check your connection and try again."),
        });
        return;
      }
    }
    toast.success(t("Kayıt silindi", "Entry deleted"));
  };

  const onConfirm = () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    if (current.kind === "delete") {
      deleteEntry(current.entry);
      // Its delete button is about to disappear with the entry.
      focusWriteToggle();
    } else if (current.kind === "discardEdit") {
      setEditing(null);
      onClose();
    } else {
      collapseComposer();
      if (current.then === "close") onClose();
      else focusWriteToggle();
    }
  };

  const onCancelConfirm = () => {
    const current = confirm;
    setConfirm(null);
    if (current?.kind === "discard") {
      setFocusRequest((n) => n + 1);
    } else if (current?.kind === "discardEdit" && editInputRef.current) {
      editInputRef.current.focus({ preventScroll: true });
    } else {
      const opener = confirmOpenerRef.current;
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    }
  };

  let confirmCopy;
  if (confirm?.kind === "delete") {
    confirmCopy = {
      title: t("Bu günlük kaydını silmek istiyor musun?", "Delete this journal entry?"),
      body: t("Bu işlem geri alınamaz.", "This can't be undone."),
      confirmLabel: t("Sil", "Delete"),
      cancelLabel: t("Vazgeç", "Cancel"),
    };
  } else if (confirm?.kind === "discardEdit") {
    confirmCopy = {
      title: t("Değişiklikler kaydedilmeden kapatılsın mı?", "Close without saving your changes?"),
      body: t("Düzenlediğin kayıttaki değişiklikler kaybolacak.", "Your changes to this entry will be lost."),
      confirmLabel: t("Kaydetmeden kapat", "Close without saving"),
      cancelLabel: t("Düzenlemeye dön", "Keep editing"),
    };
  } else {
    confirmCopy = {
      title: t("Taslak silinsin mi?", "Discard this draft?"),
      body: t("Henüz kaydetmediğin yazı kaybolacak.", "What you've written hasn't been saved and will be lost."),
      confirmLabel: t("Taslağı sil", "Discard"),
      cancelLabel: t("Yazmaya devam et", "Keep writing"),
    };
  }

  const ready = status === "ready";
  const monthLabel = (date) => (date ? formatDate(date, lang, { month: "long", year: "numeric" }) : t("Tarihsiz", "Undated"));

  let list;
  if (status === "loading") {
    list = <TimelineSkeleton label={t("Günlük yükleniyor", "Loading your journal")} />;
  } else if (status === "error") {
    list = (
      <ErrorState
        title={t("Günlüğün yüklenemedi", "Couldn't load your journal")}
        body={t("Bağlantında bir sorun olabilir. Birazdan tekrar dene.", "There may be a connection problem. Try again in a moment.")}
        onRetry={load}
        retryLabel={t("Tekrar dene", "Try again")}
      />
    );
  } else if (tab === "entries") {
    list = entries.length === 0 ? (
      <EmptyState glyph="journal" accent="violet" compact={composerOpen}
        title={t("İlk sayfanı yaz", "Write your first page")}
        body={t("Günün nasıl geçti, aklında ne var? Birkaç cümle yeter.", "How was your day? What's on your mind? A few sentences are enough.")}
        action={composerOpen ? null : (
          <button type="button" onClick={openComposer} className={primaryButtonClass} data-testid="journal-empty-cta">
            <PenLine size={15} aria-hidden="true" /> {t("Yazmaya başla", "Start writing")}
          </button>
        )}
      />
    ) : (
      <div className="space-y-6">
        {entryGroups.map((group, i) => (
          <MonthGroup key={`${group.key}:${i}`} label={monthLabel(group.date)}
            countLabel={t(`${group.items.length} kayıt`, `${group.items.length} ${group.items.length === 1 ? "entry" : "entries"}`)}>
            {group.items.map((entry) => (
              <EntryCard key={entry.id} t={t} lang={lang} entry={entry}
                editText={editing?.id === entry.id ? editing.text : null}
                editInputRef={editInputRef}
                onEditTextChange={(text) => setEditing({ id: entry.id, text })}
                onStartEdit={() => setEditing({ id: entry.id, text: entry.content })}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={saveEdit}
                onDelete={() => askConfirm({ kind: "delete", entry })}
              />
            ))}
          </MonthGroup>
        ))}
      </div>
    );
  } else {
    list = summaries.length === 0 ? (
      <EmptyState glyph="chats" accent="violet"
        title={t("Henüz özet yok", "No recaps yet")}
        body={t("Sohbet ettiğin günlerin sonunda Luna kısa bir özet çıkarır; burada birikir.",
          "At the end of each day you chat, Luna writes a short recap. They collect here.")}
      />
    ) : (
      <div className="space-y-6">
        {summaryGroups.map((group, i) => (
          <MonthGroup key={`${group.key}:${i}`} label={monthLabel(group.date)}
            countLabel={t(`${group.items.length} özet`, `${group.items.length} ${group.items.length === 1 ? "recap" : "recaps"}`)}>
            {group.items.map((summary) => (
              <SummaryCard key={summary.id || summary.day} t={t} lang={lang} summary={summary} />
            ))}
          </MonthGroup>
        ))}
      </div>
    );
  }

  return (
    <Panel onClose={requestClose} size="lg" accent="violet" labelledBy={titleId} testId="journal-panel">
      <PanelHeader
        glyph="journal"
        accent="violet"
        title={t("Günlük", "Journal")}
        subtitle={t("Yazdıkların Luna'nın hafızasına da işlenir.", "What you write also becomes part of Luna's memory.")}
        titleId={titleId}
        onClose={requestClose}
        closeLabel={t("Kapat", "Close")}
        actions={(
          // `contents` keeps the button a direct flex item; the span is only
          // a handle for moving focus back to it.
          <span ref={writeToggleRef} className="contents">
            <IconButton variant="primary" size={40} label={t("Yeni sayfa yaz", "Write a new page")} onClick={openComposer} testId="journal-write-toggle">
              <Plus size={18} />
            </IconButton>
          </span>
        )}
      />
      <PanelBody className="space-y-5">
        {composerOpen ? (
          <Composer t={t} todayLabel={todayLabel} draft={draft} onDraftChange={setDraft} saving={saving}
            onSave={saveDraft} onCancel={cancelComposer} onPrompt={insertPrompt} inputRef={composerRef} />
        ) : ready && entries.length > 0 ? (
          <ComposePrompt t={t} todayLabel={todayLabel} wroteToday={stats.wroteToday} onOpen={openComposer} />
        ) : null}

        <div className="space-y-4">
          <Segmented
            label={t("Günlük görünümü", "Journal view")}
            value={tab}
            onChange={setTab}
            testIdPrefix="journal-tab"
            options={[
              { value: "entries", label: t("Günlüğüm", "My entries"), count: ready ? entries.length : undefined },
              { value: "ai", label: t("Luna'nın özetleri", "Luna's recaps"), icon: Sparkles, count: ready ? summaries.length : undefined },
            ]}
          />
          {ready && tab === "entries" && entries.length > 0 && <StatsStrip t={t} tr={lang === "tr"} stats={stats} />}
        </div>

        {list}
      </PanelBody>

      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirmCopy.title}
        body={confirmCopy.body}
        confirmLabel={confirmCopy.confirmLabel}
        cancelLabel={confirmCopy.cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancelConfirm}
      />
    </Panel>
  );
}
