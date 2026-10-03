import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, ArrowRight, Loader2, Lock, ShieldCheck, Fingerprint, User, ChevronDown, Globe } from "lucide-react";
import accountGateBg from "@/assets/account-gate.png";
import LegalLink, { LEGAL_URLS } from "@/components/LegalLink";
import { signupWithEmail, loginWithEmail, loginWithGoogle, forgotPassword, fetchProfile, updateProfile, fetchFeatures } from "@/lib/api";

const SUPPORT_EMAIL = "xsfei.technology@gmail.com";

// "Seen this browser log in before" — picks the greeting (a first visit is
// not "good to see you again"). A convenience only; never a security signal.
const RETURNING_KEY = "luna_returning";
function readReturning() {
  try {
    return localStorage.getItem(RETURNING_KEY) === "1";
  } catch {
    return false;
  }
}
function markReturning() {
  try {
    localStorage.setItem(RETURNING_KEY, "1");
  } catch {
    // private mode / blocked storage: the greeting just stays generic
  }
}

// Google Identity Services Client ID — public by design (Google's own docs:
// this is not a secret, only server-side ID-token verification is
// security-sensitive, see backend/luna/security.py::google_login). Read
// from env so it's never hardcoded; see .env.example.
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

// Inline SVG, not an image asset — the previous PNG (@/assets/luna-logo.png)
// got silently swapped by something outside this codebase (a square
// "LUNA"-branded app icon replaced the original slim crescent moon mark).
// Drawing it in code means nothing outside AccountGate.jsx can change how
// this renders. Shape/proportions match the small top-left "LUNA" wordmark
// logo used across the site — a tall, clean crescent, no circular backdrop.
// GateCard is mounted twice (desktop + mobile, one hidden by CSS): with one
// fixed gradient id the first — hidden — copy owned it, and on phones the
// crescent rendered as a bare dot. useId gives each copy its own.
const LunaMoonBadge = () => {
  const gradId = `moon-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
  <svg width="56" height="56" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e9d5ff" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <path
      d="M52 10c-6.2 6.4-10 15.1-10 24.7 0 19.6 15.9 35.5 35.5 35.5 1.7 0 3.4-.12 5-.35C76.7 88.3 63.4 96 48.3 96 24.8 96 5.8 77 5.8 53.5S24.8 11 48.3 11c1.25 0 2.48.06 3.7.18Z"
      fill={`url(#${gradId})`}
      transform="translate(4 -4) scale(0.72)"
    />
    <circle cx="63" cy="12" r="3.2" fill="#e9d5ff" />
  </svg>
  );
};

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.82Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4-3.11Z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z" />
  </svg>
);

const TRUST = [
  { icon: Fingerprint, tr: "Güvenli\nGiriş", en: "Secure\nLogin" },
  { icon: ShieldCheck, tr: "Verilerin\nSende", en: "Your Data\nStays Yours" },
  { icon: User, tr: "Her Zaman\nSeninle", en: "Always\nWith You" },
];

// Google's OWN sign-in button, visible, once Google Identity Services has
// loaded (launch audit 2026-10-03): our button only called One Tap
// (prompt()), which shows nothing when the browser isn't signed in to Google
// — typical on iPhone Safari and in private windows — or after the user
// closed it once (Google then mutes it for a while), so the main sign-in
// silently did nothing for many people. Google's button opens its sign-in
// window in every one of those cases. (Not the old INVISIBLE overlay — that
// failed when a click missed the hidden iframe; this one is what you click.)
function OfficialGoogleButton({ lang, extraClass }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !window.google?.accounts?.id) return;
    el.innerHTML = "";
    window.google.accounts.id.renderButton(el, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "center",
      width: Math.round(Math.min(400, Math.max(220, el.offsetWidth || 300))),
      locale: lang === "tr" ? "tr" : "en",
    });
  }, [lang]);
  return <div ref={hostRef} data-testid="gate-google-button" className={`flex min-h-[44px] w-full justify-center ${extraClass}`} />;
}

function GoogleButtonSlot({ t, lang, googleAvailable, gisReady, onGoogleClick, extraClass = "" }) {
  if (googleAvailable && gisReady) return <OfficialGoogleButton lang={lang} extraClass={extraClass} />;
  // A REAL button with our own onClick — not an invisible iframe overlay
  // forwarded to. The overlay approach (render Google's real button into a
  // hidden container, position an invisible copy on top of this one) turned
  // out to be silently unreliable for real users in ways that never showed
  // up in testing: if the click didn't land exactly on Google's iframe
  // (layout shift, browser quirk, rendering timing), it just did nothing —
  // no error, not even hover feedback, and we had no way to tell why.
  // Calling google.accounts.id.prompt() directly from our own click handler
  // is simpler and debuggable: its callback tells us exactly why nothing
  // showed (see onGoogleClick), instead of failing in total silence.
  return (
    <button onClick={onGoogleClick} data-testid="gate-google-button" disabled={!googleAvailable}
      className={`w-full flex items-center justify-center gap-2.5 rounded-full py-3 text-sm font-semibold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-60 ${extraClass}`}>
      <GoogleIcon /> {t("Google ile Devam Et", "Continue with Google")} <ArrowRight size={15} />
    </button>
  );
}

function GateCard({ lang, setLang, view, setView, email, setEmail, password, setPassword, loading, googleAvailable, gisReady, onGoogleClick, onSubmit, onOpenForgot, onForgotSubmit, forgotSent, termsAccepted, setTermsAccepted, specialConsent, setSpecialConsent, emailOn, returning }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  // GateCard is mounted twice at once (desktop + mobile layouts, one of them
  // hidden by CSS) — useId keeps each copy's checkbox ids unique so every
  // <label htmlFor> points at its own card's input.
  const termsId = useId();
  const consentId = useId();

  return (
    <>
      <div className="flex items-center justify-end mb-1">
        <button onClick={() => setLang((l) => (l === "tr" ? "en" : "tr"))} data-testid="gate-lang-toggle"
          aria-label={t("Dili değiştir", "Change language")}
          className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors">
          <Globe size={13} /> {lang === "tr" ? "TR" : "EN"} <ChevronDown size={12} />
        </button>
      </div>

      <div className="flex flex-col items-center text-center mb-5">
        <div className="mb-3" style={{ filter: "drop-shadow(0 0 14px rgba(196,181,253,0.6))" }}>
          <LunaMoonBadge />
        </div>
        <h2 className="font-extrabold tracking-[0.3em] text-lg">LUNA</h2>
        <p className="text-[9px] font-mono tracking-widest text-indigo-300/70 uppercase mt-1.5 leading-relaxed" lang="en">
          Listening · Understanding<br />Nurturing · Adapting
        </p>
      </div>

      {view === "choice" && (
        <>
          <p className="text-center text-base font-bold mb-1">
            {returning ? t("Tekrar görmek güzel.", "Good to see you again.") : t("Luna ile tanış.", "Meet Luna.")} 💜
          </p>
          <p className="text-center text-xs text-white/60 mb-5">
            {returning
              ? t("Devam etmek için giriş yap.", "Log in to continue.")
              : t("Ücretsiz hesabını birkaç saniyede oluştur.", "Create your free account in seconds.")}
          </p>

          <GoogleButtonSlot t={t} lang={lang} googleAvailable={googleAvailable} gisReady={gisReady} onGoogleClick={onGoogleClick} />

          <div className="flex items-center gap-2 my-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] text-white/30 uppercase tracking-wide">{t("veya", "or")}</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button onClick={() => setView("login")} data-testid="gate-login-button"
            className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold border border-white/20 hover:bg-white/5 transition-colors">
            <Mail size={15} /> {t("E-posta ile Giriş Yap", "Log In with Email")}
          </button>

          <p className="text-center text-xs text-white/50 mt-5">
            {t("Hesabın yok mu?", "Don't have an account?")}{" "}
            <button onClick={() => setView("signup")} data-testid="gate-signup-button" className="inline-flex items-center gap-0.5 text-indigo-300 font-semibold hover:text-white transition-colors">
              {t("Hemen katıl", "Join now")} <ArrowRight size={11} />
            </button>
          </p>

          <div className="flex items-center justify-center gap-8 mt-6 pt-5 border-t border-white/10">
            {TRUST.map((f) => (
              <div key={f.tr} className="flex flex-col items-center gap-1.5 text-white/45">
                <f.icon size={15} />
                <span className="text-[9px] text-center leading-tight whitespace-pre-line">{t(f.tr, f.en)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(view === "login" || view === "signup") && (
        <>
          <h3 className="text-center text-sm font-bold mb-0.5">
            {view === "login" ? t("Giriş Yap", "Log In") : t("Hesap Oluştur", "Create Account")}
          </h3>
          <p className="text-center text-xs text-white/45 mb-5">
            {view === "login"
              ? t("Hesabına e-posta ile giriş yap.", "Log in to your account with email.")
              : t("Birkaç saniyede hesabını oluştur.", "Create your account in seconds.")}
          </p>

          {emailOn === false && (
            // Until the email service is set up, an email account can't be
            // verified — and an unverified one can't log in on another
            // device or after browser data is cleared. Say so up front.
            <p data-testid="gate-email-off-note" className="mb-4 rounded-2xl border border-amber-200/25 bg-amber-200/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-50/90">
              {t(
                "E-posta doğrulaması şu an çalışmıyor: e-postayla açılan bir hesaba başka bir cihazdan ya da tarayıcı verilerini sildikten sonra giriş yapılamayabilir. Hesabını kaybetmemek için Google ile devam etmeni öneririz.",
                "Email verification isn't working right now: an email account may not open on another device or after browser data is cleared. To keep your account safe, continue with Google."
              )}
            </p>
          )}
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/20 px-4 py-2.5">
              <Mail size={15} className="text-white/40 shrink-0" />
              <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={t("E-posta", "Email")} data-testid="gate-email-input"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30" />
            </div>
            <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/20 px-4 py-2.5">
              <Lock size={15} className="text-white/40 shrink-0" />
              <input type="password" required minLength={view === "signup" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={view === "signup" ? "new-password" : "current-password"}
                placeholder={view === "signup" ? t("Şifre (en az 8 karakter)", "Password (min. 8 characters)") : t("Şifre", "Password")}
                data-testid="gate-password-input"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30" />
            </div>

            {view === "signup" && (
              <>
                <div className="flex items-start gap-2.5 px-1 pt-1">
                  <input id={termsId} type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)}
                    data-testid="gate-terms-checkbox"
                    className="accent-purple-400 mt-0.5 h-4 w-4 shrink-0 cursor-pointer" />
                  <label htmlFor={termsId} className="text-[11px] text-white/70 leading-snug cursor-pointer">
                    {t(
                      <>18 yaşını doldurdum; <LegalLink href={LEGAL_URLS.terms} className="text-indigo-300 hover:text-white">Kullanım Şartları</LegalLink>'nı okudum ve kabul ediyorum.</>,
                      <>I am 18 or older, and I have read and accept the <LegalLink href={LEGAL_URLS.terms} className="text-indigo-300 hover:text-white">Terms of Use</LegalLink>.</>
                    )}
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                  <p lang={lang === "tr" ? "tr" : "en"} className="text-[9px] font-semibold uppercase tracking-wide text-indigo-300/70 mb-1.5">
                    {t("Açık rıza (isteğe bağlı)", "Explicit consent (optional)")}
                  </p>
                  <div className="flex items-start gap-2.5">
                    <input id={consentId} type="checkbox" checked={specialConsent} onChange={(e) => setSpecialConsent(e.target.checked)}
                      data-testid="gate-consent-checkbox"
                      className="accent-purple-400 mt-0.5 h-4 w-4 shrink-0 cursor-pointer" />
                    <label htmlFor={consentId} className="text-[10px] text-white/60 leading-snug cursor-pointer">
                      {t(
                        <>Sohbetlerimde paylaştığım sağlık, inanç gibi özel nitelikli kişisel verilerimin <LegalLink href={LEGAL_URLS.consent} className="text-indigo-300 hover:text-white">Açık Rıza Metni</LegalLink>'nde anlatıldığı şekilde işlenmesine ve Luna'nın bunları hafızasına kaydetmesine açık rıza veriyorum.</>,
                        <>I give my explicit consent for the special-category personal data I share in my chats, such as health or beliefs, to be processed as described in the <LegalLink href={LEGAL_URLS.consent} className="text-indigo-300 hover:text-white">Explicit Consent Notice</LegalLink>, and for Luna to save it to its memory.</>
                      )}
                    </label>
                  </div>
                  <p className="text-[9px] text-white/40 leading-snug mt-1.5 pl-[26px]">
                    {t(
                      "Vermesen de Luna'yı kullanabilirsin; kararını Ayarlar > Gizlilik ve Veri'den istediğin zaman değiştirebilirsin.",
                      "You can use Luna without it, and change your decision anytime in Settings > Privacy & Data."
                    )}
                  </p>
                </div>
              </>
            )}

            <button type="submit" disabled={loading || (view === "signup" && !termsAccepted)} data-testid="gate-submit-button"
              className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-transform hover:scale-[1.02] disabled:opacity-60"
              style={{ background: "linear-gradient(90deg,#6366f1,#c084fc)" }}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : (view === "login" ? t("Giriş Yap", "Log In") : t("Hesap Oluştur", "Create Account"))}
            </button>
          </form>

          {view === "login" && (
            <button onClick={onOpenForgot} data-testid="gate-forgot-password-button"
              className="w-full text-center text-[11px] text-indigo-300/80 hover:text-indigo-200 mt-3 transition-colors">
              {t("Şifremi unuttum", "Forgot password?")}
            </button>
          )}

          <GoogleButtonSlot t={t} lang={lang} googleAvailable={googleAvailable} gisReady={gisReady} onGoogleClick={onGoogleClick} extraClass="mt-3" />

          <button onClick={() => setView("choice")} data-testid="gate-back-button"
            className="w-full text-center text-[11px] text-white/35 hover:text-white/60 mt-5 transition-colors">
            {t("← Geri dön", "← Go back")}
          </button>
        </>
      )}

      {view === "forgot" && (
        <>
          <h3 className="text-center text-sm font-bold mb-0.5">{t("Şifremi unuttum", "Forgot password")}</h3>
          {emailOn === false ? (
            <>
              <p data-testid="gate-forgot-email-off" className="text-center text-xs text-white/70 mb-4 leading-relaxed">
                {t(
                  "Şifre sıfırlama e-postaları şu an gönderilemiyor. E-postan bir Google hesabıysa aşağıdan Google ile giriş yapabilirsin; hesabın ve sohbetlerin korunur.",
                  "Password reset emails can't be sent right now. If your email is a Google account, sign in with Google below — your account and chats are kept."
                )}
              </p>
              <GoogleButtonSlot t={t} lang={lang} googleAvailable={googleAvailable} gisReady={gisReady} onGoogleClick={onGoogleClick} />
              <p className="text-center text-xs text-white/60 mt-4">
                {t("Yardım için:", "Need help?")} <span className="select-all text-indigo-200">{SUPPORT_EMAIL}</span>
              </p>
            </>
          ) : forgotSent ? (
            <p className="text-center text-xs text-white/60 mb-5 leading-relaxed">
              {t(
                "Bu e-postaya bağlı bir hesap varsa, şifreni sıfırlaman için bir link gönderdik. Gelen kutunu kontrol et.",
                "If an account uses that email, we've sent a link to reset the password. Check your inbox."
              )}
            </p>
          ) : (
            <>
              <p className="text-center text-xs text-white/45 mb-5">
                {t("Hesabına bağlı e-postayı gir, sana bir sıfırlama linki gönderelim.", "Enter the email linked to your account and we'll send you a reset link.")}
              </p>
              <form onSubmit={onForgotSubmit} className="space-y-3">
                <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/20 px-4 py-2.5">
                  <Mail size={15} className="text-white/40 shrink-0" />
                  <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("E-posta", "Email")} data-testid="gate-forgot-email-input"
                    className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30" />
                </div>
                <button type="submit" disabled={loading} data-testid="gate-forgot-submit-button"
                  className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-transform hover:scale-[1.02] disabled:opacity-60"
                  style={{ background: "linear-gradient(90deg,#6366f1,#c084fc)" }}>
                  {loading ? <Loader2 size={15} className="animate-spin" /> : t("Sıfırlama Linki Gönder", "Send Reset Link")}
                </button>
              </form>
            </>
          )}
          <button onClick={() => setView("login")} data-testid="gate-forgot-back-button"
            className="w-full text-center text-[11px] text-white/35 hover:text-white/60 mt-5 transition-colors">
            {t("← Geri dön", "← Go back")}
          </button>
        </>
      )}

      <div className="text-center text-[10px] text-white/40 leading-relaxed mt-6">
        <p>{t("Luna 18 yaşından büyükler içindir.", "Luna is for adults 18 and over.")}</p>
        <p className="flex flex-wrap items-center justify-center gap-x-1.5">
          <LegalLink href={LEGAL_URLS.terms}>{t("Kullanım Şartları", "Terms of Use")}</LegalLink>
          <span aria-hidden="true">·</span>
          <LegalLink href={LEGAL_URLS.privacy}>{t("Gizlilik Politikası", "Privacy Policy")}</LegalLink>
          <span aria-hidden="true">·</span>
          <LegalLink href={LEGAL_URLS.kvkk}>{t("KVKK Aydınlatma Metni", "KVKK Privacy Notice")}</LegalLink>
        </p>
      </div>
      <p className="text-center text-[9px] text-white/25 mt-2">XSF Technology · Luna · {t("Daha iyi bir yarın, seninle.", "A better tomorrow, with you.")}</p>
    </>
  );
}

export default function AccountGate({ lang, setLang, onDone }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [view, setView] = useState("choice");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  // Signup-only: the required Kullanım Şartları / 18+ box and the separate,
  // optional explicit consent for special-category data (KVKK md.6).
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [specialConsent, setSpecialConsent] = useState(false);
  // True once we've given up waiting for GIS (blocked by an ad/privacy
  // blocker, offline, or accounts.google.com unreachable) — read by
  // onGoogleClick below to show a clear message instead of silently
  // calling prompt() on an API that never finished loading.
  const [gisFailed, setGisFailed] = useState(false);
  // Google's own button replaces ours once GIS has loaded (GoogleButtonSlot).
  const [gisReady, setGisReady] = useState(false);
  // null = not known yet; false = verification/reset emails can't be sent.
  const [emailOn, setEmailOn] = useState(null);
  const [returning] = useState(readReturning);
  useEffect(() => {
    let alive = true;
    fetchFeatures().then((f) => { if (alive && f) setEmailOn(!!f.email); });
    return () => { alive = false; };
  }, []);
  // GIS is initialized once on mount, but the TR/EN toggle can change `lang`
  // afterwards — route its callback through a ref so the sign-in toasts use
  // the current language, not the one the page loaded with.
  const credentialHandlerRef = useRef(null);

  // Google Identity Services: script + initialize, loaded once on mount.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return; // not configured — onGoogleClick below shows a clear error instead of silently failing
    // If GIS hasn't loaded within 5s (blocked script, dead network, slow
    // connection), stop waiting and fall back to a real, clickable button
    // that at least tells the user what's wrong — instead of leaving the
    // overlay empty and looking permanently broken forever.
    const failTimer = setTimeout(() => setGisFailed(true), 5000);
    const existing = document.getElementById("google-identity-services");
    const onLoad = () => {
      if (!window.google?.accounts?.id) return;
      clearTimeout(failTimer);
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => credentialHandlerRef.current?.(response),
      });
      setGisReady(true);
    };
    const onError = () => {
      clearTimeout(failTimer);
      setGisFailed(true);
    };
    if (existing) {
      if (window.google?.accounts?.id) onLoad();
      else existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      return () => {
        clearTimeout(failTimer);
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      };
    }
    const script = document.createElement("script");
    script.id = "google-identity-services";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    document.head.appendChild(script);
    return () => {
      clearTimeout(failTimer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by Google Identity Services with the signed ID token once the
  // user picks an account in the popup — this is the SAME idToken shape
  // loginWithGoogle() -> POST /api/auth/google -> security.py::google_login
  // was already built to accept.
  const handleGoogleCredential = async (response) => {
    setLoading(true);
    try {
      await loginWithGoogle(response.credential);
      toast.success(returning ? t("Tekrar görmek güzel! 💜", "Welcome back! 💜") : t("Hoş geldin! 💜", "Welcome! 💜"));
      markReturning();
      onDone();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 501) {
        toast.error(t("Google girişi sunucuda henüz yapılandırılmadı.", "Google Sign-In isn't configured on the server yet."));
      } else {
        toast.error(t("Google ile giriş başarısız oldu, tekrar dene.", "Google Sign-In failed, try again."));
      }
    } finally {
      setLoading(false);
    }
  };
  credentialHandlerRef.current = handleGoogleCredential;

  // Fires google.accounts.id.prompt() directly from a real click — this
  // triggers Google's native account-chooser UI (or FedCM dialog). The
  // notification callback is the ONLY documented way to learn WHY nothing
  // showed (suppressed by cooldown, no Google session, unregistered
  // origin, browser policy, etc. — see Google's IdentityCredentialError /
  // PromptMomentNotification docs) — surfaced here as a toast instead of
  // failing in total silence, which is what the previous hidden-iframe-
  // overlay approach did with no way to diagnose it.
  const onGoogleClick = () => {
    if (!GOOGLE_CLIENT_ID) {
      toast.error(t("Google girişi bu ortamda yapılandırılmadı.", "Google Sign-In isn't configured in this environment."));
      return;
    }
    if (gisFailed || !window.google?.accounts?.id) {
      toast.error(t(
        "Google girişine ulaşılamadı — reklam engelleyici/gizlilik uzantın onu engelliyor olabilir. Kapatıp tekrar dene, ya da e-posta ile giriş yap.",
        "Couldn't reach Google Sign-In — an ad/privacy blocker may be blocking it. Try disabling it, or log in with email instead."
      ));
      return;
    }
    window.google.accounts.id.prompt((notification) => {
      const reason =
        (notification.isNotDisplayed?.() && notification.getNotDisplayedReason?.()) ||
        (notification.isSkippedMoment?.() && notification.getSkippedReason?.()) ||
        null;
      if (reason) {
        toast.error(
          t("Google penceresi açılamadı. Biraz sonra tekrar dene ya da e-posta ile devam et.",
             "Google's sign-in window couldn't open. Try again in a moment, or continue with email.")
        );
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (view === "signup" && !termsAccepted) {
      toast.error(t("Devam etmek için Kullanım Şartları'nı kabul etmelisin.", "You need to accept the Terms of Use to continue."));
      return;
    }
    setLoading(true);
    try {
      if (view === "signup") {
        const res = await signupWithEmail(email.trim(), password);
        // Record the acceptance (and the optional consent) on the new
        // account. Best-effort on purpose: the account already exists at
        // this point, so a failure here must not block entry — Luna.jsx's
        // TermsGate simply asks again on first load.
        try {
          const p = await fetchProfile();
          if (p?.terms_current_version) {
            await updateProfile({ accept_terms_version: p.terms_current_version, special_data_consent: specialConsent });
          }
        } catch {
          // ignored — see above
        }
        toast.success(res.verification_email_sent
          ? t("Hesabın oluşturuldu! Doğrulama e-postasını kontrol et.", "Account created! Check your inbox to verify.")
          : t("Hesabın oluşturuldu!", "Account created!"));
      } else {
        await loginWithEmail(email.trim(), password);
        toast.success(t("Tekrar görmek güzel! 💜", "Welcome back! 💜"));
      }
      markReturning();
      onDone();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (view === "login" && status === 401) {
        toast.error(t("E-posta veya şifre hatalı.", "Wrong email or password."));
      } else if (view === "login" && status === 403) {
        toast.error(emailOn === false
          ? t("Bu hesabın e-postası doğrulanmamış ve doğrulama e-postaları şu an gönderilemiyor. E-postan bir Google hesabıysa 'Google ile Devam Et' ile girebilirsin.",
              "This account's email isn't verified, and verification emails can't be sent right now. If your email is a Google account, use 'Continue with Google'.")
          : t("E-postanı henüz doğrulamadın — gelen kutunu kontrol et.", "You haven't verified your email yet — check your inbox."),
          { duration: 9000 });
      } else if (view === "signup" && status === 409) {
        toast.error(t("Bu e-posta zaten kullanımda. Giriş yapmayı dene.", "That email is already in use. Try logging in."));
      } else if (status === 400 && detail) {
        toast.error(detail);
      } else {
        toast.error(t("Bir sorun oldu, tekrar dene.", "Something went wrong, try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await forgotPassword(email.trim(), lang);
      // Deliberately always shows the same "sent" state regardless of the
      // response — the backend never reveals whether the email actually
      // has an account (see security.py::request_password_reset), so
      // showing a different outcome here would defeat that.
      setForgotSent(true);
    } catch {
      // A network/server error still shows the generic sent-state message —
      // there's nothing more specific and truthful to say without either
      // leaking account existence or asking the user to just retry blindly.
      setForgotSent(true);
    } finally {
      setLoading(false);
    }
  };

  // Not gated on gisLoaded — the button is always clickable when a Client
  // ID is configured; onGoogleClick's own runtime checks (window.google
  // present, gisFailed) handle "still loading" / "blocked" at click time
  // with an appropriate message, rather than disabling the button and
  // guessing whether GIS will finish loading before the user gives up.
  const cardProps = {
    lang, setLang, view, setView, email, setEmail, password, setPassword, loading,
    googleAvailable: !!GOOGLE_CLIENT_ID, gisReady, onGoogleClick, onSubmit: handleSubmit, emailOn, returning,
    onOpenForgot: () => { setForgotSent(false); setView("forgot"); },
    onForgotSubmit: handleForgotSubmit, forgotSent,
    termsAccepted, setTermsAccepted, specialConsent, setSpecialConsent,
  };

  return (
    <div className="h-screen w-full text-white overflow-hidden" style={{ backgroundColor: "#07040f" }}>
      {/* Desktop: full, un-cropped photo at its native ~2:1 ratio (1774x887),
          sized to fit ENTIRELY within the viewport on both axes (width
          capped at 200vh, i.e. 100vh * 1774/887) so it never overflows and
          the page never scrolls. Unlike the earlier background image, this
          one has NO card mockup baked into the photo — the card below is
          genuinely translucent glass over the open sofa area on the right,
          not covering/replacing anything drawn into the image itself. */}
      <div className="hidden lg:flex h-full w-full items-center justify-center">
        <div className="relative" style={{ width: "min(100%, 200vh)", aspectRatio: "1774 / 887" }}>
          <img src={accountGateBg} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "contain" }} />
          <div className="absolute" style={{ left: "58.7%", top: "13.5%", width: "25%", height: "76.5%" }}>
            <div className="w-full h-full overflow-y-auto rounded-[3%] border border-white/10 p-[6%]" style={{ backgroundColor: "rgba(10,8,20,0.45)", backdropFilter: "blur(12px)" }}>
              <GateCard {...cardProps} />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile / tablet: the wide photo doesn't compose well narrow, so just
          show the card centered on a plain dark background. my-auto (not
          items-center) centres it only while it fits — a taller card (signup
          with the consent boxes) then scrolls from its top instead of being
          clipped above the viewport. */}
      <div className="lg:hidden h-full w-full flex justify-center px-4 py-10 overflow-y-auto">
        <div className="w-full max-w-md my-auto rounded-[28px] border border-white/10 p-7" style={{ backgroundColor: "rgba(10,8,22,0.9)", backdropFilter: "blur(20px)" }}>
          <GateCard {...cardProps} />
        </div>
      </div>
    </div>
  );
}
