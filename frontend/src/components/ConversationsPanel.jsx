import { useEffect, useState } from "react";
import { X, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchConversations, createConversation, deleteConversation } from "@/lib/api";

function relTime(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  const tr = lang === "tr";
  if (mins < 1) return tr ? "az önce" : "just now";
  if (mins < 60) return tr ? `${mins} dk önce` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tr ? `${hours} sa önce` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return tr ? `${days} gün önce` : `${days}d ago`;
  return d.toLocaleDateString(tr ? "tr-TR" : "en-US", { day: "numeric", month: "short" });
}

// The "Sohbetler" list — lets someone keep several separate chats within a
// mode (like ChatGPT's chat history) instead of one single ever-growing
// thread. Picking a row (or "+ Yeni Sohbet") hands its id back to Luna.jsx
// via onSelect, which loads that conversation's real message history.
export default function ConversationsPanel({ lang, mode, activeConversationId, onSelect, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    fetchConversations(mode).then(setConversations).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    setCreating(true);
    try {
      const convo = await createConversation(mode);
      onSelect(convo.id);
      onClose();
    } catch {
      toast.error(t("Yeni sohbet oluşturulamadı", "Couldn't create a new chat"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    setConversations((cs) => cs.filter((c) => c.id !== id));
    try {
      await deleteConversation(id);
      if (id === activeConversationId) onSelect(null);
    } catch {
      toast.error(t("Silinemedi", "Couldn't delete"));
      load();
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="conversations-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <MessageSquare size={17} className="text-purple-300" /> {t("Sohbetlerim", "My Chats")}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        <button onClick={handleCreate} disabled={creating} data-testid="new-conversation-button"
          className="w-full flex items-center justify-center gap-2 mb-4 rounded-full py-2.5 text-sm font-semibold text-white disabled:opacity-50 shrink-0"
          style={{ background: "linear-gradient(90deg,#6366f1,#d946ef)" }}>
          <Plus size={16} /> {t("Yeni Sohbet", "New Chat")}
        </button>

        <div className="flex-1 overflow-y-auto space-y-1.5">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Henüz bir sohbetin yok.", "No chats yet.")}</p>
          ) : conversations.map((c) => {
            const active = c.id === activeConversationId;
            return (
              <button key={c.id} onClick={() => { onSelect(c.id); onClose(); }} data-testid="conversation-item"
                className={`w-full flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors group ${
                  active ? "border border-purple-400/40" : "border border-white/5 hover:bg-white/5"
                }`}
                style={{ backgroundColor: active ? "rgba(192,132,252,0.1)" : "rgba(255,255,255,0.03)" }}>
                <div className="min-w-0">
                  <p className="text-sm text-white/85 truncate">{c.title || t("Yeni Sohbet", "New Chat")}</p>
                  <p className="text-[11px] text-purple-300/50">{relTime(c.updated_at, lang)}</p>
                </div>
                <span onClick={(e) => handleDelete(e, c.id)} data-testid="conversation-delete-button"
                  className="shrink-0 text-white/25 hover:text-red-400 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity p-1">
                  <Trash2 size={14} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
