import { useEffect, useState, useCallback } from "react";
import { X, Plus, Trash2, StickyNote, Search, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchNotes, createNote, editNote, deleteNote } from "@/lib/api";

const CAT_LABELS = { genel: { tr: "Genel", en: "General" }, "kişisel": { tr: "Kişisel", en: "Personal" }, "iş": { tr: "İş", en: "Work" }, fikir: { tr: "Fikir", en: "Idea" }, "önemli": { tr: "Önemli", en: "Important" } };

export default function NotesPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [notes, setNotes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("genel");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");

  const load = useCallback((q) => {
    setLoading(true);
    fetchNotes(q).then(({ notes, categories }) => { setNotes(notes); setCategories(categories); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setTimeout(() => load(query), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleAdd = async () => {
    const content = newContent.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await createNote({ title: newTitle.trim(), content, category: newCategory });
      setNewTitle(""); setNewContent(""); setAdding(false);
      load(query);
    } catch {
      toast.error(t("Not eklenemedi", "Couldn't add note"));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (n) => { setEditingId(n.id); setEditContent(n.content); };
  const saveEdit = async (id) => {
    const content = editContent.trim();
    if (!content) return;
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, content } : n)));
    setEditingId(null);
    try { await editNote(id, { content }); } catch { toast.error(t("Güncellenemedi", "Couldn't update")); }
  };

  const handleDelete = async (id) => {
    setNotes((n) => n.filter((x) => x.id !== id));
    try { await deleteNote(id); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="notes-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <StickyNote size={17} className="text-purple-300" /> {t("Notlarım", "My Notes")}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdding((a) => !a)} data-testid="note-add-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <Plus size={16} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5"><X size={16} /></button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Notlarda ara...", "Search notes...")}
            data-testid="note-search"
            className="w-full bg-black/25 outline-none pl-9 pr-3 py-2 rounded-full border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
        </div>

        {adding && (
          <div className="rounded-2xl border border-purple-400/20 p-3 mb-3 space-y-2" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t("Başlık (opsiyonel)", "Title (optional)")}
              data-testid="note-title-input"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder={t("Not içeriği...", "Note content...")} rows={3}
              data-testid="note-input"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 resize-none" />
            <div className="flex items-center gap-2">
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} data-testid="note-category-select"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white">
                {(categories.length ? categories : Object.keys(CAT_LABELS)).map((c) => (
                  <option key={c} value={c} className="bg-[#0c0818]">{CAT_LABELS[c] ? t(CAT_LABELS[c].tr, CAT_LABELS[c].en) : c}</option>
                ))}
              </select>
              <button onClick={handleAdd} disabled={!newContent.trim() || saving} data-testid="note-add-button"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40">
                {t("Kaydet", "Save")}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Not bulunamadı.", "No notes found.")}</p>
          ) : notes.map((n) => (
            <div key={n.id} data-testid="note-item" className="rounded-xl border border-white/10 p-3"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
              {editingId === n.id ? (
                <div className="space-y-2">
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3}
                    className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/30 text-sm text-white resize-none" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-xs text-white/50 hover:text-white px-2">{t("Vazgeç", "Cancel")}</button>
                    <button onClick={() => saveEdit(n.id)} className="flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-white px-2">
                      <Check size={13} /> {t("Kaydet", "Save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2 group">
                  <div className="min-w-0 flex-1">
                    {n.title && <p className="text-sm font-semibold text-white mb-0.5">{n.title}</p>}
                    <p className="text-sm text-white/75 whitespace-pre-wrap break-words">{n.content}</p>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-purple-300/50">
                      {CAT_LABELS[n.category] ? t(CAT_LABELS[n.category].tr, CAT_LABELS[n.category].en) : n.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(n)} data-testid="note-edit-button" className="text-white/30 hover:text-purple-300"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(n.id)} data-testid="note-delete-button" className="text-white/30 hover:text-red-400"><Trash2 size={13} /></button>
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
