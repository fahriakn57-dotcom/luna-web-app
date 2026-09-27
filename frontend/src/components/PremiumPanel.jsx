import { useEffect, useState } from "react";
import { X, Crown, Check, Sparkles, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { fetchSubscription, selectPlan, checkoutSubscription, cancelSubscription, fetchProfile } from "@/lib/api";
import CheckoutModal from "@/components/CheckoutModal";

// 2026-09-27: PayTR only needs these five (no TC Kimlik No / city — those
// were an iyzico-specific fraud-check requirement, see git history).
const EMPTY_BILLING = { name: "", surname: "", email: "", phone: "", address: "" };

export default function PremiumPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [catalog, setCatalog] = useState([]);
  const [current, setCurrent] = useState({ plan: "free", status: "active" });
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [billingPlan, setBillingPlan] = useState(null); // plan id currently filling the billing form for
  const [billing, setBilling] = useState(EMPTY_BILLING);
  const [checkoutFields, setCheckoutFields] = useState(null);

  useEffect(() => {
    fetchSubscription()
      .then(({ subscription, catalog }) => { setCurrent(subscription); setCatalog(catalog); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Only `name` is available from the profile — Luna's account model
    // never exposes the actual linked email string, only whether one is
    // verified (see routers/profile.py::get_profile) — so `email` here
    // stays for the user to type themselves.
    fetchProfile().then((p) => {
      setBilling((b) => ({ ...b, name: p.name || "" }));
    }).catch(() => {});
  }, []);

  const refreshSubscription = () => {
    fetchSubscription().then(({ subscription, catalog }) => { setCurrent(subscription); setCatalog(catalog); }).catch(() => {});
  };

  const handleSelect = async (planId) => {
    if (planId === current.plan) return;
    if (planId === "free") {
      setSelecting(planId);
      try {
        const { subscription } = await selectPlan(planId);
        setCurrent(subscription);
        toast.success(t("Free plana geçildi", "Switched to Free"));
      } catch {
        toast.error(t("Bir sorun oldu, tekrar dene", "Something went wrong, try again"));
      } finally {
        setSelecting(null);
      }
      return;
    }
    setBillingPlan(planId);
  };

  const handleBillingSubmit = async (e) => {
    e.preventDefault();
    const missing = Object.entries(billing).find(([, v]) => !v.trim());
    if (missing) {
      toast.error(t("Tüm alanları doldurman gerekiyor.", "All fields are required."));
      return;
    }
    setSelecting(billingPlan);
    try {
      const { form_fields } = await checkoutSubscription(billingPlan, billing);
      if (!form_fields) throw new Error("no checkout form");
      setCheckoutFields(form_fields);
      setBillingPlan(null);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || t("Ödeme başlatılamadı, tekrar dene.", "Couldn't start payment, try again."));
    } finally {
      setSelecting(null);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelSubscription();
      toast.success(t("Aboneliğin iptal edildi.", "Your subscription was cancelled."));
      refreshSubscription();
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("İptal edilemedi, tekrar dene.", "Couldn't cancel, try again."));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={onClose} data-testid="premium-panel">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Crown size={22} className="text-amber-300" /> {t("Luna Premium", "Luna Premium")}
          </h2>
          <button onClick={onClose} data-testid="premium-close-button"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        {billingPlan ? (
          <form onSubmit={handleBillingSubmit}
            className="rounded-3xl border border-purple-400/20 p-6 max-w-md mx-auto"
            style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
            <button type="button" onClick={() => setBillingPlan(null)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white mb-4">
              <ChevronLeft size={14} /> {t("Geri", "Back")}
            </button>
            <p className="text-sm font-semibold text-white mb-1">{t("Fatura Bilgileri", "Billing Details")}</p>
            <p className="text-[11px] text-white/40 mb-4">
              {t("Ödeme sağlayıcımız PayTR, kart kaydı için bu bilgileri istiyor.", "Our payment provider PayTR requires this info to register your card.")}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <input required value={billing.name} onChange={(e) => setBilling((b) => ({ ...b, name: e.target.value }))}
                placeholder={t("Ad", "First name")} data-testid="billing-name-input"
                className="bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
              <input required value={billing.surname} onChange={(e) => setBilling((b) => ({ ...b, surname: e.target.value }))}
                placeholder={t("Soyad", "Last name")} data-testid="billing-surname-input"
                className="bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            </div>
            <input required type="email" value={billing.email} onChange={(e) => setBilling((b) => ({ ...b, email: e.target.value }))}
              placeholder={t("E-posta", "Email")} data-testid="billing-email-input"
              className="w-full mt-2.5 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <input required value={billing.phone} onChange={(e) => setBilling((b) => ({ ...b, phone: e.target.value }))}
              placeholder={t("Telefon (ör. +905551112233)", "Phone (e.g. +905551112233)")} data-testid="billing-phone-input"
              className="w-full mt-2.5 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <input required value={billing.address} onChange={(e) => setBilling((b) => ({ ...b, address: e.target.value }))}
              placeholder={t("Adres", "Address")} data-testid="billing-address-input"
              className="w-full mt-2.5 bg-black/25 outline-none px-3 py-2 rounded-lg border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30" />
            <button type="submit" disabled={selecting === billingPlan} data-testid="billing-submit-button"
              className="w-full mt-4 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(90deg,#6366f1,#e879f9)" }}>
              {selecting === billingPlan ? t("Hazırlanıyor...", "Preparing...") : t("Devam Et", "Continue")}
            </button>
          </form>
        ) : loading ? (
          <p className="text-sm text-white/40 text-center py-10">{t("Yükleniyor...", "Loading...")}</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              {catalog.map((plan) => {
                const isCurrent = current.plan === plan.id;
                const isPlus = plan.id === "premium_plus";
                return (
                  <div key={plan.id} data-testid={`plan-card-${plan.id}`}
                    className="rounded-3xl border p-5 flex flex-col relative"
                    style={{
                      borderColor: isPlus ? "rgba(192,132,252,0.5)" : "rgba(255,255,255,0.12)",
                      backgroundColor: isPlus ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.03)",
                      boxShadow: isPlus ? "0 8px 32px rgba(139,92,246,0.25)" : "none",
                    }}>
                    {isPlus && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[10px] font-bold px-3 py-1 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white">
                        <Sparkles size={10} /> {t("EN POPÜLER", "MOST POPULAR")}
                      </span>
                    )}
                    <h3 className="text-sm font-bold text-white mt-2">{plan.name}</h3>
                    <div className="flex items-end gap-1 my-3">
                      <span className="text-3xl font-extrabold text-white">
                        {plan.price_try ? `₺${plan.price_try}` : `$${plan.price_usd}`}
                      </span>
                      {plan.price_usd > 0 && <span className="text-xs text-white/40 mb-1">/{t("ay", "mo")}</span>}
                    </div>
                    <ul className="space-y-2 mb-5 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-white/70">
                          <Check size={13} className="text-emerald-400 shrink-0 mt-0.5" /> {f}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => handleSelect(plan.id)} disabled={isCurrent || selecting === plan.id}
                      data-testid={`plan-select-${plan.id}`}
                      className="w-full py-2.5 rounded-full text-xs font-semibold transition-all disabled:opacity-60"
                      style={isCurrent
                        ? { border: "1px solid rgba(74,222,128,0.4)", color: "#86efac", backgroundColor: "rgba(74,222,128,0.08)" }
                        : isPlus
                          ? { background: "linear-gradient(90deg,#6366f1,#e879f9)", color: "#fff" }
                          : { border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }}>
                      {isCurrent ? t("Mevcut Plan ✓", "Current Plan ✓")
                        : selecting === plan.id ? t("Hazırlanıyor...", "Preparing...")
                        : plan.id === "free" ? t("Free'ye Geç", "Switch to Free") : t("Bu Planı Seç", "Choose Plan")}
                    </button>
                  </div>
                );
              })}
            </div>

            {current.status === "active" && current.plan !== "free" && (
              <button onClick={handleCancel} disabled={cancelling} data-testid="subscription-cancel-button"
                className="block mx-auto mt-5 text-xs text-red-300/70 hover:text-red-300 disabled:opacity-50">
                {cancelling ? t("İptal ediliyor...", "Cancelling...") : t("Aboneliği iptal et", "Cancel subscription")}
              </button>
            )}
            {current.status === "pending_payment" && (
              <p className="text-center text-[11px] text-amber-300/70 mt-5">
                {t("Ödemen henüz onaylanmadı.", "Your payment hasn't been confirmed yet.")}
              </p>
            )}
            {current.status === "failed" && (
              <p className="text-center text-[11px] text-red-300/70 mt-5">
                {t("Son ödeme denemesi başarısız oldu. Tekrar deneyebilirsin.", "Your last payment attempt failed. You can try again.")}
              </p>
            )}
            {current.status === "payment_failed" && (
              <p className="text-center text-[11px] text-red-300/70 mt-5">
                {t("Tekrarlayan ödemen 3 kez başarısız oldu, Free plana düşürüldün. Kartını güncelleyip tekrar deneyebilirsin.", "Your recurring payment failed 3 times and you were moved to Free. You can update your card and try again.")}
              </p>
            )}
          </>
        )}
      </div>

      {checkoutFields && (
        <CheckoutModal lang={lang} formFields={checkoutFields}
          onClose={() => { setCheckoutFields(null); refreshSubscription(); }} />
      )}
    </div>
  );
}
