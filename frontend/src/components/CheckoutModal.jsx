import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Renders iyzico's own checkout_form_content HTML — a <script> tag that
// draws iyzico's hosted card-entry iframe into #iyzipay-checkout-form.
// A plain innerHTML assignment (or React's dangerouslySetInnerHTML) is
// silently inert for <script> tags — browsers refuse to execute a script
// inserted that way. The fix is the standard one: manually recreate each
// <script> node via document.createElement so the browser treats it as a
// real, executable script.
function IyzicoEmbed({ html }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !html) return;
    el.innerHTML = html;
    const scripts = Array.from(el.querySelectorAll("script"));
    scripts.forEach((oldScript) => {
      const newScript = document.createElement("script");
      Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
      newScript.text = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
    return () => { el.innerHTML = ""; };
  }, [html]);

  return <div ref={containerRef} />;
}

export default function CheckoutModal({ lang, checkoutFormContent, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={onClose} data-testid="checkout-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-5"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">{t("Güvenli Ödeme (iyzico)", "Secure Payment (iyzico)")}</p>
          <button onClick={onClose} data-testid="checkout-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <div className="rounded-2xl overflow-hidden bg-white" data-testid="checkout-iyzico-embed">
          <IyzicoEmbed html={checkoutFormContent} />
        </div>
        <p className="text-[10px] text-white/35 text-center mt-3">
          {t("Kart bilgilerin doğrudan iyzico'ya gider, Luna sunucularına hiç ulaşmaz.", "Your card details go straight to iyzico — Luna's servers never see them.")}
        </p>
      </div>
    </div>
  );
}
