import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lock, Loader2 } from "lucide-react";
import { resetPassword } from "@/lib/api";
import { initialUiLang, makeT } from "@/lib/i18n";

// Landing page for the link sent by /api/auth/forgot-password (see
// security.py::request_password_reset on the backend). No device auth
// needed here — the token in the URL IS the credential (single-use, 1h TTL).
// Same shape as VerifyEmail.jsx, plus a real form since this one also
// collects the new password. In the device's interface language, else the
// browser's (lib/i18n.js).
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(token ? "form" : "error"); // form | busy | ok | error
  const [error, setError] = useState("");
  const [lang] = useState(() => initialUiLang());
  const t = makeT(lang);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t("Şifre en az 8 karakter olmalı", "Your password needs at least 8 characters"));
      return;
    }
    setError("");
    setStatus("busy");
    try {
      await resetPassword(token, password);
      setStatus("ok");
    } catch (err) {
      setStatus("error");
    }
  };

  return (
    <div className="relative min-h-screen bg-[#05040c] text-white flex items-center justify-center px-4" lang={lang}>
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">🌙</div>

        {(status === "form" || status === "busy") && (
          <>
            <h1 className="text-xl font-semibold mb-2">{t("Yeni şifreni belirle", "Set a new password")}</h1>
            <p className="text-white/70 mb-6">{t("Hesabın için yeni bir şifre gir.", "Enter a new password for your account.")}</p>
            <form onSubmit={onSubmit} className="space-y-3 text-left">
              <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/20 px-4 py-2.5">
                <Lock size={15} className="text-white/40 shrink-0" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("Yeni şifre (en az 8 karakter)", "New password (at least 8 characters)")}
                  data-testid="reset-password-input"
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
                />
              </div>
              {error && <p className="text-xs text-red-400 px-1">{error}</p>}
              <button
                type="submit"
                disabled={status === "busy"}
                data-testid="reset-password-submit"
                className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-transform hover:scale-[1.02] disabled:opacity-60"
                style={{ background: "linear-gradient(90deg,#6366f1,#c084fc)" }}
              >
                {status === "busy" ? <Loader2 size={15} className="animate-spin" /> : t("Şifreyi Güncelle", "Update password")}
              </button>
            </form>
          </>
        )}

        {status === "ok" && (
          <>
            <h1 className="text-xl font-semibold mb-2">{t("Şifren güncellendi", "Your password is updated")}</h1>
            <p className="text-white/70 mb-6">
              {t("Artık yeni şifrenle giriş yapabilirsin.", "You can now sign in with your new password.")}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className="text-xl font-semibold mb-2">{t("Link geçersiz veya süresi dolmuş", "This link is invalid or has expired")}</h1>
            <p className="text-white/70 mb-6">
              {t("Giriş ekranından \"Şifremi unuttum\" ile yeni bir link isteyebilirsin.",
                "You can ask for a new link with \"Forgot password\" on the sign-in screen.")}
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
