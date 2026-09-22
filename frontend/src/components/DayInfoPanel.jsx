import { useEffect, useState } from "react";
import { X, CalendarHeart } from "lucide-react";
import { fetchDayInfo } from "@/lib/api";

// Same "Günün Anlam ve Önemi" card that used to live in FriendPanel's right
// column — now its own sidebar-reachable panel so it's available on mobile
// too (the right column never showed there).
export default function DayInfoPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [dayInfo, setDayInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const todayLabel = new Date().toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "long", year: "numeric" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDayInfo(lang).then((d) => {
      if (!cancelled) setDayInfo(d);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [lang]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="day-info-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <CalendarHeart size={17} className="text-indigo-300" /> {t("Günün Anlam ve Önemi", "Today's Significance")}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-white/40 mb-3 capitalize">{todayLabel}</p>

        {loading ? (
          <div className="space-y-2">
            <div className="h-2.5 rounded-full bg-white/10 animate-pulse w-full" />
            <div className="h-2.5 rounded-full bg-white/10 animate-pulse w-4/5" />
            <div className="h-2.5 rounded-full bg-white/10 animate-pulse w-3/5" />
          </div>
        ) : (
          <p className="text-sm text-white/70 leading-relaxed">
            {dayInfo?.text || t("Bugün için özel bir not bulunamadı, ama her gün yeni bir başlangıç 🌙", "No special note for today, but every day is a fresh start 🌙")}
          </p>
        )}
      </div>
    </div>
  );
}
