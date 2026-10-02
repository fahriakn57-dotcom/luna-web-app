import { useState } from "react";
import { X, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { pairWithCode } from "@/lib/api";
import { GlyphTile } from "@/components/icons/GlyphTile";

export default function PairDeviceModal({ lang, onPaired, onClose }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (tr, en) => (lang === "tr" ? tr : en);

  const submit = async () => {
    if (code.trim().length !== 6 || busy) return;
    setBusy(true);
    try {
      await pairWithCode(code.trim());
      onPaired();
    } catch (e) {
      toast.error(t("Kod geçersiz veya süresi doldu", "Code is invalid or expired"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="pair-device-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border p-6 bg-[#130f21] border-amber-400/25">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Amber like the rest of this modal (border, code field, button). */}
            <GlyphTile icon={Smartphone} hue="amber" size={40} />
            <h2 className="text-sm font-bold text-white">{t("Telefonla Eşleştir", "Pair with your phone")}</h2>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-white/60 leading-relaxed mb-4">
          {t(
            "Luna mobil uygulamasında Profil → \"Web'e Bağla\" bölümünden 6 haneli kodu al ve aşağıya gir. Bu tarayıcı telefonundaki aynı hafızaya bağlanacak.",
            "In the Luna mobile app, go to Profile → \"Connect to Web\" and get the 6-digit code. Enter it below to link this browser to your phone's memory."
          )}
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="000000"
          data-testid="pair-code-input"
          className="w-full text-center text-2xl tracking-[0.5em] font-mono bg-black/30 outline-none px-4 py-3 rounded-xl border text-white placeholder:text-white/20 mb-4 border-amber-400/25 focus:border-amber-400"
        />

        <button onClick={submit} disabled={code.length !== 6 || busy} data-testid="pair-code-submit"
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 bg-gradient-to-r from-amber-400 to-pink-500 text-white hover:opacity-90">
          {busy ? t("Bağlanıyor...", "Pairing...") : t("Eşleştir", "Pair")}
        </button>
      </div>
    </div>
  );
}
