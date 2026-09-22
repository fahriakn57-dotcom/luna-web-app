import { useEffect, useState } from "react";
import { X, Brain, Plus, Trash2, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchMemories, addMemory, editMemory, deleteMemory } from "@/lib/api";

const CATEGORY_LABELS = {
  "kişisel": { tr: "Kişisel", en: "Personal" },
  "iş": { tr: "İş", en: "Work" },
  "hedefler": { tr: "Hedefler", en: "Goals" },
  "ilgi_alanları": { tr: "İlgi Alanları", en: "Interests" },
  "önemli_tarihler": { tr: "Önemli Tarihler", en: "Important Dates" },
  "tercihler": { tr: "Tercihler", en: "Preferences" },
  "ilişkiler": { tr: "İlişkiler", en: "Relationships" },
  "projeler": { tr: "Projeler", en: "Projects" },
  "diğer": { tr: "Diğer", en: "Other" },
};

function relTime(m, lang) {
  const when = m.event_date || (m.created_at || "").slice(0, 10);
  const d = new Date(when);
  if (isNaN(d)) return when;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const tr = lang === "tr";
  if (days <= 0) return tr ? "bugün" : "today";
  if (days < 7) return tr ? `${days} gün önce` : `${days}d ago`;
  if (days < 60) return tr ? `${Math.floor(days / 7)} hafta önce` : `${Math.floor(days / 7)}w ago`;
  if (days < 365) return tr ? `${Math.floor(days / 30)} ay önce` : `${Math.floor(days / 30)}mo ago`;
  return tr ? `${Math.floor(days / 365)} yıl önce` : `${Math.floor(days / 365)}y ago`;
}

// Full memory management modal — proves + manages Luna's long-term memory.
export default function MemoryPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [memories, setMemories] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState("all");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("diğer");
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");

  const load = () => {
    setLoading(true);
    fetchMemories()
      .then(({ memories, categories }) => { setMemories(memories); setCategories(categories); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const content = newContent.trim();
    if (!content) return;
    try {
      await addMemory({ title: newTitle.trim() || t("Not", "Note"), content, category: newCategory, tags: [] });
      setNewTitle(""); setNewContent(""); setAdding(false);
      load();
      toast.success(t("Anı eklendi", "Memory added"));
    } catch {
      toast.error(t("Anı eklenemedi", "Couldn't add memory"));
    }
  };

  const startEdit = (m) => { setEditingId(m.id); setEditContent(m.content); };

  const saveEdit = async (id) => {
    const content = editContent.trim();
    if (!content) return;
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, content, displayContent: m.title ? `${m.title}: ${content}` : content } : m)));
    setEditingId(null);
    try { await editMemory(id, { content }); } catch { toast.error(t("Güncellenemedi", "Couldn't update")); }
  };

  const handleDelete = async (id) => {
    setMemories((ms) => ms.filter((m) => m.id !== id));
    try { await deleteMemory(null, id); } catch {}
  };

  const visible = activeCat === "all" ? memories : memories.filter((m) => m.category === activeCat);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="memories-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Brain size={17} className="text-purple-300" /> {t("Anılarım", "My Memories")}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdding((a) => !a)} data-testid="memory-add-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <Plus size={16} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
              <X size={16} />
            </button>
          </div>
        </div>

        {adding && (
          <div className="rounded-2xl border border-purple-400/20 p-3 mb-4 space-y-2" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t("Başlık", "Title")}
              data-testid="memory-new-title"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder={t("Ne hatırlamamı istersin?", "What should I remember?")}
              data-testid="memory-new-content" rows={2}
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 resize-none" />
            <div className="flex items-center gap-2">
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} data-testid="memory-new-category"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white">
                {(categories.length ? categories : Object.keys(CATEGORY_LABELS)).map((c) => (
                  <option key={c} value={c} className="bg-[#0c0818]">{CATEGORY_LABELS[c] ? t(CATEGORY_LABELS[c].tr, CATEGORY_LABELS[c].en) : c}</option>
                ))}
              </select>
              <button onClick={handleAdd} disabled={!newContent.trim()} data-testid="memory-save-button"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40">
                {t("Kaydet", "Save")}
              </button>
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setActiveCat("all")} data-testid="memory-cat-all"
              className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
              style={activeCat === "all" ? { borderColor: "#c084fc", color: "#fff", backgroundColor: "rgba(192,132,252,0.15)" } : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
              {t("Tümü", "All")}
            </button>
            {categories.map((c) => (
              <button key={c} onClick={() => setActiveCat(c)} data-testid={`memory-cat-${c}`}
                className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                style={activeCat === c ? { borderColor: "#c084fc", color: "#fff", backgroundColor: "rgba(192,132,252,0.15)" } : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
                {CATEGORY_LABELS[c] ? t(CATEGORY_LABELS[c].tr, CATEGORY_LABELS[c].en) : c}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-white/50 leading-relaxed text-center py-6">
              {t("Henüz bir şey hatırlamıyorum. Bana ne yaptığını anlat ya da yukarıdan manuel ekle 🌙",
                 "I don't remember anything yet. Tell me something, or add one manually above 🌙")}
            </p>
          ) : visible.map((m) => (
            <div key={m.id} data-testid="memory-item" className="rounded-xl border border-white/10 p-3"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
              {editingId === m.id ? (
                <div className="space-y-2">
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2}
                    data-testid="memory-edit-textarea"
                    className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/30 text-sm text-white resize-none" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-xs text-white/50 hover:text-white px-2">{t("Vazgeç", "Cancel")}</button>
                    <button onClick={() => saveEdit(m.id)} data-testid="memory-edit-save"
                      className="flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-white px-2">
                      <Check size={13} /> {t("Kaydet", "Save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2 group">
                  <div className="min-w-0">
                    <p className="text-sm text-white/90 leading-snug break-words">{m.displayContent}</p>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-purple-300/50">
                      {relTime(m, lang)} · {CATEGORY_LABELS[m.category] ? t(CATEGORY_LABELS[m.category].tr, CATEGORY_LABELS[m.category].en) : m.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(m)} data-testid="memory-edit-button" className="text-white/30 hover:text-purple-300"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(m.id)} data-testid="memory-delete-button" className="text-white/30 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
