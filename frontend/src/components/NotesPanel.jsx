import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  StickyNote, Plus, Search, SearchX, X, Pencil, Trash2, Check, Copy, Loader2, ChevronDown,
  FileText, User, Briefcase, Lightbulb, Star, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { fetchNotes, createNote, editNote, deleteNote } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Panel, PanelHeader, PanelBody, IconButton, Chip, ChipRail, EmptyState, ErrorState,
  usePanelTitleId, fieldClass, primaryButtonClass, secondaryButtonClass,
} from "@/components/panel/Panel";
import { relativeTime, formatDate, formatTime, locale } from "@/lib/dates";

const CATEGORY_META = {
  genel: { tr: "Genel", en: "General", icon: FileText, rgb: "203,213,225" },
  "kişisel": { tr: "Kişisel", en: "Personal", icon: User, rgb: "196,181,253" },
  "iş": { tr: "İş", en: "Work", icon: Briefcase, rgb: "125,211,252" },
  fikir: { tr: "Fikir", en: "Idea", icon: Lightbulb, rgb: "110,231,183" },
  "önemli": { tr: "Önemli", en: "Important", icon: Star, rgb: "252,211,77" },
};
const DEFAULT_CATEGORIES = Object.keys(CATEGORY_META);
const CUSTOM_META = { icon: Tag, rgb: "203,213,225" };

// Same limits the backend enforces (notes.py): longer input is cut there.
const TITLE_MAX = 150;
const CONTENT_MAX = 8000;
const SEARCH_MAX = 100;

const EMPTY_DRAFT = { title: "", content: "", category: "genel" };

// A note saved without a category reads as "genel"; one this build doesn't
// know keeps its own key so it still gets a label and a filter chip.
function catKey(raw) {
  const key = String(raw || "").trim();
  if (!key) return "genel";
  if (CATEGORY_META[key]) return key;
  const lower = key.toLocaleLowerCase("tr");
  return CATEGORY_META[lower] ? lower : key;
}

const catMeta = (key) => CATEGORY_META[key] || CUSTOM_META;

function catLabel(key, lang) {
  const meta = CATEGORY_META[key];
  if (meta) return lang === "tr" ? meta.tr : meta.en;
  return key.charAt(0).toLocaleUpperCase(lang === "tr" ? "tr" : "en") + key.slice(1);
}

// ASCII test ids: "kişisel" -> "kisisel".
const TR_ASCII = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
const slug = (key) => key.replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => TR_ASCII[ch]).toLowerCase().replace(/[^a-z0-9]+/g, "-");

const noteText = (n) => [String(n.title || "").trim(), String(n.content || "").trim()].filter(Boolean).join("\n\n");

function excerpt(text, max = 140) {
  const s = String(text || "").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";

// Focus helpers for when the focused control unmounts (composer closed,
// note deleted, confirm dialog dismissed) — otherwise focus drops to <body>.
const PANEL_SELECTOR = '[data-testid="notes-panel"]';

function focusNoteControl(id, testId) {
  const card = [...document.querySelectorAll(`${PANEL_SELECTOR} [data-testid="note-item"]`)]
    .find((el) => el.dataset.noteId === String(id));
  const control = card?.querySelector(`[data-testid="${testId}"]`);
  control?.focus();
  return !!control;
}

function focusAddToggle() {
  document.querySelector(`${PANEL_SELECTOR} [data-testid="note-add-toggle"]`)?.focus();
}

const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

// Grows the textarea with its content up to `maxPx` (and half the viewport,
// so the bottom sheet keeps its buttons on screen). The scroll position of
// the panel body is restored because the "auto" step briefly shrinks it.
function useAutoGrow(ref, value, maxPx) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest(".overflow-y-auto");
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const max = Math.min(maxPx, Math.round(window.innerHeight * 0.5));
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.height = `${Math.min(full, max)}px`;
    el.style.overflowY = full > max ? "auto" : "hidden";
    if (scroller) scroller.scrollTop = scrollTop;
  }, [ref, value, maxPx]);
}

function CategoryPill({ category, lang }) {
  const { icon: Icon, rgb } = catMeta(category);
  return (
    <span className="inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5"
      style={{ color: `rgb(${rgb})`, backgroundColor: `rgba(${rgb},0.1)`, boxShadow: `inset 0 0 0 1px rgba(${rgb},0.16)` }}>
      <Icon size={12} aria-hidden="true" />
      {catLabel(category, lang)}
    </span>
  );
}

// Shared by the composer (framed card at the top) and the inline editor
// (inside the note's own card). `onChange` is a state setter.
// `focusIfLost`: only take focus when nothing else has it — a reopened
// editor must not pull the user out of whatever they moved on to.
function NoteForm({
  values, onChange, onSubmit, onCancel, saving = false, lang, t, categoryKeys, ids, label, hint, framed = false, focusField,
  focusIfLost = false,
}) {
  const titleRef = useRef(null);
  const contentRef = useRef(null);
  const focusRef = useRef({ field: focusField, onlyIfLost: focusIfLost });
  useAutoGrow(contentRef, values.content, framed ? 320 : 420);

  useEffect(() => {
    const { field, onlyIfLost } = focusRef.current;
    if (onlyIfLost && !focusIsLost()) return;
    const el = field === "content" ? contentRef.current : field === "title" ? titleRef.current : null;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const length = values.content.length;
  const canSave = values.content.trim().length > 0 && !saving;

  const submit = (e) => {
    e?.preventDefault();
    if (canSave) onSubmit();
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (!saving) onCancel("escape");
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  // Enter in the title moves on to the note instead of submitting the form.
  const onTitleKeyDown = (e) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      contentRef.current?.focus();
    }
  };

  const set = (field) => (e) => {
    const v = e.target.value;
    onChange((prev) => ({ ...prev, [field]: v }));
  };

  const pad = framed ? "px-4 sm:px-5" : "";

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} aria-label={label} data-testid={ids.form}
      className={framed
        ? "mb-5 rounded-2xl border border-white/10 bg-white/[0.04] transition-[border-color,background-color,box-shadow] focus-within:border-indigo-300/35 focus-within:bg-white/[0.05] focus-within:ring-4 focus-within:ring-indigo-400/10 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none motion-reduce:transition-none"
        : ""}>
      <div className={framed ? `${pad} pt-4` : ""}>
        <input ref={titleRef} value={values.title} onChange={set("title")} onKeyDown={onTitleKeyDown} maxLength={TITLE_MAX} readOnly={saving}
          placeholder={t("Başlık", "Title")} aria-label={t("Başlık (isteğe bağlı)", "Title (optional)")}
          autoComplete="off" enterKeyHint="next" data-testid={ids.title}
          className="block w-full bg-transparent text-base sm:text-[15px] font-semibold leading-snug text-white placeholder:text-white/30 outline-none" />
        <textarea ref={contentRef} value={values.content} onChange={set("content")} rows={framed ? 3 : 4} maxLength={CONTENT_MAX} readOnly={saving}
          placeholder={t("Bir not yaz…", "Write a note…")} aria-label={t("Not", "Note")} data-testid={ids.content}
          className="mt-2 block w-full resize-none bg-transparent text-base sm:text-[14px] leading-relaxed text-white/85 placeholder:text-white/30 outline-none" />
      </div>

      <div className={framed ? `${pad} mt-3 border-t border-white/[0.06] pt-3` : "mt-4"}>
        <div role="group" aria-label={t("Kategori", "Category")} data-testid={ids.category} className="flex flex-wrap gap-1.5">
          {categoryKeys.map((k) => {
            const meta = catMeta(k);
            return (
              <Chip key={k} active={values.category === k} onClick={() => onChange((prev) => ({ ...prev, category: k }))}
                icon={meta.icon} color={`rgb(${meta.rgb})`} testId={`${ids.category}-${slug(k)}`}>
                {catLabel(k, lang)}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Buttons are one group so a narrow row (counter showing at 360px)
          wraps them together instead of stranding "Kaydet" on its own line. */}
      <div className={`flex flex-wrap items-center gap-2 ${framed ? `${pad} py-4` : "mt-4"}`}>
        <div className="mr-auto min-w-0 flex items-center gap-3 text-xs text-white/30">
          {hint && <span className="hidden sm:inline truncate">{hint}</span>}
          {length > CONTENT_MAX - 800 && (
            <span className={`whitespace-nowrap tabular-nums ${length >= CONTENT_MAX ? "text-amber-300/80" : "text-white/40"}`}>
              {length.toLocaleString(locale(lang))} / {CONTENT_MAX.toLocaleString(locale(lang))}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => onCancel("button")} disabled={saving} data-testid={ids.cancel} className={secondaryButtonClass}
            title={t("Vazgeç (Esc)", "Cancel (Esc)")}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="submit" disabled={!canSave} data-testid={ids.submit} className={primaryButtonClass}
            title={t(`Kaydet (${MOD_KEY} + Enter)`, `Save (${MOD_KEY} + Enter)`)}>
            {saving
              ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Check size={15} aria-hidden="true" />}
            {saving ? t("Kaydediliyor", "Saving") : t("Kaydet", "Save")}
          </button>
        </div>
      </div>
    </form>
  );
}

const EDIT_IDS = {
  form: "note-edit-form", title: "note-edit-title", content: "note-edit-input", category: "note-edit-category",
  cancel: "note-edit-cancel", submit: "note-edit-save",
};

function NoteEditor({ note, initial, restored, lang, t, categoryKeys, onSave, onCancel }) {
  const [values, setValues] = useState(() => initial || {
    title: String(note.title || "").trim(),
    content: note.content || "",
    category: catKey(note.category),
  });
  const keys = categoryKeys.includes(values.category) ? categoryKeys : [...categoryKeys, values.category];

  return (
    <NoteForm values={values} onChange={setValues} lang={lang} t={t} categoryKeys={keys} ids={EDIT_IDS}
      label={t("Notu düzenle", "Edit note")} focusField="content" focusIfLost={!!restored}
      onCancel={onCancel}
      onSubmit={() => onSave({ title: values.title.trim(), content: values.content.trim(), category: values.category })} />
  );
}

function NoteCard({ note, lang, t, editing, categoryKeys, highlighted, onEdit, onCancelEdit, onSave, onDelete, onCopy }) {
  const cardRef = useRef(null);
  const bodyRef = useRef(null);
  const wasEditing = useRef(!!editing);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [copied, setCopied] = useState(false);

  const title = String(note.title || "").trim();
  const content = note.content || "";
  const category = catKey(note.category);
  const important = category === "önemli";
  const stamp = note.updated_at || note.created_at;

  // Shows "Devamını göster" only when the 8-line clamp actually cuts text.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return undefined;
    const check = () => setClamped(el.scrollHeight - el.clientHeight > 1);
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, editing, content]);

  // Closing the editor unmounts the focused field; hand focus back to this
  // card's edit button unless the user already moved it somewhere else.
  useEffect(() => {
    if (wasEditing.current && !editing && focusIsLost()) {
      cardRef.current?.querySelector('[data-testid="note-edit-button"]')?.focus();
    }
    wasEditing.current = !!editing;
  }, [editing]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    if (await onCopy()) setCopied(true);
  };

  const startEdit = () => {
    setExpanded(false);
    onEdit();
  };

  const tone = editing
    ? "border-indigo-300/30 bg-white/[0.05] shadow-[0_0_0_4px_rgba(129,140,248,0.08)]"
    : important
      ? "border-amber-300/[0.16] bg-amber-200/[0.035] hover:border-amber-300/25 hover:bg-amber-200/[0.05]"
      : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.045]";

  const stampTitle = stamp
    ? `${t("Son düzenleme", "Last edited")}: ${formatDate(stamp, lang)} ${formatTime(stamp, lang)}`
    : undefined;

  return (
    <li ref={cardRef} data-testid="note-item" data-note-id={note.id} data-category={category}
      className={`group relative mb-3 break-inside-avoid rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-300 motion-reduce:transition-none ${tone} ${
        highlighted ? "ring-2 ring-indigo-300/45" : ""
      }`}>
      {editing ? (
        <NoteEditor note={note} initial={editing.values} restored={editing.restored} lang={lang} t={t}
          categoryKeys={categoryKeys} onSave={onSave} onCancel={onCancelEdit} />
      ) : (
        <>
          {title && <h3 className="text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{title}</h3>}
          <p ref={bodyRef}
            className={`whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed ${
              title ? "mt-1.5 text-[13.5px] text-white/65" : "text-[14px] text-white/85"
            } ${expanded ? "" : "line-clamp-[8]"}`}>
            {content}
          </p>
          {clamped && (
            <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid="note-expand"
              className="mt-1 -ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs font-semibold text-indigo-200/75 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
              {expanded ? t("Daha az göster", "Show less") : t("Devamını göster", "Show more")}
              <ChevronDown size={14} aria-hidden="true"
                className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}

          <div className="mt-3.5 flex items-center gap-2 min-w-0">
            <CategoryPill category={category} lang={lang} />
            {stamp && (
              <time dateTime={stamp} title={stampTitle} className="min-w-0 truncate text-xs text-white/35 tabular-nums">
                {relativeTime(stamp, lang)}
              </time>
            )}
            <div className="ml-auto -my-1.5 -mr-2 flex items-center shrink-0 transition-opacity duration-150 motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label={copied ? t("Kopyalandı", "Copied") : t("Notu kopyala", "Copy note")} onClick={copy} testId="note-copy-button">
                {copied ? <Check size={15} className="text-emerald-300" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              </IconButton>
              <IconButton label={t("Notu düzenle", "Edit note")} onClick={startEdit} testId="note-edit-button">
                <Pencil size={15} aria-hidden="true" />
              </IconButton>
              <IconButton label={t("Notu sil", "Delete note")} onClick={onDelete} testId="note-delete-button">
                <Trash2 size={15} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

// Loading placeholder shaped like the search bar, the chips and the
// two-column card grid.
function NotesSkeleton({ label }) {
  const cards = [[92, 85, 40], [80, 55], [95, 88, 90, 35], [75, 60]];
  const pulse = "rounded-full animate-pulse motion-reduce:animate-none";
  const bar = `${pulse} bg-white/[0.06]`;
  return (
    <div role="status" aria-label={label}>
      <div className="h-[42px] rounded-xl border border-white/[0.06] bg-white/[0.025]" />
      <div className="mt-3 mb-4 flex gap-1.5 overflow-hidden">
        {[52, 64, 72, 44, 56].map((w, i) => (
          <div key={i} className={`h-[30px] shrink-0 ${bar}`} style={{ width: w }} />
        ))}
      </div>
      <div className="columns-1 sm:columns-2 gap-3">
        {cards.map((lines, i) => (
          <div key={i} className="mb-3 break-inside-avoid rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
            <div className={`h-3.5 w-2/5 ${pulse} bg-white/[0.09]`} />
            <div className="mt-3 space-y-2">
              {lines.map((w, j) => <div key={j} className={`h-2.5 ${bar}`} style={{ width: `${w}%` }} />)}
            </div>
            <div className={`mt-4 h-5 w-16 ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NotesPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const [notes, setNotes] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  // Unfiltered note count; null until the first full (query-less) load.
  const [total, setTotal] = useState(null);
  const [status, setStatus] = useState("loading");
  const [fetching, setFetching] = useState(false);
  const [query, setQuery] = useState("");
  // searchQ drives the request (debounced); shownQ is what `notes` reflects.
  const [searchQ, setSearchQ] = useState("");
  const [shownQ, setShownQ] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  // { id, values?, restored? } — values/restored reopen a failed edit with
  // the user's text instead of losing it.
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const requestRef = useRef(0);
  const wasAdding = useRef(false);
  const viewRef = useRef(null);
  const [lockH, setLockH] = useState(0);

  const load = useCallback(async (q) => {
    const req = ++requestRef.current;
    setFetching(true);
    try {
      const data = await fetchNotes(q);
      if (req !== requestRef.current) return;
      const list = Array.isArray(data?.notes) ? data.notes : [];
      setNotes(list);
      if (Array.isArray(data?.categories) && data.categories.length) setCategories(data.categories);
      if (!q) setTotal(list.length);
      setStatus("ready");
    } catch {
      if (req !== requestRef.current) return;
      setStatus("error");
    } finally {
      if (req === requestRef.current) {
        setShownQ(q);
        setFetching(false);
      }
    }
  }, []);

  useEffect(() => {
    const q = query.trim().slice(0, SEARCH_MAX);
    if (q === searchQ) return undefined;
    const id = setTimeout(() => setSearchQ(q), 300);
    return () => clearTimeout(id);
  }, [query, searchQ]);

  useEffect(() => { load(searchQ); }, [load, searchQ]);

  useEffect(() => {
    if (!flashId) return undefined;
    const id = setTimeout(() => setFlashId(null), 1800);
    return () => clearTimeout(id);
  }, [flashId]);

  useEffect(() => {
    if (wasAdding.current && !adding && focusIsLost()) focusAddToggle();
    wasAdding.current = adding;
  }, [adding]);

  const baseKeys = useMemo(() => {
    const keys = [];
    (categories.length ? categories : DEFAULT_CATEGORIES).forEach((c) => {
      const k = catKey(c);
      if (!keys.includes(k)) keys.push(k);
    });
    return keys;
  }, [categories]);

  const chipKeys = useMemo(() => {
    const keys = [...baseKeys];
    notes.forEach((n) => {
      const k = catKey(n.category);
      if (!keys.includes(k)) keys.push(k);
    });
    return keys;
  }, [baseKeys, notes]);

  const counts = useMemo(() => {
    const map = {};
    notes.forEach((n) => {
      const k = catKey(n.category);
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }, [notes]);

  const cat = activeCat !== "all" && chipKeys.includes(activeCat) ? activeCat : "all";
  const visible = cat === "all" ? notes : notes.filter((n) => catKey(n.category) === cat);
  const typedQ = query.trim().slice(0, SEARCH_MAX);
  const busy = fetching || typedQ !== shownQ;
  const narrowed = !!(query || shownQ) || cat !== "all";

  // Narrowing the list would shrink the panel, and the centred card (or the
  // bottom sheet) would move the search box / chips out from under the
  // user's cursor. Hold the current visible height until the list is whole
  // again.
  const lockHeight = () => {
    const el = viewRef.current;
    const scroller = el?.closest(".overflow-y-auto");
    if (narrowed || !el || !scroller) return;
    const padding = parseFloat(window.getComputedStyle(scroller).paddingBottom) || 0;
    setLockH(Math.min(el.offsetHeight, scroller.clientHeight - padding));
  };

  const filterBy = (key) => {
    lockHeight();
    setActiveCat(key);
  };

  const clearSearch = () => {
    setQuery("");
    setSearchQ("");
  };

  const openComposer = (category) => {
    const preset = category || (cat !== "all" && baseKeys.includes(cat) ? cat : null);
    setDraft((d) => (d.title.trim() || d.content.trim() || !preset ? d : { ...d, category: preset }));
    setAdding(true);
  };

  // Escape and the header toggle keep the draft for this session; "Vazgeç"
  // throws it away.
  const closeComposer = (source) => {
    setAdding(false);
    if (source === "button") setDraft(EMPTY_DRAFT);
  };

  const handleCreate = async () => {
    const title = draft.title.trim();
    const content = draft.content.trim();
    const category = draft.category;
    if (!content || saving) return;
    setSaving(true);
    let saved;
    try {
      saved = await createNote({ title, content, category });
    } catch {
      setSaving(false);
      toast.error(t("Not eklenemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't add the note. Check your connection and try again."));
      return;
    }
    setSaving(false);
    setAdding(false);
    setDraft(EMPTY_DRAFT);
    toast.success(t("Not eklendi", "Note added"));

    const now = new Date().toISOString();
    const note = { title, content, category, created_at: now, updated_at: now, ...(saved && typeof saved === "object" ? saved : {}) };
    if (cat !== "all" && cat !== catKey(note.category)) setActiveCat("all");

    if (total === null) {
      // The first load had failed — fetch the whole list now.
      setStatus("loading");
      clearSearch();
      load("");
      return;
    }
    setTotal((c) => (c === null ? c : c + 1));
    if (note.id) {
      setNotes((ns) => [note, ...ns.filter((n) => n.id !== note.id)]);
      setFlashId(note.id);
    }
    // A search may hide the new note: clearing it reloads the full list.
    if (typedQ || searchQ) clearSearch();
    else if (!note.id) load("");
  };

  // A card is about to leave the list: once it's gone, put focus on its
  // neighbour (or the "+" button) unless the user already moved it.
  const refocusAfterRemoval = (id) => {
    const i = visible.findIndex((n) => n.id === id);
    const neighbor = i < 0 ? null : visible[i + 1] || visible[i - 1];
    requestAnimationFrame(() => {
      if (!focusIsLost()) return;
      if (!neighbor || !focusNoteControl(neighbor.id, "note-edit-button")) focusAddToggle();
    });
  };

  const handleSave = async (note, next) => {
    const original = {
      title: String(note.title || "").trim(),
      content: String(note.content || "").trim(),
      category: catKey(note.category),
    };
    const changes = {};
    if (next.title !== original.title) changes.title = next.title;
    if (next.content !== original.content) changes.content = next.content;
    if (next.category !== original.category) changes.category = next.category;
    setEditing(null);
    if (Object.keys(changes).length === 0) return;

    // Moved out of the category being viewed: the card leaves the list.
    if (changes.category && cat !== "all" && changes.category !== cat) refocusAfterRemoval(note.id);
    const updated = { ...note, ...changes, updated_at: new Date().toISOString() };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? updated : n)));
    try {
      const saved = await editNote(note.id, changes);
      if (saved?.id) setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, ...saved } : n)));
    } catch (e) {
      if (e?.response?.status === 404) {
        refocusAfterRemoval(note.id);
        setNotes((ns) => ns.filter((n) => n.id !== note.id));
        setTotal((c) => (c === null ? c : Math.max(0, c - 1)));
        toast.error(t("Bu not artık yok, listeden kaldırıldı.", "This note no longer exists, so it was removed from the list."));
        return;
      }
      setNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)));
      setEditing((cur) => cur || { id: note.id, values: next, restored: true });
      toast.error(t("Değişiklik kaydedilemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't save your changes. Check your connection and try again."));
    }
  };

  const confirmDelete = async () => {
    const note = pendingDelete;
    setPendingDelete(null);
    if (!note) return;
    const index = notes.findIndex((n) => n.id === note.id);
    if (editing?.id === note.id) setEditing(null);
    refocusAfterRemoval(note.id);
    setNotes((ns) => ns.filter((n) => n.id !== note.id));
    setTotal((c) => (c === null ? c : Math.max(0, c - 1)));
    try {
      await deleteNote(note.id);
      toast.success(t("Not silindi", "Note deleted"));
    } catch (e) {
      // 404: it was already gone — the list is now correct.
      if (e?.response?.status === 404) return;
      setNotes((ns) => {
        if (ns.some((n) => n.id === note.id)) return ns;
        const next = [...ns];
        next.splice(index < 0 ? 0 : Math.min(index, next.length), 0, note);
        return next;
      });
      setTotal((c) => (c === null ? c : c + 1));
      toast.error(t("Not silinemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't delete the note. Check your connection and try again."));
    }
  };

  const cancelDelete = () => {
    const id = pendingDelete?.id;
    setPendingDelete(null);
    requestAnimationFrame(() => {
      if (focusIsLost() && !focusNoteControl(id, "note-delete-button")) focusAddToggle();
    });
  };

  const copyNote = async (note) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(noteText(note));
      toast.success(t("Kopyalandı", "Copied"));
      return true;
    } catch {
      toast.error(t("Kopyalanamadı. Metni seçip elle kopyalayabilirsin.", "Couldn't copy. You can select the text and copy it yourself."));
      return false;
    }
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      clearSearch();
    }
  };

  const retry = () => {
    if (total === null) setStatus("loading");
    load(searchQ);
  };

  const subtitle = total
    ? t(`${total} not`, `${total} ${total === 1 ? "note" : "notes"}`)
    : t("Fikirlerin ve listelerin tek bir yerde", "Your ideas and lists in one place");

  const searchLabel = t("Notlarında ara", "Search your notes");
  const addButton = (category, testId) => (
    <button type="button" onClick={() => openComposer(category)} data-testid={testId} className={primaryButtonClass}>
      <Plus size={16} aria-hidden="true" /> {t("Not ekle", "Add a note")}
    </button>
  );
  // Hidden while the composer is open — it already is the next step.
  const firstNote = (compact) => (adding ? null : (
    <EmptyState compact={compact} icon={StickyNote} accent="indigo" title={t("İlk notunu yaz", "Write your first note")}
      body={t("Aklına gelen fikirleri, listeleri, önemli bilgileri burada topla.",
        "Collect your ideas, lists and important details here.")}
      action={addButton(null, "note-empty-add")} />
  ));

  let view;
  if (total === null) {
    view = status === "error" ? (
      <ErrorState title={t("Notlar yüklenemedi", "Couldn't load your notes")}
        body={t("İnternet bağlantını kontrol edip tekrar dene.", "Check your internet connection and try again.")}
        onRetry={retry} retryLabel={t("Tekrar dene", "Try again")} />
    ) : (
      <NotesSkeleton label={t("Notlar yükleniyor", "Loading notes")} />
    );
  } else if (total === 0 && !query && !shownQ) {
    view = firstNote(false);
  } else {
    const filtered = !!shownQ || cat !== "all";
    const catName = cat !== "all" ? catLabel(cat, lang) : "";
    let results;
    if (status === "error") {
      results = (
        <ErrorState
          title={shownQ ? t("Arama yapılamadı", "Couldn't search your notes") : t("Notlar yüklenemedi", "Couldn't load your notes")}
          body={t("İnternet bağlantını kontrol edip tekrar dene.", "Check your internet connection and try again.")}
          onRetry={retry} retryLabel={t("Tekrar dene", "Try again")} />
      );
    } else if (notes.length === 0 && shownQ) {
      results = (
        <EmptyState compact icon={SearchX} accent="indigo"
          title={t(`“${shownQ}” için not bulunamadı`, `No notes found for “${shownQ}”`)}
          body={t("Farklı bir kelimeyle dene.", "Try a different word.")}
          action={(
            <button type="button" onClick={clearSearch} data-testid="note-clear-search" className={secondaryButtonClass}>
              {t("Aramayı temizle", "Clear search")}
            </button>
          )} />
      );
    } else if (visible.length === 0 && cat !== "all") {
      const CatIcon = catMeta(cat).icon;
      results = (
        <EmptyState compact icon={CatIcon} accent="indigo"
          title={shownQ
            ? t(`“${shownQ}” için ${catName} kategorisinde not yok`, `No ${catName} notes for “${shownQ}”`)
            : t(`${catName} kategorisinde not yok`, `No notes in ${catName}`)}
          body={shownQ
            ? t("Diğer kategorilerde sonuç var.", "There are results in other categories.")
            : t("Yeni bir not eklerken bu kategoriyi seçebilirsin.", "You can pick this category when you add a note.")}
          action={(
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => filterBy("all")} data-testid="note-clear-filter" className={secondaryButtonClass}>
                {shownQ ? t("Tüm sonuçları göster", "Show all results") : t("Tüm notları göster", "Show all notes")}
              </button>
              {!shownQ && !adding && addButton(cat, "note-filter-add")}
            </div>
          )} />
      );
    } else if (notes.length === 0) {
      results = firstNote(true);
    } else {
      results = (
        <ul aria-label={t("Notlar", "Notes")} aria-busy={busy} data-testid="note-list"
          className={`columns-1 sm:columns-2 gap-3 transition-opacity duration-200 motion-reduce:transition-none ${busy ? "opacity-60" : ""}`}>
          {visible.map((n) => (
            <NoteCard key={n.id} note={n} lang={lang} t={t} categoryKeys={baseKeys}
              editing={editing?.id === n.id ? editing : null}
              highlighted={flashId === n.id}
              onEdit={() => setEditing({ id: n.id })}
              onCancelEdit={() => setEditing(null)}
              onSave={(next) => handleSave(n, next)}
              onDelete={() => setPendingDelete(n)}
              onCopy={() => copyNote(n)} />
          ))}
        </ul>
      );
    }

    const resultCount = visible.length;
    const resultText = shownQ
      ? t(`“${shownQ}” için ${resultCount} not`, `${resultCount} ${resultCount === 1 ? "note" : "notes"} for “${shownQ}”`)
      : t(`${resultCount} not`, `${resultCount} ${resultCount === 1 ? "note" : "notes"}`);

    view = (
      <div ref={viewRef} style={narrowed && lockH ? { minHeight: lockH } : undefined}>
        <div className="mb-4 space-y-3">
          <div className="relative">
            {busy
              ? <Loader2 size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -mt-2 text-indigo-200/60 animate-spin motion-reduce:animate-none" />
              : <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />}
            <input type="search" value={query} onChange={(e) => { if (e.target.value) lockHeight(); setQuery(e.target.value); }} onKeyDown={onSearchKeyDown}
              placeholder={searchLabel} aria-label={searchLabel} enterKeyHint="search" autoComplete="off" spellCheck={false}
              maxLength={SEARCH_MAX} data-testid="note-search"
              className={`${fieldClass} pl-10 pr-10 max-sm:text-base [&::-webkit-search-cancel-button]:hidden`} />
            {query && (
              <button type="button" onClick={clearSearch} aria-label={t("Aramayı temizle", "Clear search")} title={t("Aramayı temizle", "Clear search")}
                data-testid="note-search-clear"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          {notes.length > 0 && status !== "error" && (
            <ChipRail label={t("Kategoriler", "Categories")}>
              <Chip active={cat === "all"} onClick={() => filterBy("all")} count={notes.length} testId="note-filter-all">
                {t("Tümü", "All")}
              </Chip>
              {chipKeys.map((k) => {
                const meta = catMeta(k);
                return (
                  <Chip key={k} active={cat === k} onClick={() => filterBy(cat === k ? "all" : k)}
                    icon={meta.icon} color={`rgb(${meta.rgb})`} count={counts[k] || 0} testId={`note-filter-${slug(k)}`}>
                    {catLabel(k, lang)}
                  </Chip>
                );
              })}
            </ChipRail>
          )}
        </div>

        <p aria-live="polite" className={shownQ && resultCount > 0 && status !== "error" ? "mb-3 text-xs text-white/45 tabular-nums" : "sr-only"}>
          {filtered && status !== "error" ? resultText : ""}
        </p>

        {results}
      </div>
    );
  }

  return (
    <Panel onClose={onClose} size="xl" accent="indigo" labelledBy={titleId} testId="notes-panel">
      <PanelHeader icon={StickyNote} accent="indigo" title={t("Notlarım", "My notes")} subtitle={subtitle}
        titleId={titleId} onClose={onClose} closeLabel={t("Kapat", "Close")}
        actions={(
          <IconButton variant="primary" size={40} testId="note-add-toggle"
            onClick={() => (adding ? closeComposer("toggle") : openComposer())}
            label={adding ? t("Not formunu kapat", "Close the note form") : t("Not ekle", "Add a note")}>
            <Plus size={18} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${adding ? "rotate-45" : ""}`} />
          </IconButton>
        )} />
      <PanelBody>
        {adding && (
          <NoteForm framed values={draft} onChange={setDraft} saving={saving} lang={lang} t={t}
            categoryKeys={baseKeys} focusField={draft.content.trim() ? "content" : "title"}
            label={t("Yeni not", "New note")}
            hint={t(`Esc ile kapat · ${MOD_KEY} + Enter ile kaydet`, `Esc to close · ${MOD_KEY} + Enter to save`)}
            ids={{
              form: "note-add-form", title: "note-title-input", content: "note-input", category: "note-category-select",
              cancel: "note-add-cancel", submit: "note-add-button",
            }}
            onSubmit={handleCreate} onCancel={closeComposer} />
        )}
        {view}
      </PanelBody>

      <ConfirmDialog open={!!pendingDelete} danger
        title={t("Bu not silinsin mi?", "Delete this note?")}
        body={pendingDelete && (
          <>
            <span className="mb-2.5 line-clamp-4 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-white/80 whitespace-pre-line [overflow-wrap:anywhere]">
              {excerpt(noteText(pendingDelete))}
            </span>
            {t("Bu işlem geri alınamaz.", "This can't be undone.")}
          </>
        )}
        confirmLabel={t("Sil", "Delete")} cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={confirmDelete} onCancel={cancelDelete} />
    </Panel>
  );
}
