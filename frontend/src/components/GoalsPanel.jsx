import { useEffect, useState } from "react";
import { X, Plus, Trash2, Target, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchGoals, createGoal, editGoal, toggleGoal, deleteGoal } from "@/lib/api";

const CAT_LABELS = {
  "kişisel": { tr: "Kişisel", en: "Personal" }, "sağlık": { tr: "Sağlık", en: "Health" },
  "kariyer": { tr: "Kariyer", en: "Career" }, "eğitim": { tr: "Eğitim", en: "Education" },
  "finans": { tr: "Finans", en: "Finance" }, "ilişkiler": { tr: "İlişkiler", en: "Relationships" }, "diğer": { tr: "Diğer", en: "Other" },
};

export default function GoalsPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [goals, setGoals] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("kişisel");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGoals().then(({ goals, categories }) => { setGoals(goals); setCategories(categories); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    const t2 = title.trim();
    if (!t2 || saving) return;
    setSaving(true);
    try {
      const goal = await createGoal({ title: t2, category, description: description.trim(), deadline: deadline || null });
      setGoals((g) => [goal, ...g]);
      setTitle(""); setDescription(""); setDeadline(""); setAdding(false);
    } catch {
      toast.error(t("Hedef eklenemedi", "Couldn't add goal"));
    } finally {
      setSaving(false);
    }
  };

  const handleProgress = async (id, progress) => {
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, progress, done: progress >= 100 } : x)));
    try { await editGoal(id, { progress }); } catch {}
  };

  const handleToggle = async (id) => {
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, done: !x.done, progress: !x.done ? 100 : x.progress } : x)));
    try { await toggleGoal(id); } catch {}
  };

  const handleDelete = async (id) => {
    setGoals((g) => g.filter((x) => x.id !== id));
    try { await deleteGoal(id); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="goals-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Target size={17} className="text-purple-300" /> {t("Hedeflerim", "My Goals")}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdding((a) => !a)} data-testid="goal-add-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <Plus size={16} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5"><X size={16} /></button>
          </div>
        </div>

        {adding && (
          <div className="rounded-2xl border border-purple-400/20 p-3 mb-4 space-y-2" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Hedef başlığı", "Goal title")}
              data-testid="goal-input"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Açıklama (opsiyonel)", "Description (optional)")} rows={2}
              data-testid="goal-description-input"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 resize-none" />
            <div className="flex items-center gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="goal-category-select"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white">
                {(categories.length ? categories : Object.keys(CAT_LABELS)).map((c) => (
                  <option key={c} value={c} className="bg-[#0c0818]">{CAT_LABELS[c] ? t(CAT_LABELS[c].tr, CAT_LABELS[c].en) : c}</option>
                ))}
              </select>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} data-testid="goal-deadline-input"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white" />
            </div>
            <button onClick={handleAdd} disabled={!title.trim() || saving} data-testid="goal-add-button"
              className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40">
              {t("Hedefi Kaydet", "Save Goal")}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : goals.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Henüz hedef yok.", "No goals yet.")}</p>
          ) : goals.map((g) => (
            <div key={g.id} data-testid="goal-item" className="rounded-xl border border-white/10 p-3"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-start gap-3">
                <button onClick={() => handleToggle(g.id)} data-testid="goal-toggle-button"
                  className="w-5 h-5 mt-0.5 rounded-md border flex items-center justify-center shrink-0 transition-colors"
                  style={{ borderColor: g.done ? "#c084fc" : "rgba(255,255,255,0.25)", backgroundColor: g.done ? "#c084fc" : "transparent" }}>
                  {g.done && <Check size={12} className="text-black" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm ${g.done ? "text-white/40 line-through" : "text-white/90"}`}>{g.title}</p>
                    <button onClick={() => handleDelete(g.id)} data-testid="goal-delete-button" className="text-white/30 hover:text-red-400 shrink-0"><Trash2 size={13} /></button>
                  </div>
                  {g.description && <p className="text-xs text-white/50 mt-0.5">{g.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-purple-300/60 font-mono uppercase">
                    <span>{CAT_LABELS[g.category] ? t(CAT_LABELS[g.category].tr, CAT_LABELS[g.category].en) : g.category}</span>
                    {g.deadline && <span>· {t("Bitiş", "Due")}: {g.deadline}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input type="range" min={0} max={100} step={5} value={g.progress || 0}
                      onChange={(e) => handleProgress(g.id, Number(e.target.value))}
                      data-testid="goal-progress-slider"
                      className="flex-1 accent-purple-400 h-1" />
                    <span className="text-[10px] font-mono text-white/50 w-8 text-right">{g.progress || 0}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
