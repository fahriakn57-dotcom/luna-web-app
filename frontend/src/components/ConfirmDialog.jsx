import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";

// Hand-rolled confirm dialog in the same style as PairDeviceModal /
// CheckoutModal — the shadcn alert-dialog in components/ui renders with the
// light theme tokens (white card) and at z-50, i.e. BEHIND every z-[90]+
// panel it would be opened from. z-[120] keeps it above SettingsPanel
// (z-[90]), the Sidebar (z-[97]/[98]) and even CheckoutModal (z-[110]).
// It's portaled to <body>: rendered in place, the z-index would only count
// inside the opening panel's own stacking context (SettingsPanel's fixed
// z-[90] overlay), leaving the Sidebar clickable on top of the dialog.
//
// While `busy` the dialog can't be dismissed (overlay click, Escape, cancel
// are all ignored) so a destructive request that's already in flight never
// looks "cancelled" when it actually went through.
export default function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel, danger = false, busy = false, onConfirm, onCancel,
}) {
  const cancelRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  // Latest busy/onCancel for the Escape listener below, so it subscribes
  // once per open instead of on every render (callers pass inline onCancel).
  const stateRef = useRef({ busy, onCancel });
  stateRef.current = { busy, onCancel };

  // Focus the SAFE action on open, so a stray Enter/Space never confirms.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!stateRef.current.busy) stateRef.current.onCancel?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const cancel = (e) => {
    // Stop here too — React still bubbles a portal's events up through the
    // component tree, i.e. into the panel that opened this dialog, whose
    // own overlay closes that panel on click.
    e.stopPropagation();
    if (!busy) onCancel?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={cancel} data-testid="confirm-dialog">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-sm rounded-2xl border p-6 bg-[#130f21] ${danger ? "border-red-400/25" : "border-purple-400/20"}`}
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-start gap-3 mb-3">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: danger ? "rgba(248,113,113,0.12)" : "rgba(192,132,252,0.12)" }}>
            <AlertTriangle size={16} className={danger ? "text-red-300" : "text-purple-300"} />
          </span>
          <h2 id={titleId} className="text-sm font-bold text-white leading-snug pt-2">{title}</h2>
        </div>

        <div id={bodyId} className="text-xs text-white/65 leading-relaxed mb-5">{body}</div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={cancel} disabled={busy} data-testid="confirm-dialog-cancel"
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white/70 border border-white/15 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-40">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} data-testid="confirm-dialog-confirm"
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60 ${danger ? "bg-red-500/90" : ""}`}
            style={danger ? undefined : { background: "linear-gradient(90deg,#6366f1,#c084fc)" }}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
