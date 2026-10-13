import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { X, Plus, Search, Pin, PinOff, Pencil, Trash2, MoreHorizontal, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { IconTile } from "@/components/icons/LunaIcon";
import ConfirmDialog from "@/components/ConfirmDialog";
import { IconButton, primaryButtonClass } from "@/components/panel/Panel";
import { fetchConversations, createConversation, deleteConversation, updateConversation } from "@/lib/api";
import { groupConversations, timeLabel } from "@/lib/conversationGroups";

// "Sohbetlerim" — the chat list as a drawer that slides in from the left
// (full height on phones, next to the sidebar on desktop), like a messenger:
// search, a clear "Yeni sohbet", chats grouped by day with pinned ones on
// top, and under each title a one-line preview of the last message. Each
// chat can be renamed, pinned or deleted (after a confirm). Picking a chat
// hands its id back to Luna.jsx via onSelect, which loads its history.
export default function ConversationsPanel({ lang, mode, activeConversationId, onSelect, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = useId();
  const [conversations, setConversations] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState(null);
  const [renaming, setRenamingState] = useState(null); // { id, value }
  // Mirrors `renaming` synchronously: a submit followed by the input's blur,
  // or an Escape-cancel followed by a blur, must save at most once.
  const renamingRef = useRef(null);
  const setRenaming = (v) => { renamingRef.current = v; setRenamingState(v); };
  const [confirmDelete, setConfirmDelete] = useState(null); // conversation
  const [deleting, setDeleting] = useState(false);
  const drawerRef = useRef(null);
  const searchRef = useRef(null);
  const pressStartedOnOverlay = useRef(false);

  const load = useCallback(() => {
    setStatus("loading");
    fetchConversations(mode)
      .then((list) => { setConversations(list); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  // Escape peels one layer at a time: the row menu, then a rename in
  // progress, then the drawer itself. The delete confirm handles its own.
  const escRef = useRef(null);
  escRef.current = () => {
    if (menuFor) return setMenuFor(null);
    if (renaming) return setRenaming(null);
    if (query) return setQuery("");
    onClose();
  };
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    drawerRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      escRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  const groups = useMemo(
    () => groupConversations(conversations, { lang, query, now: new Date() }),
    [conversations, lang, query],
  );
  const now = useMemo(() => new Date(), [conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id) => { onSelect(id); onClose(); };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const convo = await createConversation(mode);
      select(convo.id);
    } catch {
      toast.error(t("Yeni sohbet oluşturulamadı", "Couldn't create a new chat"));
    } finally {
      setCreating(false);
    }
  };

  const patchLocal = (id, fields) =>
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, ...fields } : c)));

  const togglePin = async (c) => {
    setMenuFor(null);
    const pinned = !c.pinned;
    patchLocal(c.id, { pinned });
    try {
      await updateConversation(c.id, { pinned });
    } catch {
      patchLocal(c.id, { pinned: c.pinned });
      toast.error(t("Sabitlenemedi", "Couldn't pin"));
    }
  };

  const saveRename = async () => {
    const current = renamingRef.current;
    if (!current) return;
    const { id, value } = current;
    setRenaming(null);
    const title = value.replace(/\s+/g, " ").trim().slice(0, 80);
    const before = conversations.find((c) => c.id === id);
    if (!before || !title || title === (before.title || "")) return;
    patchLocal(id, { title });
    try {
      await updateConversation(id, { title });
    } catch {
      patchLocal(id, { title: before.title });
      toast.error(t("Yeniden adlandırılamadı", "Couldn't rename"));
    }
  };

  const doDelete = async () => {
    const c = confirmDelete;
    if (!c) return;
    setDeleting(true);
    try {
      await deleteConversation(c.id);
      setConversations((cs) => cs.filter((x) => x.id !== c.id));
      if (c.id === activeConversationId) onSelect(null);
      setConfirmDelete(null);
    } catch {
      toast.error(t("Silinemedi", "Couldn't delete"));
    } finally {
      setDeleting(false);
    }
  };

  // A press that starts inside the drawer and ends on the overlay (e.g.
  // selecting text and overshooting) must not close it.
  const onOverlayDown = (e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; };
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget && pressStartedOnOverlay.current) onClose();
    pressStartedOnOverlay.current = false;
  };

  const total = conversations.length;

  return (
    <div className="fixed inset-0 z-[90] bg-[#05030b]/65 backdrop-blur-[3px] animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      onMouseDown={onOverlayDown} onClick={onOverlayClick} data-testid="conversations-panel">
      <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={() => menuFor && setMenuFor(null)}
        className="absolute inset-y-0 left-0 lg:left-64 flex flex-col w-[min(88vw,380px)] h-[100dvh] outline-none
          border-r border-white/[0.09] sm:rounded-r-[28px] overflow-hidden
          animate-in slide-in-from-left-full duration-300 ease-out motion-reduce:animate-none"
        style={{
          background: "#0f0b1e",
          boxShadow: "30px 0 80px -24px rgba(0,0,0,0.75), inset -1px 0 0 rgba(255,255,255,0.04)",
        }}>
        {/* The accent glow sits behind the header only, so the sticky day
            labels below can match the plain surface. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44"
          style={{ background: "radial-gradient(120% 100% at 0% 0%, rgba(167,139,250,0.16), transparent 70%)" }} />
        {/* Header */}
        <div className="relative flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 shrink-0">
          <IconTile name="chats" size={40} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em] text-white leading-tight">
              {t("Sohbetlerim", "My Chats")}
            </h2>
            <p className="text-[12px] text-white/45 mt-0.5" data-testid="conversations-count">
              {status === "ready"
                ? total === 0 ? t("Henüz sohbet yok", "No chats yet") : t(`${total} sohbet`, `${total} chat${total === 1 ? "" : "s"}`)
                : " "}
            </p>
          </div>
          <IconButton label={t("Kapat", "Close")} onClick={onClose} testId="conversations-close">
            <X size={17} />
          </IconButton>
        </div>

        {/* New chat + search */}
        <div className="relative px-4 pb-3 space-y-2.5 shrink-0">
          <button type="button" onClick={handleCreate} disabled={creating} data-testid="new-conversation-button"
            className={`${primaryButtonClass} w-full !rounded-2xl !py-3`}>
            {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={17} />}
            {t("Yeni sohbet", "New chat")}
          </button>
          {total > 0 && (
            <label className="relative block">
              <span className="sr-only">{t("Sohbetlerde ara", "Search chats")}</span>
              <Search size={15} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
              <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Sohbetlerde ara", "Search chats")} data-testid="conversations-search"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-10 pr-9 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors focus:border-violet-300/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-violet-400/10 [&::-webkit-search-cancel-button]:hidden" />
              {query && (
                <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                  aria-label={t("Aramayı temizle", "Clear search")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10">
                  <X size={13} />
                </button>
              )}
            </label>
          )}
        </div>

        {/* List */}
        <div className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          data-testid="conversations-list">
          {status === "loading" && <ListSkeleton />}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-white/55">{t("Sohbetler yüklenemedi.", "Couldn't load your chats.")}</p>
              <button type="button" onClick={load}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 border border-white/10 hover:bg-white/[0.06] hover:text-white">
                <RefreshCw size={13} /> {t("Tekrar dene", "Try again")}
              </button>
            </div>
          )}

          {status === "ready" && total === 0 && (
            <div className="flex flex-col items-center gap-3 px-8 py-12 text-center" data-testid="conversations-empty">
              <IconTile name="chats" size={56} />
              <p className="text-sm font-medium text-white/75">{t("Henüz bir sohbetin yok", "No chats yet")}</p>
              <p className="text-[13px] leading-relaxed text-white/45">
                {t("Luna'yla konuşmaya başladığında sohbetlerin burada, günlere göre sıralanır.",
                  "Once you start talking with Luna, your chats show up here, sorted by day.")}
              </p>
            </div>
          )}

          {status === "ready" && total > 0 && groups.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-white/45" data-testid="conversations-no-results">
              {t(`“${query.trim()}” için sohbet bulunamadı.`, `No chats match “${query.trim()}”.`)}
            </p>
          )}

          {status === "ready" && groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="mb-1.5">
              <h3 className="sticky top-0 z-[2] flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35 bg-[#0f0b1e]/95 backdrop-blur-sm">
                {g.key === "pinned" && <Pin size={11} aria-hidden="true" />}
                {g.label}
              </h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => (
                  <ConversationRow key={c.id} c={c} lang={lang} t={t} now={now}
                    active={c.id === activeConversationId}
                    menuOpen={menuFor === c.id}
                    renaming={renaming?.id === c.id ? renaming.value : null}
                    onSelect={() => select(c.id)}
                    onToggleMenu={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                    onRename={() => { setMenuFor(null); setRenaming({ id: c.id, value: c.title || "" }); }}
                    onRenameChange={(value) => setRenaming({ id: c.id, value })}
                    onRenameSave={saveRename}
                    onRenameCancel={() => setRenaming(null)}
                    onTogglePin={() => togglePin(c)}
                    onDelete={() => { setMenuFor(null); setConfirmDelete(c); }} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>

      <ConfirmDialog
        open={!!confirmDelete}
        danger
        busy={deleting}
        title={t("Sohbet silinsin mi?", "Delete this chat?")}
        body={t(
          `“${confirmDelete?.title || "Yeni sohbet"}” ve içindeki tüm mesajlar kalıcı olarak silinir.`,
          `“${confirmDelete?.title || "New chat"}” and all of its messages will be deleted for good.`,
        )}
        confirmLabel={t("Sil", "Delete")}
        cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ConversationRow({
  c, lang, t, now, active, menuOpen, renaming,
  onSelect, onToggleMenu, onRename, onRenameChange, onRenameSave, onRenameCancel, onTogglePin, onDelete,
}) {
  const inputRef = useRef(null);
  const [menuUp, setMenuUp] = useState(false);
  const isRenaming = renaming !== null;

  useEffect(() => {
    if (isRenaming) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [isRenaming]);

  const title = c.title || t("Yeni sohbet", "New chat");
  const preview = c.preview
    ? (c.last_sender === "user" ? t("Sen: ", "You: ") : "") + c.preview
    : t("Henüz mesaj yok", "No messages yet");

  return (
    <li className="relative group">
      {active && (
        <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-indigo-400 to-fuchsia-400" />
      )}
      {isRenaming ? (
        <form onSubmit={(e) => { e.preventDefault(); onRenameSave(); }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 bg-white/[0.06] border border-violet-300/40">
          <input ref={inputRef} value={renaming} maxLength={80} data-testid="conversation-rename-input"
            onChange={(e) => onRenameChange(e.target.value)} onBlur={onRenameSave}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onRenameCancel(); } }}
            aria-label={t("Sohbetin yeni adı", "New chat name")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30" />
          <button type="submit" aria-label={t("Kaydet", "Save")} onMouseDown={(e) => e.preventDefault()}
            className="w-7 h-7 rounded-full flex items-center justify-center text-violet-200 hover:bg-white/10">
            <Check size={15} />
          </button>
        </form>
      ) : (
        <>
          <button type="button" onClick={onSelect} data-testid="conversation-item" aria-current={active ? "true" : undefined}
            className={`w-full flex items-start gap-3 rounded-xl pl-3.5 pr-11 [@media(hover:hover)]:pr-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
              active ? "bg-violet-400/[0.12]" : "hover:bg-white/[0.05]"
            }`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={`min-w-0 flex-1 truncate text-[14px] ${active ? "font-semibold text-white" : "font-medium text-white/85"} ${c.title ? "" : "italic text-white/60"}`}>
                  {title}
                </p>
                {/* With a mouse the "…" button takes the time's place on hover;
                    on touch screens both show, side by side. */}
                <span className={`shrink-0 text-[11px] tabular-nums text-white/35 transition-opacity ${
                  menuOpen ? "opacity-0" : "[@media(hover:hover)]:group-hover:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-0"
                }`}>
                  {timeLabel(c.updated_at, { lang, now })}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-white/45" data-testid="conversation-preview">
                {preview}
              </p>
            </div>
          </button>

          <div className="absolute right-1.5 top-1.5">
            <button type="button" onClick={(e) => {
              e.stopPropagation();
              // Near the bottom of the screen the menu opens upward.
              setMenuUp(e.currentTarget.getBoundingClientRect().bottom > window.innerHeight - 170);
              onToggleMenu();
            }}
              aria-label={t("Sohbet seçenekleri", "Chat options")} aria-haspopup="menu" aria-expanded={menuOpen}
              data-testid="conversation-menu-button"
              className={`w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
                menuOpen ? "opacity-100 bg-white/10 text-white" : "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}>
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div role="menu" onClick={(e) => e.stopPropagation()}
                className={`absolute right-0 ${menuUp ? "bottom-9" : "top-9"} z-10 w-48 rounded-xl border border-white/10 bg-[#171128] p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] animate-in fade-in-0 zoom-in-95 duration-150`}>
                <MenuItem icon={Pencil} onClick={onRename} testId="conversation-rename-button">
                  {t("Yeniden adlandır", "Rename")}
                </MenuItem>
                <MenuItem icon={c.pinned ? PinOff : Pin} onClick={onTogglePin} testId="conversation-pin-button">
                  {c.pinned ? t("Sabitlemeyi kaldır", "Unpin") : t("Sabitle", "Pin")}
                </MenuItem>
                <div className="my-1 h-px bg-white/[0.07]" />
                <MenuItem icon={Trash2} onClick={onDelete} danger testId="conversation-delete-button">
                  {t("Sil", "Delete")}
                </MenuItem>
              </div>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function MenuItem({ icon: Icon, onClick, danger, testId, children }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testId}
      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-left transition-colors ${
        danger ? "text-red-300 hover:bg-red-500/10" : "text-white/80 hover:bg-white/[0.07] hover:text-white"
      }`}>
      <Icon size={14} aria-hidden="true" /> {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="px-2 pt-3 space-y-1" aria-hidden="true">
      <div className="h-3 w-16 rounded bg-white/[0.06] mb-3 ml-1" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-xl px-3 py-3 animate-pulse">
          <div className="h-3.5 rounded bg-white/[0.07]" style={{ width: `${70 - i * 8}%` }} />
          <div className="mt-2 h-3 rounded bg-white/[0.04]" style={{ width: `${88 - i * 6}%` }} />
        </div>
      ))}
    </div>
  );
}
