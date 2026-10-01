import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Heart, Plus, Search, SearchX, X, Pencil, Trash2, Check, Loader2,
  User, Briefcase, Target, Sparkles, CalendarDays, SlidersHorizontal, HeartHandshake, Users, FolderKanban, Flag, Repeat, Shapes,
} from "lucide-react";
import { toast } from "sonner";
import { fetchMemories, addMemory, editMemory, deleteMemory } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Panel, PanelHeader, PanelBody, IconButton, Chip, ChipRail, EmptyState, SkeletonList, ErrorState,
  usePanelTitleId, fieldClass, primaryButtonClass, secondaryButtonClass,
} from "@/components/panel/Panel";
import { relativeTime, formatDate, formatTime } from "@/lib/dates";

// One canonical group per category. The extractor writes singular keys
// ("proje", "önemli_tarih"), manual entries use the plural list the backend
// returns ("projeler", "önemli_tarihler") and rows without a category fall
// back to the engine's type ("person", "long_term"). Labels, filters and
// counts therefore always go through groupOf(), never the raw key.
const GROUPS = {
  "kişisel": { tr: "Kişisel", en: "Personal", icon: User, rgb: "196,181,253" },
  "iş": { tr: "İş", en: "Work", icon: Briefcase, rgb: "125,211,252" },
  "hedefler": { tr: "Hedefler", en: "Goals", icon: Target, rgb: "110,231,183" },
  "ilgi_alanları": { tr: "İlgi alanları", en: "Interests", icon: Sparkles, rgb: "252,211,77" },
  "önemli_tarihler": { tr: "Önemli tarihler", en: "Important dates", icon: CalendarDays, rgb: "253,164,175" },
  "tercihler": { tr: "Tercihler", en: "Preferences", icon: SlidersHorizontal, rgb: "165,180,252" },
  "ilişkiler": { tr: "İlişkiler", en: "Relationships", icon: HeartHandshake, rgb: "249,168,212" },
  "kişiler": { tr: "Kişiler", en: "People", icon: Users, rgb: "94,234,212" },
  "projeler": { tr: "Projeler", en: "Projects", icon: FolderKanban, rgb: "253,186,116" },
  "olaylar": { tr: "Olaylar", en: "Events", icon: Flag, rgb: "240,171,252" },
  "alışkanlıklar": { tr: "Alışkanlıklar", en: "Habits", icon: Repeat, rgb: "190,242,100" },
  "diğer": { tr: "Diğer", en: "Other", icon: Shapes, rgb: "203,213,225" },
};
const GROUP_ORDER = Object.keys(GROUPS);

// Used until the backend's own list arrives (and if it ever comes back empty).
const DEFAULT_CATEGORIES = ["kişisel", "iş", "hedefler", "ilgi_alanları", "önemli_tarihler", "tercihler", "ilişkiler", "projeler", "diğer"];

const ALIASES = (() => {
  const map = {};
  const add = (group, keys) => keys.forEach((k) => { map[k] = group; });
  add("kişisel", ["kişisel", "kisisel", "personal", "user_profile", "profile"]);
  add("iş", ["iş", "is", "work", "job", "career", "kariyer"]);
  add("hedefler", ["hedef", "hedefler", "goal", "goals"]);
  add("ilgi_alanları", ["ilgi_alanı", "ilgi_alanları", "ilgi_alani", "ilgi_alanlari", "ilgi", "hobi", "hobiler", "interest", "interests", "hobby", "hobbies"]);
  add("önemli_tarihler", ["önemli_tarih", "önemli_tarihler", "onemli_tarih", "onemli_tarihler", "important_date", "important_dates", "date", "dates"]);
  add("tercihler", ["tercih", "tercihler", "preference", "preferences"]);
  add("ilişkiler", ["ilişki", "ilişkiler", "iliski", "iliskiler", "relationship", "relationships"]);
  add("kişiler", ["kişi", "kişiler", "kisi", "kisiler", "person", "people"]);
  add("projeler", ["proje", "projeler", "project", "projects"]);
  add("olaylar", ["olay", "olaylar", "event", "events"]);
  add("alışkanlıklar", ["alışkanlık", "alışkanlıklar", "aliskanlik", "aliskanliklar", "habit", "habits"]);
  return map;
})();

function groupOf(raw) {
  const key = String(raw || "").normalize("NFC").trim().replace(/[\s-]+/g, "_");
  // Turkish lowering first ("İş" -> "iş"); plain lowering for English keys,
  // where the Turkish rules would turn "I" into a dotless "ı".
  return ALIASES[key.toLocaleLowerCase("tr")] || ALIASES[key.toLowerCase()] || "diğer";
}

const groupLabel = (group, lang) => {
  const g = GROUPS[group] || GROUPS["diğer"];
  return lang === "tr" ? g.tr : g.en;
};

// Category chooser options: one per group, in canonical order. `currentRaw`
// keeps an extractor-only group (e.g. "kişi") selectable while editing.
function pickerOptions(categories, currentRaw) {
  const byGroup = new Map();
  for (const key of categories) {
    const group = groupOf(key);
    if (!byGroup.has(group)) byGroup.set(group, key);
  }
  if (currentRaw !== undefined) {
    const group = groupOf(currentRaw);
    if (!byGroup.has(group)) byGroup.set(group, currentRaw);
  }
  return [...byGroup]
    .map(([group, key]) => ({ group, key }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

// Case- and accent-insensitive search text: "kisi" finds "Kişi", "İzmir"
// finds "izmir".
function fold(s) {
  return String(s || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

// The backend stores "Not" as the title of a manual entry saved without one;
// that placeholder (or a title that just repeats the content) isn't shown.
const PLACEHOLDER_TITLES = new Set(["not", "note"]);
function displayTitle(m) {
  const title = (m.title || "").trim();
  if (!title || PLACEHOLDER_TITLES.has(title.toLocaleLowerCase("tr"))) return "";
  if (title === (m.content || "").trim()) return "";
  return title;
}

function timeOf(m) {
  const v = Date.parse(m.created_at || "");
  return Number.isNaN(v) ? 0 : v;
}

// Cuts by code point so an emoji at the boundary isn't split in half.
function excerpt(text, max = 140) {
  const chars = Array.from(String(text || "").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";

const labelClass = "block mb-1.5 text-xs font-medium text-white/55";
const textareaClass = `${fieldClass} resize-none min-h-[88px] max-h-64 leading-relaxed [field-sizing:content]`;

function CategoryPill({ group, lang }) {
  const g = GROUPS[group] || GROUPS["diğer"];
  const Icon = g.icon;
  return (
    <span className="inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5"
      style={{ color: `rgb(${g.rgb})`, backgroundColor: `rgba(${g.rgb},0.1)`, boxShadow: `inset 0 0 0 1px rgba(${g.rgb},0.16)` }}>
      <Icon size={12} aria-hidden="true" />
      {groupLabel(group, lang)}
    </span>
  );
}

function CategoryPicker({ options, value, onChange, lang, label, testId }) {
  const current = groupOf(value);
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const g = GROUPS[o.group];
        return (
          <Chip key={o.group} active={o.group === current} onClick={() => onChange(o.key)}
            icon={g.icon} color={`rgb(${g.rgb})`} testId={`${testId}-${o.group}`}>
            {groupLabel(o.group, lang)}
          </Chip>
        );
      })}
    </div>
  );
}

function ShortcutHint({ t }) {
  return (
    <span className="hidden sm:inline mr-auto text-xs text-white/30">
      {t(`Esc ile vazgeç · ${MOD_KEY} + Enter ile kaydet`, `Esc to cancel · ${MOD_KEY} + Enter to save`)}
    </span>
  );
}

function AddMemoryForm({ lang, t, options, initialCategory, onSubmit, onCancel }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);
  const titleFieldId = useId();
  const contentFieldId = useId();

  useEffect(() => { titleRef.current?.focus(); }, []);

  const canSave = content.trim().length > 0 && !saving;

  const submit = async (e) => {
    e?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const ok = await onSubmit({ title: title.trim(), content: content.trim(), category });
    if (!ok) setSaving(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!saving) onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} aria-label={t("Yeni anı", "New memory")} data-testid="memory-add-form"
      className="mb-5 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 sm:p-5 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <div className="space-y-4">
        <div>
          <label htmlFor={titleFieldId} className={labelClass}>
            {t("Başlık", "Title")} <span className="font-normal text-white/30">· {t("isteğe bağlı", "optional")}</span>
          </label>
          <input id={titleFieldId} ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
            placeholder={t("Kısa bir başlık", "A short title")} autoComplete="off" data-testid="memory-new-title" className={fieldClass} />
        </div>
        <div>
          <label htmlFor={contentFieldId} className={labelClass}>{t("Luna neyi hatırlasın?", "What should Luna remember?")}</label>
          <textarea id={contentFieldId} value={content} onChange={(e) => setContent(e.target.value)} rows={3} maxLength={4000}
            placeholder={t("Örneğin: Kahvemi sütlü ve şekersiz içerim.", "For example: I take my coffee with milk and no sugar.")}
            data-testid="memory-new-content" className={textareaClass} />
        </div>
        <div>
          <p className={labelClass}>{t("Kategori", "Category")}</p>
          <CategoryPicker options={options} value={category} onChange={setCategory} lang={lang}
            label={t("Kategori", "Category")} testId="memory-new-category" />
        </div>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <ShortcutHint t={t} />
        <button type="button" onClick={onCancel} disabled={saving} data-testid="memory-add-cancel" className={secondaryButtonClass}>
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="submit" disabled={!canSave} data-testid="memory-save-button" className={primaryButtonClass}>
          {saving && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {saving ? t("Kaydediliyor", "Saving") : t("Kaydet", "Save")}
        </button>
      </div>
    </form>
  );
}

// `draft` reopens the editor with what the user typed when a save failed.
function MemoryEditor({ item, draft, lang, t, categories, onSave, onCancel }) {
  const { m } = item;
  const [title, setTitle] = useState(draft ? draft.title : item.title);
  const [content, setContent] = useState(draft ? draft.content : m.content || "");
  const [category, setCategory] = useState(draft ? draft.category : m.category);
  const contentRef = useRef(null);
  const reopenedRef = useRef(Boolean(draft));
  const titleFieldId = useId();
  const contentFieldId = useId();
  const options = useMemo(() => pickerOptions(categories, m.category), [categories, m.category]);

  // Start in the content with the caret at the end, ready to type. A
  // reopened draft arrives later, so it doesn't pull focus from a field the
  // user has moved on to.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const active = document.activeElement;
    if (reopenedRef.current && active && active !== document.body && active.getAttribute("role") !== "dialog") return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSave = content.trim().length > 0;

  const save = (e) => {
    e?.preventDefault();
    if (!canSave) return;
    onSave({ title: title.trim(), content: content.trim(), category });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <form onSubmit={save} onKeyDown={onKeyDown} aria-label={t("Anıyı düzenle", "Edit memory")} data-testid="memory-edit-form" className="space-y-4">
      <div>
        <label htmlFor={titleFieldId} className={labelClass}>
          {t("Başlık", "Title")} <span className="font-normal text-white/30">· {t("isteğe bağlı", "optional")}</span>
        </label>
        <input id={titleFieldId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
          placeholder={t("Kısa bir başlık", "A short title")} autoComplete="off" data-testid="memory-edit-title" className={fieldClass} />
      </div>
      <div>
        <label htmlFor={contentFieldId} className={labelClass}>{t("İçerik", "Content")}</label>
        <textarea id={contentFieldId} ref={contentRef} value={content} onChange={(e) => setContent(e.target.value)} rows={3} maxLength={4000}
          data-testid="memory-edit-textarea" className={textareaClass} />
      </div>
      <div>
        <p className={labelClass}>{t("Kategori", "Category")}</p>
        <CategoryPicker options={options} value={category} onChange={setCategory} lang={lang}
          label={t("Kategori", "Category")} testId="memory-edit-category" />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <ShortcutHint t={t} />
        <button type="button" onClick={onCancel} data-testid="memory-edit-cancel" className={secondaryButtonClass}>
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="submit" disabled={!canSave} data-testid="memory-edit-save" className={primaryButtonClass}>
          <Check size={15} aria-hidden="true" /> {t("Kaydet", "Save")}
        </button>
      </div>
    </form>
  );
}

function MemoryCard({ item, draft, lang, t, editing, categories, onEdit, onCancelEdit, onSave, onDelete }) {
  const { m, group, title } = item;
  const cardRef = useRef(null);
  const wasEditing = useRef(editing);

  // Closing the editor unmounts the focused field; hand focus back to this
  // card's edit button unless the user already moved it somewhere else.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        cardRef.current?.querySelector('[data-testid="memory-edit-button"]')?.focus();
      }
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <li ref={cardRef} data-testid="memory-item" data-category={group}
      className={`group rounded-2xl border p-4 transition-colors ${
        editing
          ? "border-rose-300/25 bg-white/[0.045]"
          : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.11] hover:bg-white/[0.04]"
      }`}>
      {editing ? (
        <MemoryEditor item={item} draft={draft} lang={lang} t={t} categories={categories} onSave={onSave} onCancel={onCancelEdit} />
      ) : (
        <>
          {title && <p className="text-sm font-semibold leading-snug text-white break-words">{title}</p>}
          <p className={`text-[13.5px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] ${title ? "mt-1 text-white/65" : "text-white/85"}`}>
            {m.content}
          </p>
          <div className="mt-3 flex items-center gap-2.5 min-w-0">
            <CategoryPill group={group} lang={lang} />
            {m.created_at && (
              <time dateTime={m.created_at} title={`${formatDate(m.created_at, lang)} ${formatTime(m.created_at, lang)}`}
                className="min-w-0 truncate text-xs text-white/35 tabular-nums">
                {relativeTime(m.created_at, lang)}
              </time>
            )}
            <div className="ml-auto -my-1.5 -mr-2 flex items-center gap-0.5 shrink-0 transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label={t("Anıyı düzenle", "Edit memory")} onClick={onEdit} testId="memory-edit-button">
                <Pencil size={15} />
              </IconButton>
              <IconButton label={t("Anıyı sil", "Delete memory")} onClick={onDelete} testId="memory-delete-button">
                <Trash2 size={15} />
              </IconButton>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

export default function MemoryPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const [memories, setMemories] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [status, setStatus] = useState("loading");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const editingRef = useRef(null);
  editingRef.current = editingId;
  const [pendingDelete, setPendingDelete] = useState(null);
  const requestRef = useRef(0);
  const mutationRef = useRef(0);
  const deleteOriginRef = useRef(null);
  const addToggleRef = useRef(null);

  // Resolves to false when the request failed. A silent load (refresh after
  // adding) keeps the current list on screen instead of the skeleton.
  const load = useCallback(async ({ silent = false } = {}) => {
    const req = ++requestRef.current;
    const mutationAtStart = mutationRef.current;
    if (!silent) setStatus("loading");
    try {
      const data = await fetchMemories();
      if (req !== requestRef.current) return true;
      // An edit or delete made while this request was in flight is newer
      // than the server's answer; keep the local list rather than undo it.
      if (mutationAtStart === mutationRef.current) {
        setMemories(Array.isArray(data?.memories) ? data.memories : []);
      }
      if (Array.isArray(data?.categories) && data.categories.length) setCategories(data.categories);
      setStatus("ready");
      return true;
    } catch {
      if (req !== requestRef.current) return true;
      // A silent refresh can replace the first load (adding while the
      // skeleton is up); don't leave the skeleton spinning forever.
      setStatus((s) => (!silent || s === "loading" ? "error" : s));
      return false;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Closing the add form unmounts the focused field; hand focus back to the
  // toggle so keyboard users don't land on <body>.
  const wasAdding = useRef(adding);
  useEffect(() => {
    if (wasAdding.current && !adding) {
      const active = document.activeElement;
      if (!active || active === document.body) addToggleRef.current?.querySelector("button")?.focus();
    }
    wasAdding.current = adding;
  }, [adding]);

  const items = useMemo(() => memories
    .map((m) => {
      const title = displayTitle(m);
      return { m, title, group: groupOf(m.category), hay: fold(`${title}\n${m.content || ""}`), ts: timeOf(m) };
    })
    .sort((a, b) => b.ts - a.ts), [memories]);

  const groups = useMemo(() => {
    const counts = new Map();
    for (const it of items) counts.set(it.group, (counts.get(it.group) || 0) + 1);
    return [...counts]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key));
  }, [items]);

  const addOptions = useMemo(() => pickerOptions(categories), [categories]);

  // A filter whose last memory was deleted falls back to "all".
  const cat = activeCat !== "all" && groups.some((g) => g.key === activeCat) ? activeCat : "all";
  const needle = fold(query.trim());
  const filtered = needle !== "" || cat !== "all";
  const visible = items.filter((it) => (cat === "all" || it.group === cat) && (!needle || it.hay.includes(needle)));

  const initialCategory = (addOptions.find((o) => o.group === cat) || addOptions.find((o) => o.group === "diğer") || addOptions[0] || { key: "diğer" }).key;

  const clearFilters = () => { setQuery(""); setActiveCat("all"); };

  const handleAdd = async ({ title, content, category }) => {
    let res;
    try {
      res = await addMemory({ title, content, category, tags: [] });
    } catch {
      toast.error(t("Anı eklenemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't add the memory. Check your connection and try again."));
      return false;
    }
    // Show it right away; the refresh below swaps in the server's copy.
    if (res?.id) {
      setMemories((ms) => [{ id: res.id, title, content, category, tags: [], created_at: new Date().toISOString() }, ...ms]);
    }
    setAdding(false);
    clearFilters();
    toast.success(t("Anı eklendi", "Memory added"));
    const ok = await load({ silent: true });
    if (!ok && !res?.id) {
      toast.error(t("Liste yenilenemedi. Paneli kapatıp yeniden açmayı dene.", "Couldn't refresh the list. Try closing and reopening the panel."));
    }
    return true;
  };

  const startEdit = (id) => { setEditDraft(null); setEditingId(id); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };

  const handleSave = async (item, next) => {
    const { m } = item;
    cancelEdit();
    const changes = {};
    if (next.content !== (m.content || "").trim()) changes.content = next.content;
    // A hidden title (placeholder or a copy of the old content) is cleared
    // when the content changes, so it doesn't suddenly appear above it.
    if (next.title !== item.title || (changes.content !== undefined && !next.title && (m.title || "").trim())) {
      changes.title = next.title;
    }
    if (groupOf(next.category) !== item.group) changes.category = next.category;
    if (Object.keys(changes).length === 0) return;

    mutationRef.current += 1;
    setMemories((ms) => ms.map((x) => (x.id === m.id ? { ...x, ...changes } : x)));
    try {
      await editMemory(m.id, changes);
    } catch (e) {
      if (e?.response?.status === 404) {
        setMemories((ms) => ms.filter((x) => x.id !== m.id));
        toast.error(t("Bu anı artık yok, listeden kaldırıldı.", "This memory no longer exists, so it was removed from the list."));
        return;
      }
      // Undo only the fields that still hold this save's values, so a newer
      // edit of the same memory isn't rolled back with it.
      setMemories((ms) => ms.map((x) => {
        if (x.id !== m.id) return x;
        const back = { ...x };
        for (const k of Object.keys(changes)) if (x[k] === changes[k]) back[k] = m[k];
        return back;
      }));
      // Reopen the editor with what was typed so nothing has to be retyped
      // (unless another memory is being edited by now).
      if (editingRef.current === null) {
        setEditDraft({ id: m.id, ...next });
        setEditingId(m.id);
      }
      toast.error(t("Değişiklik kaydedilemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't save your changes. Check your connection and try again."));
    }
  };

  const askDelete = (m) => {
    deleteOriginRef.current = document.activeElement;
    setPendingDelete(m);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    const origin = deleteOriginRef.current;
    if (origin?.isConnected) origin.focus();
  };

  const confirmDelete = async () => {
    const m = pendingDelete;
    setPendingDelete(null);
    if (!m) return;
    // The card (and the button that opened the dialog) is about to go; park
    // focus on the panel itself rather than losing it to <body>.
    deleteOriginRef.current?.closest?.('[role="dialog"]')?.focus({ preventScroll: true });
    if (editingId === m.id) cancelEdit();
    mutationRef.current += 1;
    setMemories((ms) => ms.filter((x) => x.id !== m.id));
    try {
      await deleteMemory(null, m.id);
      toast.success(t("Anı silindi", "Memory deleted"));
    } catch (e) {
      // 404: it was already gone — the list is now correct.
      if (e?.response?.status === 404) return;
      setMemories((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      toast.error(t("Anı silinemedi. Bağlantını kontrol edip tekrar dene.", "Couldn't delete the memory. Check your connection and try again."));
    }
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  const count = memories.length;
  const subtitle = status === "ready" && count > 0
    ? t(`Luna'nın senin hakkında hatırladığı ${count} şey`, `${count} ${count === 1 ? "thing" : "things"} Luna remembers about you`)
    : t("Luna'nın senin hakkında hatırladıkları", "What Luna remembers about you");

  const searchLabel = t("Anılarında ara", "Search your memories");

  let view;
  if (status === "loading") {
    view = <SkeletonList rows={4} label={t("Anılar yükleniyor", "Loading memories")} />;
  } else if (status === "error") {
    view = (
      <ErrorState title={t("Anılar yüklenemedi", "Couldn't load your memories")}
        body={t("İnternet bağlantını kontrol edip tekrar dene.", "Check your internet connection and try again.")}
        onRetry={() => load()} retryLabel={t("Tekrar dene", "Try again")} />
    );
  } else if (count === 0) {
    view = adding ? null : (
      <EmptyState icon={Heart} accent="rose" title={t("Henüz bir anı yok", "No memories yet")}
        body={t("Sohbet ettikçe Luna önemli şeyleri hatırlar. İstersen kendin de ekleyebilirsin.",
          "As you chat, Luna remembers what matters. You can also add things yourself.")}
        action={(
          <button type="button" onClick={() => setAdding(true)} data-testid="memory-empty-add" className={primaryButtonClass}>
            <Plus size={16} aria-hidden="true" /> {t("Anı ekle", "Add a memory")}
          </button>
        )} />
    );
  } else {
    view = (
      <>
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKeyDown}
              placeholder={searchLabel} aria-label={searchLabel} enterKeyHint="search" autoComplete="off" spellCheck={false}
              data-testid="memory-search" className={`${fieldClass} pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden`} />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={t("Aramayı temizle", "Clear search")} title={t("Aramayı temizle", "Clear search")}
                data-testid="memory-search-clear"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <ChipRail label={t("Kategoriler", "Categories")}>
            <Chip active={cat === "all"} onClick={() => setActiveCat("all")} count={count} testId="memory-cat-all">
              {t("Tümü", "All")}
            </Chip>
            {groups.map((g) => {
              const meta = GROUPS[g.key];
              return (
                <Chip key={g.key} active={cat === g.key} onClick={() => setActiveCat(cat === g.key ? "all" : g.key)}
                  icon={meta.icon} color={`rgb(${meta.rgb})`} count={g.count} testId={`memory-cat-${g.key}`}>
                  {groupLabel(g.key, lang)}
                </Chip>
              );
            })}
          </ChipRail>
        </div>

        <p className="sr-only" aria-live="polite">
          {filtered ? t(`${visible.length} sonuç`, `${visible.length} ${visible.length === 1 ? "result" : "results"}`) : ""}
        </p>

        {visible.length === 0 ? (
          <EmptyState compact icon={SearchX} accent="rose" title={t("Eşleşen anı yok", "No matching memories")}
            body={t("Başka bir kelime dene ya da filtreyi temizle.", "Try another word or clear the filter.")}
            action={(
              <button type="button" onClick={clearFilters} data-testid="memory-clear-filters" className={secondaryButtonClass}>
                {t("Filtreyi temizle", "Clear filter")}
              </button>
            )} />
        ) : (
          <ul className="space-y-2.5" aria-label={t("Anılar", "Memories")} data-testid="memory-list">
            {visible.map((it) => (
              <MemoryCard key={it.m.id} item={it} lang={lang} t={t} categories={categories}
                editing={editingId === it.m.id}
                draft={editDraft?.id === it.m.id ? editDraft : null}
                onEdit={() => startEdit(it.m.id)}
                onCancelEdit={cancelEdit}
                onSave={(next) => handleSave(it, next)}
                onDelete={() => askDelete(it.m)} />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <Panel onClose={onClose} size="xl" accent="rose" labelledBy={titleId} testId="memories-modal">
      <PanelHeader icon={Heart} accent="rose" title={t("Anılarım", "My memories")} subtitle={subtitle}
        titleId={titleId} onClose={onClose} closeLabel={t("Kapat", "Close")}
        actions={(
          // The label already flips between "add" and "close", so no
          // aria-pressed on top of it (a toggle's name shouldn't change).
          <span ref={addToggleRef} className="contents">
            <IconButton variant="primary" size={40} onClick={() => setAdding((a) => !a)} testId="memory-add-toggle"
              label={adding ? t("Ekleme formunu kapat", "Close the add form") : t("Anı ekle", "Add a memory")}>
              <Plus size={18} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${adding ? "rotate-45" : ""}`} />
            </IconButton>
          </span>
        )} />
      <PanelBody>
        {adding && (
          <AddMemoryForm lang={lang} t={t} options={addOptions} initialCategory={initialCategory}
            onSubmit={handleAdd} onCancel={() => setAdding(false)} />
        )}
        {view}
      </PanelBody>

      <ConfirmDialog open={!!pendingDelete} danger
        title={t("Bu anı silinsin mi?", "Delete this memory?")}
        body={pendingDelete && (
          <>
            <span className="mb-2.5 block rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-white/80 [overflow-wrap:anywhere]">
              {excerpt(pendingDelete.content || pendingDelete.title)}
            </span>
            {t("Luna bunu artık hatırlamayacak. Bu işlem geri alınamaz.", "Luna won't remember this anymore. This can't be undone.")}
          </>
        )}
        confirmLabel={t("Sil", "Delete")} cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={confirmDelete} onCancel={cancelDelete} />
    </Panel>
  );
}
