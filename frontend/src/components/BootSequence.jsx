import { useEffect, useState } from "react";
import lunaLogo from "@/assets/luna-logo.png";
import lunaBg from "@/assets/luna-bg.jpg";

const LINES_TR = [
  "KUANTUM ÇEKİRDEK BAŞLATILIYOR",
  "NÖRAL AĞ SENKRONİZE EDİLİYOR",
  "SES MATRİSİ KALİBRE EDİLİYOR",
  "LUNA KİŞİLİK MODÜLÜ YÜKLENİYOR",
  "GÜVENLİ BAĞLANTI KURULDU",
];
const LINES_EN = [
  "INITIALIZING QUANTUM CORE",
  "SYNCHRONIZING NEURAL NET",
  "CALIBRATING VOICE MATRIX",
  "LOADING LUNA PERSONA MODULE",
  "SECURE LINK ESTABLISHED",
];

export default function BootSequence({ lang, onDone }) {
  const lines = lang === "tr" ? LINES_TR : LINES_EN;
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);
  const pct = Math.round(((step + 1) / lines.length) * 100);

  useEffect(() => {
    const iv = setInterval(() => {
      setStep((s) => {
        if (s >= lines.length - 1) {
          clearInterval(iv);
          setTimeout(() => setExiting(true), 500);
          setTimeout(onDone, 1100);
          return s;
        }
        return s + 1;
      });
    }, 420);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid="boot-sequence"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#050212] transition-opacity duration-500"
      style={{ opacity: exiting ? 0 : 1 }}
    >
      {/* space/planet background */}
      <div className="absolute inset-0 bg-cover bg-bottom" style={{ backgroundImage: `url(${lunaBg})` }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(60% 50% at 50% 38%, rgba(5,2,18,0.55) 0%, rgba(5,2,18,0.8) 55%, rgba(5,2,18,0.92) 100%)" }} />

      <div className="absolute top-6 left-6 flex items-center gap-2 text-[10px] tracking-[0.25em] text-purple-300/60 font-mono uppercase">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400/70" /> XSF Technology
      </div>
      <div className="absolute top-6 right-6 text-[10px] tracking-[0.2em] text-purple-300/40 font-mono">v1.0.0</div>

      {/* pulsing moon core */}
      <div className="relative mb-4 flex items-center justify-center" style={{ width: 140, height: 140 }}>
        <div className="absolute rounded-full animate-breath"
          style={{ width: 140, height: 140, background: "radial-gradient(circle, rgba(168,85,247,0.4), transparent 65%)", filter: "blur(14px)" }} />
        <div className="absolute rounded-full animate-spin-slow" style={{ width: 122, height: 122, border: "1px solid rgba(168,85,247,0.3)" }} />
        <div className="absolute rounded-full" style={{ width: 100, height: 100, border: "1px dashed rgba(168,85,247,0.35)" }} />
        <img src={lunaLogo} alt="Luna" className="relative w-[76px] h-[76px] rounded-full object-cover animate-breath"
          style={{ boxShadow: "0 0 40px rgba(168,85,247,0.7)" }} />
      </div>

      <div className="relative mb-1.5">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-[0.3em] text-white"
          style={{ textShadow: "0 0 24px rgba(192,132,252,0.8), 0 0 60px rgba(139,92,246,0.5)" }}>
          LUNA
        </h1>
        <span className="absolute top-0 right-[0.55em] w-1 h-1 rounded-full bg-purple-300" />
      </div>

      <div style={{
        position: "relative", zIndex: 10, display: "inline-block",
        padding: "6px 18px", borderRadius: 999,
        backgroundColor: "rgba(18,10,32,0.6)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(192,132,252,0.25)", boxShadow: "0 4px 24px rgba(0,0,0,0.35)", marginBottom: 14,
      }}>
        <span style={{ position: "relative", zIndex: 11, fontFamily: "monospace", fontSize: 11, letterSpacing: 2.5, color: "rgba(255,255,255,0.92)", textTransform: "uppercase" }}>
          {lang === "tr" ? "LUNA KİŞİLİK MODÜLÜ YÜKLENİYOR" : "LOADING LUNA PERSONA MODULE"}
        </span>
      </div>

      <div style={{
        position: "relative", zIndex: 10, width: 250,
        backgroundColor: "rgba(18,10,32,0.6)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(192,132,252,0.2)", borderRadius: 18,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
        padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ height: 8, flex: 1, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 999, width: `${pct}%`,
              transition: "width 0.4s ease", background: "linear-gradient(90deg,#818cf8,#e879f9)",
              boxShadow: "0 0 14px rgba(192,132,252,0.9)",
            }} />
          </div>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "rgba(255,255,255,0.85)", width: 36, textAlign: "right" }}>{pct}%</span>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 1, color: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: "#c084fc", flexShrink: 0, boxShadow: "0 0 6px rgba(192,132,252,0.8)" }} />
          <span>{lines[step]}</span>
          <span className="animate-pulse">_</span>
        </div>
      </div>

      <button onClick={onDone} data-testid="boot-skip-button"
        className="mt-6 text-[10px] font-mono tracking-[0.25em] text-purple-400/50 hover:text-purple-200 transition-colors uppercase">
        {lang === "tr" ? "GEÇ →" : "SKIP →"}
      </button>

      <div className="absolute bottom-6 flex items-center gap-2 text-[9px] tracking-[0.25em] text-purple-300/35 font-mono uppercase">
        XSF Technology
      </div>
    </div>
  );
}
