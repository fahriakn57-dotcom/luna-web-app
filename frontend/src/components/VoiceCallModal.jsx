import { useEffect, useRef, useState } from "react";
import { X, Keyboard, PhoneOff, Mic, MicOff } from "lucide-react";
import Orb from "@/components/Orb";

const STATUS_LABEL = {
  idle: { tr: "Luna seni dinlemeye hazır", en: "Luna is ready to listen" },
  listening: { tr: "Luna seni dinliyor...", en: "Luna is listening..." },
  thinking: { tr: "Luna düşünüyor...", en: "Luna is thinking..." },
  speaking: { tr: "Luna konuşuyor...", en: "Luna is speaking..." },
};

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function VoiceCallModal({ lang, sending, listening, interim, playingId, lastLunaId, onToggleMic, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const orbState = sending ? "thinking" : listening ? "listening" : playingId && playingId === lastLunaId ? "speaking" : "idle";
  const label = STATUS_LABEL[orbState];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#05040c]" data-testid="voice-call-modal">
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 40% at 50% 0%, rgba(139,92,246,0.16), transparent 70%)" }} />

      <div className="relative flex items-center justify-between px-5 pt-5 shrink-0">
        <span className="font-extrabold tracking-[0.25em] text-white text-lg">LUNA</span>
        <button onClick={onClose} data-testid="voice-call-close-button" aria-label={t("Kapat", "Close")}
          className="w-9 h-9 rounded-full flex items-center justify-center border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <Orb mode="friend" state={orbState} onTrigger={onToggleMic} />

        <div className="text-center">
          <p className="text-lg font-bold text-white">{t(label.tr, label.en)}</p>
          <p className="mt-1 text-sm text-white/45 max-w-xs mx-auto">
            {(listening && interim) || t("Rahatça konuşabilirsin, seni dinliyorum.", "Speak freely, I'm listening.")}
          </p>
        </div>

        <p className="font-mono text-sm text-white/40" data-testid="voice-call-timer">{formatTime(elapsed)}</p>
      </div>

      <div className="relative flex items-center justify-center gap-10 pb-10 pt-2 shrink-0">
        <button onClick={onClose} data-testid="voice-call-continue-text-button"
          className="flex flex-col items-center gap-1.5 text-white/50 hover:text-white transition-colors">
          <span className="w-11 h-11 rounded-full border border-white/15 flex items-center justify-center">
            <Keyboard size={18} />
          </span>
          <span className="text-[11px]">{t("Yazı ile Devam Et", "Continue by Text")}</span>
        </button>

        <button onClick={onToggleMic} data-testid="voice-call-mic-button"
          aria-label={t("Mikrofon", "Microphone")}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
            listening ? "bg-red-500 shadow-[0_0_22px_rgba(239,68,68,0.55)]" : "bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_0_22px_rgba(139,92,246,0.55)]"}`}>
          {listening ? <MicOff size={24} className="text-white" /> : <Mic size={24} className="text-white" />}
        </button>

        <button onClick={onClose} data-testid="voice-call-stop-button"
          className="flex flex-col items-center gap-1.5 text-white/50 hover:text-red-300 transition-colors">
          <span className="w-11 h-11 rounded-full border border-white/15 flex items-center justify-center">
            <PhoneOff size={18} />
          </span>
          <span className="text-[11px]">{t("Sohbeti Durdur", "End Call")}</span>
        </button>
      </div>
    </div>
  );
}
