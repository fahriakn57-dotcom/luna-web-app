import { Mic } from "lucide-react";

// Year-2500 central AI core. Friend = lunar plasma sphere. JARVIS = quantum arc-reactor.
export default function Orb({ mode, state, onTrigger }) {
  const jarvis = mode === "jarvis";
  const a = jarvis ? "6,182,212" : "245,158,11";
  const a2 = jarvis ? "59,130,246" : "236,72,153";

  const speaking = state === "speaking";
  const listening = state === "listening";
  const thinking = state === "thinking";
  const active = speaking || listening;

  const dots = Array.from({ length: 10 });

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: 300, height: 300 }}
      data-testid="ai-orb-avatar"
      data-orb-state={state}
    >
      {/* ambient aura */}
      <div
        className="absolute rounded-full animate-breath"
        style={{
          width: 300, height: 300,
          background: `radial-gradient(circle, rgba(${a},0.28), transparent 62%)`,
          filter: "blur(24px)",
        }}
      />

      {/* ripple rings */}
      {active &&
        [0, 1, 2].map((i) => (
          <span key={i} className="absolute rounded-full"
            style={{
              width: 190, height: 190,
              border: `1px solid rgba(${a},0.5)`,
              animation: `ripple 2.6s ease-out ${i * 0.65}s infinite`,
            }} />
        ))}

      {/* outer gyroscope ring */}
      <div className="absolute rounded-full animate-spin-slow"
        style={{
          width: 280, height: 280,
          border: `1px ${jarvis ? "dashed" : "solid"} rgba(${a},0.3)`,
          borderRadius: jarvis ? "44%" : "50%",
        }} />
      {/* mid ring */}
      <div className="absolute animate-spin-rev"
        style={{
          width: 236, height: 236,
          borderTop: `2px solid rgba(${a},0.75)`,
          borderRight: `2px solid rgba(${a2},0.15)`,
          borderBottom: `2px solid rgba(${a2},0.45)`,
          borderLeft: "2px solid transparent",
          borderRadius: jarvis ? "40%" : "50%",
          boxShadow: `0 0 22px rgba(${a},0.25)`,
        }} />
      {/* inner ring */}
      <div className="absolute animate-spin-med"
        style={{
          width: 194, height: 194,
          border: `1px solid rgba(${a},0.2)`,
          borderTopColor: `rgba(${a},0.6)`,
          borderRadius: jarvis ? "34%" : "50%",
        }} />

      {/* jarvis reticle crosshair */}
      {jarvis && (
        <>
          <div className="absolute" style={{ width: 300, height: 1, background: `rgba(${a},0.18)` }} />
          <div className="absolute" style={{ width: 1, height: 300, background: `rgba(${a},0.18)` }} />
        </>
      )}

      {/* orbiting particles */}
      {dots.map((_, i) => {
        const r = 96 + (i % 3) * 12;
        return (
          <span key={i} className="orbit-dot"
            style={{
              "--orbit-r": `${r}px`,
              width: 4, height: 4,
              background: `rgba(${i % 2 ? a2 : a}, 0.9)`,
              boxShadow: `0 0 8px rgba(${a},0.9)`,
              animationDuration: `${10 + (i % 5) * 3}s`,
              animationDirection: i % 2 ? "reverse" : "normal",
              animationDelay: `${i * -1.3}s`,
            }} />
        );
      })}

      {/* core button */}
      <button
        onClick={onTrigger}
        data-testid="orb-mic-trigger"
        aria-label="Konuşmak için dokun / Tap to speak"
        className={`relative z-10 rounded-full flex items-center justify-center transition-transform duration-300 ${
          thinking ? "animate-breath" : "animate-floaty"
        } ${speaking ? "scale-[1.08]" : "hover:scale-105 active:scale-95"}`}
        style={{
          width: 156, height: 156,
          background: jarvis
            ? `radial-gradient(circle at 50% 42%, rgba(255,255,255,0.95), rgba(${a},0.85) 30%, rgba(2,6,16,0.96) 74%)`
            : `radial-gradient(circle at 40% 34%, #fff7ed, rgba(${a},0.95) 40%, rgba(${a2},0.7) 62%, rgba(10,8,18,0.92) 92%)`,
          boxShadow: `0 0 70px rgba(${a},0.55), inset 0 0 46px rgba(${a},0.4), inset 0 -18px 40px rgba(0,0,0,0.55)`,
          cursor: "pointer",
        }}
      >
        {/* specular highlight */}
        <span className="absolute rounded-full"
          style={{
            width: 44, height: 30, top: 26, left: 40,
            background: "radial-gradient(circle, rgba(255,255,255,0.85), transparent 70%)",
            filter: "blur(4px)",
          }} />

        {speaking ? (
          <div className="flex items-end gap-1 h-10 relative z-10">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="eq-bar"
                style={{ background: "#fff", animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        ) : (
          <Mic className="text-white/95 drop-shadow-lg relative z-10" size={36}
            strokeWidth={listening ? 2.6 : 1.6} />
        )}
      </button>
    </div>
  );
}
