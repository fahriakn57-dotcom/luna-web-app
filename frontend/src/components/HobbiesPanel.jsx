import { useEffect, useState } from "react";
import { X, Plus, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { fetchProfile, updateProfile } from "@/lib/api";

const SUGGESTIONS = {
  tr: ["Kitap okumak", "Spor", "Müzik", "Yemek yapmak", "Seyahat", "Oyun", "Sanat", "Fotoğrafçılık"],
  en: ["Reading", "Sports", "Music", "Cooking", "Travel", "Gaming", "Art", "Photography"],
};

export default function HobbiesPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [hobbies, setHobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfile().then((p) => setHobbies(p.profile?.interests || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const persist = async (next) => {
    setSaving(true);
    try {
      await updateProfile({ interests: next });
    } catch {
      toast.error(t("Kaydedilemedi", "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };

  const addHobby = (raw) => {
    const value = raw.trim();
    if (!value) return;
    if (hobbies.some((h) => h.toLowerCase() === value.toLowerCase())) { setInput(""); return; }
    const next = [...hobbies, value];
    setHobbies(next);
    setInput("");
    persist(next);
  };

  const removeHobby = (value) => {
    const next = hobbies.filter((h) => h !== value);
    setHobbies(next);
    persist(next);
  };

  const suggestions = (SUGGESTIONS[lang] || SUGGESTIONS.en).filter(
    (s) => !hobbies.some((h) => h.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="hobbies-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Sparkles size={17} className="text-purple-300" /> {t("Hobilerim", "My Hobbies")}
          </h2>
          <button onClick={onClose} data-testid="hobbies-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-white/40 mb-4">
          {t("Sevdiğin şeyleri ekle, Luna seni daha iyi tanısın ve sohbetlerinde bunları göz önünde bulundursun.", "Add what you love — Luna will get to know you better and factor these into your conversations.")}
        </p>

        <div className="flex items-center gap-2 mb-4">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHobby(input)}
            placeholder={t("Bir hobi yaz ve Enter'a bas...", "Type a hobby and press Enter...")}
            data-testid="hobby-input"
            className="flex-1 bg-black/25 outline-none px-4 py-2.5 rounded-full border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
          <button onClick={() => addHobby(input)} disabled={!input.trim() || saving} data-testid="hobby-add-button"
            className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white disabled:opacity-40 shrink-0">
            <Plus size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Yükleniyor...", "Loading...")}</p>
          ) : hobbies.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">{t("Henüz hobi eklemedin.", "You haven't added any hobbies yet.")}</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-5">
              {hobbies.map((h) => (
                <span key={h} data-testid="hobby-chip"
                  className="group flex items-center gap-1.5 pl-3.5 pr-2 py-1.5 rounded-full text-xs font-semibold border border-purple-400/30 text-purple-100"
                  style={{ backgroundColor: "rgba(192,132,252,0.12)" }}>
                  {h}
                  <button onClick={() => removeHobby(h)} data-testid="hobby-remove-button"
                    className="w-4 h-4 rounded-full flex items-center justify-center text-purple-200/60 hover:text-red-300 hover:bg-black/25 transition-colors">
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/30 mb-2">{t("Öneriler", "Suggestions")}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => addHobby(s)} data-testid="hobby-suggestion"
                    className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/50 hover:text-white hover:border-purple-400/30 transition-colors">
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
