import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmailToken } from "@/lib/api";
import { initialUiLang, makeT } from "@/lib/i18n";

// Landing page for the link sent by /api/auth/link-email (see
// security.py::verify_email on the backend). No device auth needed here —
// the token in the URL IS the credential (single-use, 24h TTL). In the
// device's interface language, else the browser's (lib/i18n.js).
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("checking"); // checking | ok | error
  const [lang] = useState(() => initialUiLang());
  const t = makeT(lang);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      return;
    }
    verifyEmailToken(token)
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, [params]);

  return (
    <div className="relative min-h-screen bg-[#05040c] text-white flex items-center justify-center px-4" lang={lang}>
      <div className="max-w-md w-full text-center">
        {status === "checking" && <p className="text-white/70">{t("Doğrulanıyor…", "Verifying…")}</p>}
        {status === "ok" && (
          <>
            <div className="text-4xl mb-4">🌙</div>
            <h1 className="text-xl font-semibold mb-2">{t("E-postan doğrulandı", "Your email is verified")}</h1>
            <p className="text-white/70 mb-6">
              {t("Artık bu e-posta ve şifreyle hesabını başka bir cihazda geri getirebilirsin.",
                "You can now get your account back on another device with this email and password.")}
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl mb-4">🌙</div>
            <h1 className="text-xl font-semibold mb-2">{t("Link geçersiz veya süresi dolmuş", "This link is invalid or has expired")}</h1>
            <p className="text-white/70 mb-6">
              {t("Uygulamadan e-posta bağlama işlemini tekrar başlatarak yeni bir link isteyebilirsin.",
                "You can ask for a new link by linking your email again in the app.")}
            </p>
          </>
        )}
        <Link to="/" className="text-purple-400 hover:text-purple-300 underline">
          {t("Luna'ya dön", "Back to Luna")}
        </Link>
      </div>
    </div>
  );
}
