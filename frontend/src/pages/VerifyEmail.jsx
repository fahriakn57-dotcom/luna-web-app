import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmailToken } from "@/lib/api";

// Landing page for the link sent by /api/auth/link-email (see
// security.py::verify_email on the backend). No device auth needed here —
// the token in the URL IS the credential (single-use, 24h TTL).
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("checking"); // checking | ok | error

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
    <div className="relative min-h-screen bg-[#05040c] text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {status === "checking" && <p className="text-white/70">Doğrulanıyor…</p>}
        {status === "ok" && (
          <>
            <div className="text-4xl mb-4">🌙</div>
            <h1 className="text-xl font-semibold mb-2">E-postan doğrulandı</h1>
            <p className="text-white/70 mb-6">
              Artık bu e-posta ve şifreyle hesabını başka bir cihazda geri getirebilirsin.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl mb-4">🌙</div>
            <h1 className="text-xl font-semibold mb-2">Link geçersiz veya süresi dolmuş</h1>
            <p className="text-white/70 mb-6">
              Uygulamadan e-posta bağlama işlemini tekrar başlatarak yeni bir link isteyebilirsin.
            </p>
          </>
        )}
        <Link to="/" className="text-purple-400 hover:text-purple-300 underline">
          Luna'ya dön
        </Link>
      </div>
    </div>
  );
}
