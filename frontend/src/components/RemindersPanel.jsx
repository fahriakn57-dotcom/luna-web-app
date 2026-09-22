import { useEffect, useState } from "react";
import { X, Bell, Trash2, Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { fetchReminders, createReminder, cancelReminder } from "@/lib/api";

const RECURRENCE_LABELS = {
  none: { tr: "Tek seferlik", en: "One-time" },
  daily: { tr: "Her gün", en: "Daily" },
  weekly: { tr: "Her hafta", en: "Weekly" },
  monthly: { tr: "Her ay", en: "Monthly" },
};

function formatDue(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function RemindersPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [recurrence, setRecurrence] = useState("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReminders().then(setReminders).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    const content = text.trim();
    if (!content || !date || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(`${date}T${time || "09:00"}:00`);
      if (isNaN(dueAt)) throw new Error("invalid date");
      const reminder = await createReminder({ text: content, due_at: dueAt.toISOString(), recurrence });
      setReminders((r) => [...r, reminder].sort((a, b) => a.due_at.localeCompare(b.due_at)));
      setText(""); setDate(""); setTime("09:00"); setRecurrence("none"); setAdding(false);
      toast.success(t("Hatırlatma oluşturuldu", "Reminder created"));
    } catch {
      toast.error(t("Hatırlatma oluşturulamadı", "Couldn't create reminder"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id) => {
    setReminders((r) => r.filter((x) => x.id !== id));
    try { await cancelReminder(id); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="reminders-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Bell size={17} className="text-purple-300" /> {t("Alarmlar", "Reminders")}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdding((a) => !a)} data-testid="reminder-add-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <Plus size={16} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5"><X size={16} /></button>
          </div>
        </div>
        <p className="text-[11px] text-white/40 mb-3">
          {t("Luna'ya sohbette \"yarın saat 15'te hatırlat\" diye de yazabilirsin.", "You can also just tell Luna \"remind me tomorrow at 3pm\" in chat.")}
        </p>

        {adding && (
          <div className="rounded-2xl border border-purple-400/20 p-3 mb-3 space-y-2" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Ne hatırlatayım?", "What should I remind you of?")}
              data-testid="reminder-text-input"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <div className="flex items-center gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="reminder-date-input"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="reminder-time-input"
                className="flex-1 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white" />
            </div>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} data-testid="reminder-recurrence-select"
              className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 text-xs text-white">
              {Object.entries(RECURRENCE_LABELS).map(([k, v]) => (
                <option key={k} value={k} className="bg-[#0c0818]">{t(v.tr, v.en)}</option>
              ))}
            </select>
            <button onClick={handleAdd} disabled={!text.trim() || !date || saving} data-testid="reminder-save-button"
              className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40">
              {t("Hatırlatmayı Kaydet", "Save Reminder")}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : reminders.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Aktif hatırlatman yok.", "No active reminders.")}</p>
          ) : reminders.map((r) => (
            <div key={r.id} data-testid="reminder-item" className="rounded-xl border border-white/10 p-3 flex items-start justify-between gap-2"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
              <div>
                <p className="text-sm text-white/85">{r.text}</p>
                <p className="text-[11px] text-purple-300/70 mt-0.5 flex items-center gap-1.5">
                  {formatDue(r.due_at, lang)}
                  {r.recurrence && r.recurrence !== "none" && (
                    <span className="flex items-center gap-0.5 text-emerald-300/70"><Repeat size={10} /> {t(RECURRENCE_LABELS[r.recurrence]?.tr, RECURRENCE_LABELS[r.recurrence]?.en)}</span>
                  )}
                </p>
              </div>
              <button onClick={() => handleCancel(r.id)} data-testid="reminder-cancel-button"
                className="text-white/30 hover:text-red-400 shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
