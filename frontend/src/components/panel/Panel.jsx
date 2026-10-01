import { useEffect, useId, useRef } from "react";
import { X, RefreshCw } from "lucide-react";

// Shared shell + building blocks for the sidebar panels (Günlük, Anılarım,
// Ruh Halim, Günün Anlamı, Hobilerim, Hedefler, Notlar, Alarmlar, Kullanım,
// Ayarlar) so they read as one product: same surface, header, spacing,
// chips, empty/loading/error states. On phones the panel is a bottom sheet;
// from `sm` up it's a centred card.

// Each panel has one accent — used for its icon tile and the faint glow at
// the top of the card. Primary actions everywhere keep the brand gradient.
export const ACCENTS = {
  violet: { fg: "#c4b5fd", tile: "rgba(167,139,250,0.14)", glow: "rgba(167,139,250,0.16)", ring: "rgba(196,181,253,0.45)" },
  rose: { fg: "#fda4af", tile: "rgba(251,113,133,0.13)", glow: "rgba(244,114,182,0.14)", ring: "rgba(253,164,175,0.45)" },
  fuchsia: { fg: "#f0abfc", tile: "rgba(232,121,249,0.13)", glow: "rgba(217,70,239,0.15)", ring: "rgba(240,171,252,0.45)" },
  amber: { fg: "#fcd34d", tile: "rgba(251,191,36,0.12)", glow: "rgba(251,191,36,0.12)", ring: "rgba(252,211,77,0.45)" },
  emerald: { fg: "#6ee7b7", tile: "rgba(52,211,153,0.12)", glow: "rgba(16,185,129,0.13)", ring: "rgba(110,231,183,0.45)" },
  sky: { fg: "#7dd3fc", tile: "rgba(56,189,248,0.12)", glow: "rgba(14,165,233,0.14)", ring: "rgba(125,211,252,0.45)" },
  teal: { fg: "#5eead4", tile: "rgba(45,212,191,0.12)", glow: "rgba(20,184,166,0.13)", ring: "rgba(94,234,212,0.45)" },
  indigo: { fg: "#a5b4fc", tile: "rgba(129,140,248,0.14)", glow: "rgba(99,102,241,0.16)", ring: "rgba(165,180,252,0.45)" },
};

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-xl",
  xl: "sm:max-w-2xl",
  "2xl": "sm:max-w-3xl",
};

// Field styles shared by every panel form.
export const fieldClass =
  "w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-white " +
  "placeholder:text-white/30 outline-none transition-colors " +
  "focus:border-violet-300/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-violet-400/10 " +
  "disabled:opacity-50";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white " +
  "bg-gradient-to-r from-indigo-500 to-fuchsia-500 shadow-[0_8px_24px_-8px_rgba(192,38,211,0.55)] " +
  "transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-violet-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a1a] " +
  "disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-none disabled:bg-white/[0.06] " +
  "disabled:text-white/35 disabled:shadow-none disabled:active:scale-100";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold " +
  "text-white/75 border border-white/[0.12] bg-white/[0.03] transition-colors hover:bg-white/[0.07] hover:text-white " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-40";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold " +
  "text-white/55 transition-colors hover:text-white hover:bg-white/[0.06] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60";

// The modal shell. Escape closes it unless a ConfirmDialog (role=alertdialog,
// portaled to <body>) is open on top — that dialog handles its own Escape.
export function Panel({ onClose, size = "md", accent = "violet", labelledBy, testId, children, onOverlayClose }) {
  const cardRef = useRef(null);
  const pressStartedOnOverlay = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tone = ACCENTS[accent] || ACCENTS.violet;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    // Focus the card itself (not the first field) so a screen reader
    // announces the dialog and Escape works straight away.
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  // A press that starts inside the card and ends on the overlay (e.g.
  // selecting text and overshooting) must not close the panel.
  const onOverlayDown = (e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; };
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget && pressStartedOnOverlay.current) (onOverlayClose || onClose)?.();
    pressStartedOnOverlay.current = false;
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-[#05030b]/70 backdrop-blur-[6px] sm:px-4 sm:py-6 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      onMouseDown={onOverlayDown} onClick={onOverlayClick} data-testid={testId}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}
        className={`relative w-full ${SIZES[size] || SIZES.md} max-h-[92dvh] sm:max-h-[86vh] flex flex-col overflow-hidden
          rounded-t-[28px] sm:rounded-[28px] border border-white/[0.09] outline-none
          animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 sm:zoom-in-[0.98] fade-in-0 duration-300 motion-reduce:animate-none`}
        style={{
          background: `radial-gradient(120% 60% at 0% 0%, ${tone.glow}, transparent 55%), linear-gradient(180deg, #120d22 0%, #0b0817 100%)`,
          boxShadow: "0 30px 80px -24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}>
        <div aria-hidden="true" className="sm:hidden mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-white/15" />
        {children}
      </div>
    </div>
  );
}

// Header: accent icon tile, title (+ optional subtitle), actions, close.
export function PanelHeader({ icon: Icon, accent = "violet", title, subtitle, titleId, actions, onClose, closeLabel, closeTestId }) {
  const tone = ACCENTS[accent] || ACCENTS.violet;
  return (
    <div className="flex items-start gap-3.5 px-5 sm:px-6 pt-4 sm:pt-6 pb-4 shrink-0">
      {Icon && (
        <span className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: tone.tile, boxShadow: `inset 0 0 0 1px ${tone.tile}` }}>
          <Icon size={19} style={{ color: tone.fg }} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em] text-white leading-tight [text-wrap:balance]">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] leading-snug text-white/50">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {actions}
        {onClose && (
          <IconButton label={closeLabel || "Kapat"} onClick={onClose} testId={closeTestId}>
            <X size={17} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

// Scrolling body. `className` adds spacing between direct children.
export function PanelBody({ children, className = "" }) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${className}`}>
      {children}
    </div>
  );
}

// Round icon button. variant: "ghost" (default) | "primary" | "soft".
export function IconButton({ label, onClick, children, variant = "ghost", size = 36, disabled, testId, type = "button", pressed }) {
  const base = "inline-flex items-center justify-center rounded-full shrink-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:cursor-not-allowed";
  const styles = {
    ghost: "text-white/45 hover:text-white hover:bg-white/[0.07] disabled:opacity-40",
    soft: "text-white/70 bg-white/[0.05] border border-white/10 hover:bg-white/[0.09] hover:text-white disabled:opacity-40",
    primary: "text-white bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_6px_18px_-6px_rgba(192,38,211,0.6)] hover:brightness-110 active:scale-95 disabled:opacity-40",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={pressed}
      data-testid={testId} className={`${base} ${styles[variant] || styles.ghost}`} style={{ width: size, height: size }}>
      {children}
    </button>
  );
}

// Filter chip. `count` renders as a quiet number after the label.
export function Chip({ active, onClick, icon: Icon, count, children, testId, color }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active} data-testid={testId}
      className={`inline-flex items-center gap-1.5 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
        active
          ? "border-violet-300/40 bg-violet-400/[0.14] text-white"
          : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.05]"
      }`}>
      {Icon && <Icon size={13} aria-hidden="true" style={color ? { color } : undefined} />}
      <span>{children}</span>
      {typeof count === "number" && (
        <span className={`tabular-nums ${active ? "text-white/70" : "text-white/35"}`}>{count}</span>
      )}
    </button>
  );
}

// Horizontal chip rail — scrolls sideways on phones instead of wrapping into
// a wall of pills.
export function ChipRail({ children, label }) {
  return (
    <div role="group" aria-label={label}
      className="-mx-5 sm:-mx-6 px-5 sm:px-6 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
      {children}
    </div>
  );
}

// Segmented control. options: [{ value, label, icon?, count? }]
export function Segmented({ options, value, onChange, label, size = "md", testIdPrefix }) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-[13px]";
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full rounded-full border border-white/[0.08] bg-black/30 p-1 gap-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${pad} ${
              active ? "bg-white/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-white/50 hover:text-white/80"
            }`}>
            {Icon && <Icon size={14} aria-hidden="true" />}
            {o.label}
            {typeof o.count === "number" && <span className={`tabular-nums ${active ? "text-white/60" : "text-white/30"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Small sentence-case section heading inside a panel body.
export function SectionLabel({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2.5">
      <h3 className="text-xs font-semibold text-white/45">{children}</h3>
      {action}
    </div>
  );
}

// Empty state: an inviting next step, not just "nothing here".
export function EmptyState({ icon: Icon, accent = "violet", title, body, action, compact }) {
  const tone = ACCENTS[accent] || ACCENTS.violet;
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "py-6" : "py-10"} px-4`}>
      {Icon && (
        <span className="relative w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: tone.tile, boxShadow: `0 0 0 6px ${tone.tile.replace(/[\d.]+\)$/, "0.05)")}` }}>
          <Icon size={24} style={{ color: tone.fg }} aria-hidden="true" />
        </span>
      )}
      <p className="text-[15px] font-semibold text-white">{title}</p>
      {body && <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-white/50">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Loading placeholder rows shaped like list cards.
export function SkeletonList({ rows = 3, label = "Yükleniyor" }) {
  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="h-3 rounded-full bg-white/[0.08] animate-pulse motion-reduce:animate-none" style={{ width: `${70 - i * 12}%` }} />
          <div className="mt-2.5 h-3 rounded-full bg-white/[0.06] animate-pulse motion-reduce:animate-none" style={{ width: `${45 + i * 9}%` }} />
        </div>
      ))}
    </div>
  );
}

// Load failure with a retry — never a silent empty list.
export function ErrorState({ title, body, onRetry, retryLabel }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4" role="alert">
      {title && <p className="text-[15px] font-semibold text-white">{title}</p>}
      {body && <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-white/50">{body}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${secondaryButtonClass} mt-5`}>
          <RefreshCw size={14} aria-hidden="true" /> {retryLabel}
        </button>
      )}
    </div>
  );
}

// Stable id for aria-labelledby without each panel calling useId itself.
export function usePanelTitleId() {
  return useId();
}
