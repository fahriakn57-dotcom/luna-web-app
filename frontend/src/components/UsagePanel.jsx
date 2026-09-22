import { useCallback, useEffect, useState } from "react";
import { X, Gauge, RefreshCw } from "lucide-react";
import { fetchUsage } from "@/lib/api";

// Same "Günlük Kullanım" card that used to live in FriendPanel's right
// column — now its own sidebar-reachable panel so it's available on mobile
// too (the right column never showed there).
export default function UsagePanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchUsage()
      .then((u) => setUsage(u))
      .catch((e) => {
        // Swallowing this silently is exactly what made the old "Kullanım
        // bilgisi alınamadı" dead end impossible to diagnose — log the real
        // reason (network blip, 401 before device registration lands, a
        // stale token, etc.) and let the person retry instead of leaving
        // them stuck.
        console.error("fetchUsage failed:", e);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = usage ? [
    { key: "chat", label: t("Mesajlar", "Messages") },
    { key: "voice", label: t("Sesli Yanıt", "Voice") },
  ].map(({ key, label }) => {
    const u = usage[key];
    if (!u) return null;
    const unlimited = u.limit >= 10 ** 9;
    const pct = unlimited ? 0 : Math.min(100, Math.round((u.used / Math.max(u.limit, 1)) * 100));
    return { key, label, unlimited, pct, used: u.used, limit: u.limit };
  }).filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="usage-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Gauge size={17} className="text-emerald-300" /> {t("Günlük Kullanım", "Daily Usage")}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="space-y-4 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 rounded-full bg-white/10 animate-pulse" />
                  <div className="h-3 w-10 rounded-full bg-white/10 animate-pulse" />
                </div>
                <div className="h-1.5 rounded-full bg-white/10 animate-pulse" />
              </div>
            ))}
          </div>
        ) : failed ? (
          <div className="text-center py-6">
            <p className="text-xs text-white/50 mb-3">{t("Kullanım bilgisi alınamadı — bağlantıda geçici bir sorun olabilir.", "Couldn't load usage — might be a temporary connection issue.")}</p>
            <button onClick={load} data-testid="usage-retry-button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-300 hover:text-white transition-colors">
              <RefreshCw size={13} /> {t("Tekrar dene", "Retry")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map(({ key, label, unlimited, pct, used, limit }) => (
              <div key={key}>
                <div className="flex items-center justify-between text-xs text-white/70 mb-1.5">
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-white/45">{unlimited ? t("Sınırsız", "Unlimited") : `${used} / ${limit} · %${pct}`}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all"
                    style={{ width: `${unlimited ? 100 : pct}%`, opacity: unlimited ? 0.35 : 1 }} />
                </div>
              </div>
            ))}
            <div className="pt-3 mt-1 border-t border-white/10 flex items-center justify-between">
              <span className="text-[11px] text-white/35">{t("Plan", "Plan")}</span>
              <span className="text-[11px] font-semibold text-purple-200 capitalize">{usage.plan}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
