import { X, Gauge } from "lucide-react";

const MOODS = [
  { key: "great", emoji: "😄", tr: "Harika", en: "Great", color: "#4ade80" },
  { key: "good", emoji: "🙂", tr: "İyi", en: "Good", color: "#60a5fa" },
  { key: "neutral", emoji: "😐", tr: "Nötr", en: "Neutral", color: "#a1a1aa" },
  { key: "tired", emoji: "😴", tr: "Yorgun", en: "Tired", color: "#c084fc" },
  { key: "bad", emoji: "☹️", tr: "Kötü", en: "Bad", color: "#f87171" },
];

// Same mood picker that used to live in FriendPanel's right column — now its
// own sidebar-reachable panel so it's available on mobile too (the right
// column never showed there).
export default function MoodPanel({ lang, mood, setMood, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="mood-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Gauge size={17} className="text-purple-300" /> {t("Nasıl hissediyorsun?", "How are you feeling?")}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-white/40 mb-4">{t("Ruh halini seç, seni daha iyi anlayayım.", "Pick a mood so I understand you better.")}</p>

        <div className="grid grid-cols-5 gap-2">
          {MOODS.map((m) => {
            const active = mood === m.key;
            return (
              <button key={m.key} data-testid={`mood-${m.key}`} onClick={() => setMood(m.key)}
                className="flex flex-col items-center gap-1.5 py-2 rounded-2xl border text-[10px] font-semibold transition-all duration-200"
                style={{
                  borderColor: active ? m.color : "rgba(255,255,255,0.08)",
                  backgroundColor: active ? `${m.color}22` : "rgba(255,255,255,0.02)",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.45)",
                  transform: active ? "translateY(-3px) scale(1.04)" : "none",
                  boxShadow: active ? `0 6px 20px ${m.color}55` : "none",
                }}>
                <span className="flex items-center justify-center rounded-full transition-all duration-200"
                  style={{
                    width: 34, height: 34, fontSize: 20, lineHeight: 1,
                    backgroundColor: active ? `${m.color}33` : "rgba(255,255,255,0.05)",
                    boxShadow: active ? `0 0 16px ${m.color}88, inset 0 0 0 1px ${m.color}66` : "none",
                    filter: active ? "none" : "grayscale(45%) opacity(0.7)",
                    transform: active ? "scale(1.08)" : "scale(1)",
                  }}>
                  {m.emoji}
                </span>
                {t(m.tr, m.en)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
