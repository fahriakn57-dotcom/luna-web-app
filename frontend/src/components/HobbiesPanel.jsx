import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, CornerDownLeft, LayoutGrid, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { fetchProfile, updateProfile } from "@/lib/api";
import { Panel, PanelHeader, PanelBody, IconButton, Chip, ChipRail, SectionLabel, ErrorState, usePanelTitleId } from "@/components/panel/Panel";
import { GlyphTile, GlowIcon } from "@/components/icons/GlyphTile";
import { LunaIcon } from "@/components/icons/LunaIcon";
import {
  CATALOG, CATALOG_BY_CATEGORY, CATEGORIES, CATEGORY_BY_KEY, DEFAULT_HUE, MARKS, hobbyVisual, matchRange, searchCatalog,
} from "@/components/hobbies/hobbyCatalog";

const MAX_HOBBIES = 50;
const MAX_LENGTH = 40;
const MAX_MATCHES = 6;
const UNDO_TOAST_ID = "hobby-removed";

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const cleanHobby = (value) => squash(value).slice(0, MAX_LENGTH).trim();

// Identity for de-duplication: Turkish lowercasing ("İ" -> "i"), accents
// dropped and ı/i treated alike, so "KİTAP OKUMAK", "muzik" typed without a
// Turkish keyboard and "Ice skating" (-> "ıce") all match their counterparts.
const hobbyKey = (value) =>
  squash(value).toLocaleLowerCase("tr-TR").normalize("NFD").replace(MARKS, "").replace(/ı/g, "i");

// Saves can outlive the panel. If it is closed and reopened while one is
// still in flight, loading waits for it; otherwise the reopened panel could
// read the older list and save it back over the newer one on its next change.
let pendingSave = Promise.resolve();

function sanitizeList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = squash(entry);
    const key = hobbyKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Hobby and category icons are Celestial glyphs: each glows in its
// category's hue (GlyphTile on a glass tile, GlowIcon bare). Chip draws its
// `icon` prop as a component, so every category gets one stable component
// that renders its glyph in that light at chip size.
function chipGlyph(icon, hue) {
  const ChipGlyph = () => <GlowIcon icon={icon} hue={hue} size={14} />;
  return ChipGlyph;
}
const ALL_CHIP_GLYPH = chipGlyph(LayoutGrid, DEFAULT_HUE);
const CHIP_GLYPHS = Object.fromEntries(CATEGORIES.map((c) => [c.key, chipGlyph(c.icon, c.hue)]));

function Highlighted({ text, query }) {
  const range = matchRange(text, query);
  if (!range) return text;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="bg-transparent font-semibold text-white">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

function HobbiesSkeleton({ label }) {
  const pulse = "animate-pulse motion-reduce:animate-none";
  return (
    <div role="status" aria-label={label} data-testid="hobbies-loading">
      <div className={`h-[52px] rounded-2xl border border-white/[0.06] bg-white/[0.04] ${pulse}`} />
      <div className={`mt-7 h-2.5 w-24 rounded-full bg-white/[0.07] ${pulse}`} />
      <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 sm:py-2.5 sm:pl-2.5">
            <span className={`w-10 h-10 rounded-xl bg-white/[0.07] ${pulse}`} />
            <span className={`h-2.5 rounded-full bg-white/[0.07] ${pulse}`} style={{ width: `${48 + (i % 3) * 14}%` }} />
          </div>
        ))}
      </div>
      <div className={`mt-8 h-2.5 w-20 rounded-full bg-white/[0.07] ${pulse}`} />
      <div className="mt-3.5 flex gap-1.5 overflow-hidden">
        {[56, 64, 72, 60, 80].map((w, i) => (
          <span key={i} className={`h-8 shrink-0 rounded-full bg-white/[0.05] ${pulse}`} style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

// Hobilerim — the interests list on the user's profile. Luna's chat context
// includes it (profile.interests), so the copy only promises she keeps them
// in mind. Every change saves the full list via updateProfile({ interests }).
export default function HobbiesPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const label = (entry) => (lang === "tr" ? entry.tr : entry.en);
  const titleId = usePanelTitleId();
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const mineId = `${baseId}-mine`;
  const suggestId = `${baseId}-suggest`;

  const [hobbies, setHobbies] = useState([]);
  const [status, setStatus] = useState("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [category, setCategory] = useState("all");
  const [announcement, setAnnouncement] = useState("");

  // Saves are serialised and always send the newest list: firing one request
  // per tap could land out of order and let an older list win on the server.
  const savedRef = useRef([]);
  const wantedRef = useRef([]);
  const savingRef = useRef(false);
  const inputRef = useRef(null);
  const gridRef = useRef(null);
  const focusAfterRemove = useRef(null);

  useEffect(() => {
    let cancelled = false;
    pendingSave
      .then(() => fetchProfile())
      .then((p) => {
        if (cancelled) return;
        const list = sanitizeList(p?.profile?.interests);
        savedRef.current = list;
        wantedRef.current = list;
        setHobbies(list);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // The undo acts on this panel's copy of the list; once it closes, a late
  // "Geri al" could overwrite changes made in a freshly opened panel.
  useEffect(() => () => toast.dismiss(UNDO_TOAST_ID), []);

  // After removing a tile with its own button, keep keyboard focus in the grid.
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const buttons = gridRef.current?.querySelectorAll('[data-testid="hobby-remove-button"]');
    const next = buttons && buttons.length ? buttons[Math.min(index, buttons.length - 1)] : inputRef.current;
    next?.focus();
  }, [hobbies]);

  const retry = () => {
    setStatus("loading");
    setReloadKey((k) => k + 1);
  };

  const flush = () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const run = async () => {
      while (!sameList(wantedRef.current, savedRef.current)) {
        const target = wantedRef.current;
        try {
          await updateProfile({ interests: target });
          savedRef.current = target;
        } catch {
          wantedRef.current = savedRef.current;
          setHobbies(savedRef.current);
          toast.error(t(
            "Değişiklik kaydedilemedi ve geri alındı. Bağlantını kontrol edip tekrar dene.",
            "Couldn't save your change, so it was undone. Check your connection and try again.",
          ));
          break;
        }
      }
    };
    pendingSave = run()
      .catch(() => {})
      .finally(() => { savingRef.current = false; });
  };

  const commit = (next) => {
    wantedRef.current = next;
    setHobbies(next);
    flush();
  };

  const add = (raw) => {
    const name = cleanHobby(raw);
    if (!name) return false;
    const list = wantedRef.current;
    if (list.some((h) => hobbyKey(h) === hobbyKey(name))) {
      toast(t(`“${name}” zaten listende.`, `“${name}” is already on your list.`));
      return false;
    }
    if (list.length >= MAX_HOBBIES) {
      toast.error(t(
        `En fazla ${MAX_HOBBIES} hobi ekleyebilirsin. Yenisi için listeden birini kaldır.`,
        `You can add up to ${MAX_HOBBIES} hobbies. Remove one to make room.`,
      ));
      return false;
    }
    commit([...list, name]);
    setAnnouncement(t(`${name} eklendi.`, `${name} added.`));
    return true;
  };

  const restore = (name, index) => {
    const list = wantedRef.current;
    if (list.some((h) => hobbyKey(h) === hobbyKey(name))) return;
    if (list.length >= MAX_HOBBIES) {
      toast.error(t(`En fazla ${MAX_HOBBIES} hobi ekleyebilirsin.`, `You can add up to ${MAX_HOBBIES} hobbies.`));
      return;
    }
    const next = [...list];
    next.splice(Math.min(index, next.length), 0, name);
    commit(next);
  };

  // A single hobby is easy to re-add, so removal is instant with an undo
  // toast rather than a confirm dialog.
  const remove = (name) => {
    const list = wantedRef.current;
    const index = list.indexOf(name);
    if (index < 0) return;
    commit(list.filter((_, i) => i !== index));
    toast(t(`“${name}” kaldırıldı.`, `Removed “${name}”.`), {
      id: UNDO_TOAST_ID,
      action: { label: t("Geri al", "Undo"), onClick: () => restore(name, index) },
    });
  };

  const keys = useMemo(() => new Set(hobbies.map(hobbyKey)), [hobbies]);
  const isAdded = (entry) => keys.has(hobbyKey(entry.tr)) || keys.has(hobbyKey(entry.en));

  const toggleSuggestion = (entry) => {
    const existing = wantedRef.current.find((h) => hobbyKey(h) === hobbyKey(entry.tr) || hobbyKey(h) === hobbyKey(entry.en));
    if (existing) remove(existing);
    else add(label(entry));
  };

  const decorated = useMemo(
    () => hobbies.map((name) => ({ name, ...hobbyVisual(name) })),
    [hobbies]
  );

  // Autocomplete: a "add what I typed" row unless the text is exactly a
  // catalog entry, then the catalog matches that aren't on the list yet.
  const typed = cleanHobby(query);
  const typedKey = typed ? hobbyKey(typed) : "";
  const typedVisual = useMemo(() => hobbyVisual(typed), [typed]);
  const options = [];
  if (typed && status === "ready") {
    const matches = searchCatalog(typed, lang, CATALOG.length).filter((entry) => !isAdded(entry)).slice(0, MAX_MATCHES);
    const exact = matches.find((entry) => hobbyKey(entry.tr) === typedKey || hobbyKey(entry.en) === typedKey);
    if (!exact) options.push({ kind: "custom", key: "custom", duplicate: keys.has(typedKey) });
    if (exact) options.push({ kind: "item", key: exact.id, entry: exact });
    for (const entry of matches) if (entry !== exact) options.push({ kind: "item", key: entry.id, entry });
  }
  const listOpen = options.length > 0;
  const activeIndex = Math.min(active, options.length - 1);

  const choose = (option) => {
    if (!option) return;
    if (option.kind === "custom") {
      if (option.duplicate) {
        toast(t(`“${typed}” zaten listende.`, `“${typed}” is already on your list.`));
        return;
      }
      if (!add(typed)) return;
    } else if (!add(label(option.entry))) {
      return;
    }
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (listOpen) choose(options[activeIndex]);
  };

  const onInputKeyDown = (e) => {
    if (e.key === "Escape" && query) {
      // Clear the field instead of letting the panel close.
      e.preventDefault();
      setQuery("");
      setActive(0);
      return;
    }
    if (!listOpen || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((activeIndex + step + options.length) % options.length);
  };

  const canAdd = status === "ready" && typed.length > 0;
  const showCounter = query.length >= MAX_LENGTH - 10;
  const shownCategories = category === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.key === category);
  const nearLimit = hobbies.length >= MAX_HOBBIES - 10;

  return (
    <Panel onClose={onClose} size="xl" accent="fuchsia" labelledBy={titleId} testId="hobbies-panel">
      <PanelHeader
        glyph="hobbies"
        accent="fuchsia"
        title={t("Hobilerim", "My hobbies")}
        subtitle={t(
          "Sevdiğin şeyleri ekle; Luna sohbetlerinde bunları göz önünde bulundurur.",
          "Add the things you love; Luna keeps them in mind when you chat.",
        )}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t("Kapat", "Close")}
        closeTestId="hobbies-close-button"
      />
      <PanelBody>
        {status === "loading" && <HobbiesSkeleton label={t("Hobilerin yükleniyor", "Loading your hobbies")} />}

        {status === "error" && (
          <div data-testid="hobbies-error">
            <ErrorState
              title={t("Hobilerin yüklenemedi", "Couldn't load your hobbies")}
              body={t("Bağlantında bir sorun olabilir. Birazdan tekrar dene.", "There may be a connection problem. Try again in a moment.")}
              onRetry={retry}
              retryLabel={t("Tekrar dene", "Try again")}
            />
          </div>
        )}

        {status === "ready" && (
          <>
            <form onSubmit={onSubmit} className="pt-1" noValidate>
              <label htmlFor={inputId} className="sr-only">{t("Yeni hobi", "New hobby")}</label>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
                    {typed ? (
                      <span key={typedVisual.icon.displayName || typedVisual.rgb} className="block animate-in fade-in-0 zoom-in-75 duration-200 motion-reduce:animate-none">
                        <GlyphTile icon={typedVisual.icon} hue={typedVisual.hue} size={36} />
                      </span>
                    ) : (
                      <span className="flex w-9 h-9 items-center justify-center rounded-[11px] border border-white/[0.06] bg-white/[0.03]">
                        <LunaIcon name="hobbies" size={18} className="opacity-50" />
                      </span>
                    )}
                  </span>
                  <input
                    id={inputId}
                    ref={inputRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                    onKeyDown={onInputKeyDown}
                    maxLength={MAX_LENGTH}
                    autoComplete="off"
                    spellCheck={false}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={listOpen ? `${listboxId}-${activeIndex}` : undefined}
                    placeholder={t("Hobi yaz, örn. gitar", "Type a hobby, e.g. yoga")}
                    data-testid="hobby-input"
                    className={`h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-[3.25rem] ${showCounter ? "pr-14" : "pr-4"} text-base sm:text-[15px] text-white placeholder:text-white/30 outline-none transition-colors focus:border-violet-300/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-violet-400/10`}
                  />
                  {showCounter && (
                    <span aria-hidden="true" className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] tabular-nums ${query.length >= MAX_LENGTH ? "text-amber-300/80" : "text-white/35"}`}>
                      {query.length}/{MAX_LENGTH}
                    </span>
                  )}
                </div>
                <IconButton type="submit" label={t("Hobi ekle", "Add hobby")} variant={canAdd ? "primary" : "soft"} size={52} disabled={!canAdd} testId="hobby-add-button">
                  <Plus size={21} aria-hidden="true" />
                </IconButton>
              </div>

              <ul id={listboxId} role="listbox" aria-label={t("Eşleşen öneriler", "Matching suggestions")} data-testid="hobby-autocomplete"
                hidden={!listOpen}
                className="mt-2 rounded-2xl border border-white/[0.08] bg-[#151027] p-1.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.85)] animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                {options.map((option, i) => {
                  const selected = i === activeIndex;
                  const isCustom = option.kind === "custom";
                  const cat = isCustom ? typedVisual.category : CATEGORY_BY_KEY[option.entry.category];
                  const icon = isCustom ? typedVisual.icon : option.entry.icon;
                  return (
                    <li key={option.key} id={`${listboxId}-${i}`} role="option" aria-selected={selected}
                      aria-disabled={option.duplicate || undefined}
                      data-testid={isCustom ? "hobby-autocomplete-custom" : "hobby-autocomplete-option"}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => { if (!selected) setActive(i); }}
                      onClick={() => choose(option)}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5 transition-colors ${selected ? "bg-white/[0.07]" : ""}`}>
                      <GlyphTile icon={icon} hue={cat ? cat.hue : DEFAULT_HUE} size={32} />
                      <span className="min-w-0 flex-1 truncate text-sm text-white/70">
                        {isCustom ? (
                          option.duplicate
                            ? <span className="text-white/90">“{typed}”</span>
                            : t(
                              <><span className="font-semibold text-white">“{typed}”</span> ekle</>,
                              <>Add <span className="font-semibold text-white">“{typed}”</span></>,
                            )
                        ) : (
                          <Highlighted text={label(option.entry)} query={typed} />
                        )}
                      </span>
                      {isCustom && option.duplicate ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-white/45">
                          <Check size={13} aria-hidden="true" /> {t("Zaten listende", "Already on your list")}
                        </span>
                      ) : (
                        cat && <span className="hidden sm:block shrink-0 text-xs text-white/35">{t(cat.tr, cat.en)}</span>
                      )}
                      {selected && !option.duplicate && (
                        <kbd aria-hidden="true" className="hidden [@media(hover:hover)]:inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/45">
                          <CornerDownLeft size={12} />
                        </kbd>
                      )}
                    </li>
                  );
                })}
              </ul>
            </form>

            <section aria-labelledby={mineId} className="mt-7">
              <SectionLabel action={nearLimit ? (
                <span className={`text-xs tabular-nums ${hobbies.length >= MAX_HOBBIES ? "text-amber-300/80" : "text-white/35"}`}>
                  {hobbies.length}/{MAX_HOBBIES}
                </span>
              ) : null}>
                <span id={mineId}>
                  {t("Hobilerin", "Your hobbies")}
                  {hobbies.length > 0 && !nearLimit && <span className="ml-1.5 tabular-nums text-white/30">{hobbies.length}</span>}
                </span>
              </SectionLabel>

              {hobbies.length === 0 ? (
                <p data-testid="hobbies-empty" className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-3.5 text-[13px] leading-relaxed text-white/50">
                  <GlowIcon icon={ArrowDown} hue={DEFAULT_HUE} size={15} />
                  {t("Henüz hobi eklemedin. Aşağıdaki önerilerden seçebilir ya da kendin yazabilirsin.", "No hobbies yet. Pick a suggestion below or type your own.")}
                </p>
              ) : (
                <ul ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {decorated.map(({ name, icon, hue, category: cat }, i) => (
                    <li key={name} data-testid="hobby-chip" title={name}
                      className="group relative flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 sm:py-2.5 sm:pl-2.5 sm:pr-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
                      <GlyphTile icon={icon} hue={hue} size={40} />
                      <span className="min-w-0">
                        <span id={`${baseId}-h${i}`} className="line-clamp-2 break-words text-sm font-semibold leading-snug text-white/90">{name}</span>
                        {cat && <span className="mt-0.5 block truncate text-[11.5px] text-white/40">{t(cat.shortTr, cat.shortEn)}</span>}
                      </span>
                      <button type="button" data-testid="hobby-remove-button"
                        aria-label={t("Kaldır", "Remove")} aria-describedby={`${baseId}-h${i}`}
                        onClick={() => { focusAfterRemove.current = i; remove(name); }}
                        className="absolute right-2 top-2 sm:top-1/2 sm:-translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 before:absolute before:-inset-1 before:content-[''] [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
                        <X size={15} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby={suggestId} className="mt-8">
              <SectionLabel action={<span className="text-xs text-white/35">{t("Eklemek ya da çıkarmak için seç", "Select to add or remove")}</span>}>
                <span id={suggestId}>
                  {t("Öneriler", "Suggestions")}
                  <span className="ml-1.5 tabular-nums text-white/30">{CATALOG.length}</span>
                </span>
              </SectionLabel>
              <ChipRail label={t("Kategoriler", "Categories")}>
                <Chip active={category === "all"} onClick={() => setCategory("all")} icon={ALL_CHIP_GLYPH} testId="hobby-category-all">
                  {t("Tümü", "All")}
                </Chip>
                {CATEGORIES.map((c) => (
                  <Chip key={c.key} active={category === c.key} onClick={() => setCategory(c.key)} icon={CHIP_GLYPHS[c.key]}
                    testId={`hobby-category-${c.key}`}>
                    {t(c.shortTr, c.shortEn)}
                  </Chip>
                ))}
              </ChipRail>

              <div className="mt-5 space-y-6">
                {shownCategories.map((c) => {
                  const entries = CATALOG_BY_CATEGORY[c.key];
                  const picked = entries.filter(isAdded).length;
                  const headingId = `${baseId}-cat-${c.key}`;
                  return (
                    <div key={c.key} role="group" aria-labelledby={headingId}>
                      <div className="mb-2.5 flex items-center gap-2">
                        <GlyphTile icon={c.icon} hue={c.hue} size={24} glyph={13} />
                        <h4 id={headingId} className="text-[13px] font-semibold text-white/80">{t(c.tr, c.en)}</h4>
                        {picked > 0 && (
                          <span className="ml-auto text-xs tabular-nums text-white/40">{t(`${picked} seçili`, `${picked} selected`)}</span>
                        )}
                      </div>
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {entries.map((entry) => {
                          const added = isAdded(entry);
                          return (
                            <li key={entry.id}>
                              <button type="button" data-testid="hobby-suggestion" aria-pressed={added} onClick={() => toggleSuggestion(entry)}
                                className={`group flex h-full min-h-[52px] w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
                                  added ? "" : "border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.055]"
                                }`}
                                style={added ? { borderColor: `rgba(${c.rgb},0.38)`, backgroundColor: `rgba(${c.rgb},0.08)` } : undefined}>
                                <span className="relative shrink-0">
                                  <GlyphTile icon={entry.icon} hue={c.hue} size={32}
                                    className={added ? "" : "opacity-80 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"} />
                                  {added && (
                                    <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-[#110c20] animate-in zoom-in-50 duration-150 motion-reduce:animate-none"
                                      style={{ backgroundColor: `rgb(${c.rgb})` }}>
                                      <Check size={10} strokeWidth={3} className="text-[#110c20]" />
                                    </span>
                                  )}
                                </span>
                                <span className={`min-w-0 flex-1 break-words text-[13px] font-medium leading-snug ${added ? "text-white" : "text-white/75 group-hover:text-white"}`}>
                                  {label(entry)}
                                </span>
                                {!added && (
                                  <Plus size={15} aria-hidden="true" className="hidden sm:block shrink-0 text-white/25 transition-colors group-hover:text-white/70" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>

            <p className="sr-only" aria-live="polite">{announcement}</p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
