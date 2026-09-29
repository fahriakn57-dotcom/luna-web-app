import { useEffect, useState } from "react";
import { X, BookOpen, Plus, Trash2, Pencil, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { fetchJournal, createJournalEntry, editJournalEntry, deleteJournalEntry } from "@/lib/api";

function formatDateTime(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}
function formatDay(day, lang) {
  const d = new Date(day + "T00:00:00");
  if (isNaN(d)) return day;
  return d.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "long", year: "numeric" });
}

export default function JournalPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [entries, setEntries] = useState([]);
  const [aiSummaries, setAiSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [tab, setTab] = useState("entries"); // "entries" | "ai"

  useEffect(() => {
    fetchJournal().then(({ entries, aiSummaries }) => { setEntries(entries); setAiSummaries(aiSummaries); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const entry = await createJournalEntry(text);
      setEntries((e) => [entry, ...e]);
      setContent(""); setWriting(false);
      toast.success(t("Günlük kaydedildi 🌙", "Journal entry saved 🌙"));
    } catch {
      toast.error(t("Kaydedilemedi", "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (e) => { setEditingId(e.id); setEditContent(e.content); };
  const saveEdit = async (id) => {
    const text = editContent.trim();
    if (!text) return;
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, content: text } : e)));
    setEditingId(null);
    try { await editJournalEntry(id, text); } catch { toast.error(t("Güncellenemedi", "Couldn't update")); }
  };

  const handleDelete = async (id) => {
    setEntries((es) => es.filter((e) => e.id !== id));
    try { await deleteJournalEntry(id); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="journal-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <BookOpen size={17} className="text-purple-300" /> {t("Günlük", "Journal")}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setWriting((w) => !w)} data-testid="journal-write-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <Plus size={16} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5"><X size={16} /></button>
          </div>
        </div>
        <p className="text-[11px] text-white/40 mb-3">
          {t("Yazdıkların Luna'nın hafızasına da işlenir — ruh halini ve düzenini zamanla daha iyi anlar.", "What you write also feeds Luna's memory — she'll understand your mood and routine better over time.")}
        </p>

        {writing && (
          <div className="rounded-2xl border border-purple-400/20 p-3 mb-3 space-y-2" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t("Bugün nasıl geçti?", "How was your day?")} rows={4}
              data-testid="journal-input" autoFocus
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 resize-none" />
            <button onClick={handleAdd} disabled={!content.trim() || saving} data-testid="journal-save-button"
              className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40">
              {t("Kaydet", "Save")}
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 mb-3">
          <button onClick={() => setTab("entries")} data-testid="journal-tab-entries"
            className="text-[11px] px-3 py-1.5 rounded-full border transition-colors"
            style={tab === "entries" ? { borderColor: "#c084fc", color: "#fff", backgroundColor: "rgba(192,132,252,0.15)" } : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
            {t("Günlüğüm", "My Entries")}
          </button>
          <button onClick={() => setTab("ai")} data-testid="journal-tab-ai"
            className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-full border transition-colors"
            style={tab === "ai" ? { borderColor: "#c084fc", color: "#fff", backgroundColor: "rgba(192,132,252,0.15)" } : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
            <Sparkles size={11} /> {t("Luna'nın Özetleri", "Luna's Recaps")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : tab === "entries" ? (
            entries.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-6">{t("Henüz bir günlük yazmadın.", "You haven't written any entries yet.")}</p>
            ) : entries.map((e) => (
              <div key={e.id} data-testid="journal-entry" className="rounded-xl border border-white/10 p-4" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                {editingId === e.id ? (
                  <div className="space-y-2">
                    <textarea value={editContent} onChange={(ev) => setEditContent(ev.target.value)} rows={3}
                      className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/30 text-sm text-white resize-none" />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="text-xs text-white/50 hover:text-white px-2">{t("Vazgeç", "Cancel")}</button>
                      <button onClick={() => saveEdit(e.id)} className="flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-white px-2">
                        <Check size={13} /> {t("Kaydet", "Save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-mono text-purple-300/70 uppercase tracking-wide">{formatDateTime(e.created_at, lang)}</p>
                      <div className="flex items-center gap-2 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(e)} data-testid="journal-edit-button" className="text-white/30 hover:text-purple-300"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(e.id)} data-testid="journal-delete-button" className="text-white/30 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed">{e.content}</p>
                  </div>
                )}
              </div>
            ))
          ) : (
            aiSummaries.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-6">{t("Henüz bir özet yok — birkaç gün sohbet ettikçe burada birikecek.", "No recaps yet — they'll appear as you chat over the coming days.")}</p>
            ) : aiSummaries.map((s) => (
              <div key={s.id} data-testid="journal-ai-summary" className="rounded-xl border border-white/10 p-4" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                <p className="text-[11px] font-mono text-purple-300/70 uppercase tracking-wide mb-1.5">{formatDay(s.day, lang)}</p>
                <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{s.summary}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
