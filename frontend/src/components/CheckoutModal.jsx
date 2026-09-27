import { useMemo, useState } from "react";
import { X, Lock } from "lucide-react";

// 2026-09-27: rewritten for PayTR (replaces iyzico's hosted-iframe embed —
// see git history for the old IyzicoEmbed version). PayTR's card-storage +
// recurring-payment feature only comes via their Direkt API, which means
// (unlike iyzico's fully hosted Checkout Form) WE render the card fields
// ourselves. Card data still never reaches Luna's backend — this <form>'s
// `action` is PayTR's own endpoint (formFields.action_url), so the browser
// POSTs card_number/cvv/expiry DIRECTLY to PayTR, not through our server
// (see backend/luna/services/paytr_service.py's docstring for the fuller
// PCI-scope note: this is PCI-DSS SAQ-A-EP, not iyzico's SAQ-A, because we
// authored the JS that collects the card — still never touches our server).

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const YEARS = Array.from({ length: 12 }, (_, i) => String(new Date().getFullYear() + i));

function formatCardNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

export default function CheckoutModal({ lang, formFields, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [ccOwner, setCcOwner] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryMonth, setExpiryMonth] = useState(MONTHS[0]);
  const [expiryYear, setExpiryYear] = useState(YEARS[0]);
  const [cvv, setCvv] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cardDigits = useMemo(() => cardNumber.replace(/\D/g, ""), [cardNumber]);
  const canSubmit = ccOwner.trim().length > 1 && cardDigits.length >= 13 && cvv.length >= 3 && !submitting;

  // A real <form> POST (not fetch/axios) — PayTR's flow redirects the
  // browser itself through processing and back to merchant_ok_url/
  // merchant_fail_url (see routers/subscription.py::checkout), which a
  // fetch-based submit can't follow the way a top-level navigation can.
  const handleSubmit = (e) => {
    if (!canSubmit) { e.preventDefault(); return; }
    setSubmitting(true);
    // Let the native form submission proceed — no preventDefault here.
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={onClose} data-testid="checkout-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-5"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">{t("Güvenli Ödeme (PayTR)", "Secure Payment (PayTR)")}</p>
          <button onClick={onClose} data-testid="checkout-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        <form method="POST" action={formFields?.action_url} onSubmit={handleSubmit} data-testid="checkout-card-form">
          {/* Signed, non-card fields the backend already computed (paytr_token,
              merchant_id, merchant_oid, amount, etc.) — passed through as-is. */}
          {Object.entries(formFields || {})
            .filter(([key]) => key !== "action_url")
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}

          <label className="block text-[11px] text-white/50 mb-1 mt-1">{t("Kart Üzerindeki İsim", "Name on Card")}</label>
          <input required name="cc_owner" value={ccOwner} onChange={(e) => setCcOwner(e.target.value)}
            placeholder={t("Ad Soyad", "Full Name")} data-testid="card-owner-input" autoComplete="cc-name"
            className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />

          <label className="block text-[11px] text-white/50 mb-1 mt-2.5">{t("Kart Numarası", "Card Number")}</label>
          {/* No `name` here on purpose — this is the spaced DISPLAY value the
              user types into; only the hidden input below (raw digits, no
              spaces) is actually submitted as `card_number`. Two inputs
              sharing that name would submit both values to PayTR. */}
          <input required value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number"
            data-testid="card-number-input"
            className="w-full bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 tracking-wider" />
          <input type="hidden" name="card_number" value={cardDigits} />

          <div className="grid grid-cols-3 gap-2.5 mt-2.5">
            <div>
              <label className="block text-[11px] text-white/50 mb-1">{t("Ay", "Month")}</label>
              <select name="expiry_month" value={expiryMonth} onChange={(e) => setExpiryMonth(e.target.value)}
                data-testid="card-expiry-month"
                className="w-full bg-black/25 outline-none px-2 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white">
                {MONTHS.map((m) => <option key={m} value={m} className="bg-[#0c0818]">{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">{t("Yıl", "Year")}</label>
              <select name="expiry_year" value={expiryYear} onChange={(e) => setExpiryYear(e.target.value)}
                data-testid="card-expiry-year"
                className="w-full bg-black/25 outline-none px-2 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white">
                {YEARS.map((y) => <option key={y} value={y} className="bg-[#0c0818]">{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">CVV</label>
              <input required name="cvv" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="123" inputMode="numeric" autoComplete="cc-csc" data-testid="card-cvv-input"
                className="w-full bg-black/25 outline-none px-2 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            </div>
          </div>

          <button type="submit" disabled={!canSubmit} data-testid="checkout-submit-button"
            className="w-full mt-4 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ background: "linear-gradient(90deg,#6366f1,#e879f9)" }}>
            <Lock size={12} /> {submitting ? t("Yönlendiriliyor...", "Redirecting...") : t("Şimdi Öde", "Pay Now")}
          </button>
        </form>

        <p className="text-[10px] text-white/35 text-center mt-3">
          {t("Kart bilgilerin bu formdan doğrudan PayTR'ye gider, Luna sunucularına hiç ulaşmaz.", "Your card details go straight from this form to PayTR — Luna's servers never see them.")}
        </p>
      </div>
    </div>
  );
}
