import { useEffect, useId, useState } from "react";
import { X, Globe, Smartphone, Trash2, Settings as SettingsIcon, User, Sparkles, LogOut, MessageCircle, Mail, ShieldCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import ConfirmDialog from "@/components/ConfirmDialog";
import { accountDeletionBody, consentWithdrawalBody } from "@/lib/legalCopy";
import LegalLink, { LEGAL_URLS } from "@/components/LegalLink";
import { fetchProfile, updateProfile, signOut, deleteAccount } from "@/lib/api";
import { LANGUAGES } from "@/lib/languages";

const TONES = [
  { key: "warm", tr: "Daha Samimi", en: "Warmer" },
  { key: "neutral", tr: "Dengeli", en: "Balanced" },
  { key: "technical", tr: "Daha Profesyonel", en: "More Professional" },
];

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-purple-300/50 mb-2 px-1">{title}</p>
      <div className="divide-y divide-white/[0.06]">{children}</div>
    </div>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-3 text-sm text-white/85">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "rgba(192,132,252,0.12)" }}>
          <Icon size={15} className="text-purple-300" />
        </span>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function SettingsPanel({
  lang, setLang, paired, onOpenPair, onClearChat, onClearMemories, onClose,
}) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState("");
  const [tone, setTone] = useState("warm");
  const [replyLang, setReplyLang] = useState("tr");
  const [replyLangOpen, setReplyLangOpen] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [specialConsent, setSpecialConsent] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  // Which destructive confirmation is open: "consent" (withdrawing the
  // special-category consent) | "memories" | "account" | null.
  const [confirming, setConfirming] = useState(null);
  const [clearingMemories, setClearingMemories] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const consentSwitchId = useId();

  useEffect(() => {
    fetchProfile().then((p) => {
      setName(p.name || "");
      setNameSaved(p.name || "");
      setTone(p.profile?.tone || "warm");
      setReplyLang(p.language || "tr");
      setEmailVerified(!!p.email_verified);
      setBackupEnabled(!!p.backup_email_enabled);
      setSpecialConsent(!!p.special_data_consent);
    }).catch(() => {});
  }, []);

  const toggleBackup = async (next) => {
    setBackupEnabled(next);
    try {
      const p = await updateProfile({ backup_email_enabled: next });
      setBackupEnabled(!!p.backup_email_enabled);
      toast.success(t("Kaydedildi", "Saved"));
    } catch (e) {
      setBackupEnabled(!next);
      toast.error(e?.response?.data?.detail || t("Kaydedilemedi", "Couldn't save"));
    }
  };

  // Same optimistic/rollback shape as toggleBackup. Withdrawing (on → off)
  // is destructive on the backend (special-flagged memories and the AI
  // daily/monthly summaries are deleted), so that direction goes through a
  // confirmation first; granting saves straight away.
  const saveSpecialConsent = async (next) => {
    setSpecialConsent(next);
    setConsentSaving(true);
    try {
      const p = await updateProfile({ special_data_consent: next });
      setSpecialConsent(typeof p?.special_data_consent === "boolean" ? p.special_data_consent : next);
      toast.success(next
        ? t("Açık rızan kaydedildi", "Consent saved")
        : t("Açık rızan geri alındı", "Consent withdrawn"));
    } catch (e) {
      setSpecialConsent(!next);
      toast.error(e?.response?.data?.detail || t("Kaydedilemedi", "Couldn't save"));
    } finally {
      setConsentSaving(false);
      setConfirming(null);
    }
  };

  const toggleSpecialConsent = (next) => {
    if (!next && specialConsent) {
      setConfirming("consent");
      return;
    }
    saveSpecialConsent(next);
  };

  const confirmClearMemories = async () => {
    setClearingMemories(true);
    try {
      // Luna.jsx's handler closes this panel and toasts on success.
      await onClearMemories();
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("Anılar silinemedi, tekrar dene.", "Couldn't delete memories, try again."));
    } finally {
      setClearingMemories(false);
      setConfirming(null);
    }
  };

  const confirmDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      // deleteAccount() also signs this browser out — nothing below may
      // call the API again (see its comment in api.js), only redirect.
      await deleteAccount();
      setAccountDeleted(true);
      toast.success(t("Hesabın ve tüm verilerin silindi. Hoşça kal 💜", "Your account and all its data were deleted. Goodbye 💜"));
      setTimeout(() => { window.location.href = "/"; }, 1800);
    } catch (e) {
      setDeletingAccount(false);
      toast.error(e?.response?.data?.detail || t("Hesabın silinemedi, tekrar dene.", "Couldn't delete your account, try again."));
    }
  };

  const saveName = async (silent = false) => {
    if (name === nameSaved) return;
    try {
      await updateProfile({ name });
      setNameSaved(name);
      if (!silent) toast.success(t("Kaydedildi", "Saved"));
    } catch {
      if (!silent) toast.error(t("Kaydedilemedi", "Couldn't save"));
    }
  };

  // Auto-save shortly after typing stops — onBlur alone missed the common
  // case of typing a name then closing the tab/panel before ever blurring
  // the field, which silently discarded it (never reached the backend at
  // all). Silent (no toast) so it doesn't nag on every keystroke pause;
  // onBlur's toast still confirms an explicit save.
  useEffect(() => {
    if (name === nameSaved) return;
    const id = setTimeout(() => { saveName(true); }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const changeTone = async (key) => {
    setTone(key);
    try { await updateProfile({ tone: key }); } catch {}
  };

  const changeReplyLang = async (code) => {
    setReplyLang(code);
    setReplyLangOpen(false);
    try {
      await updateProfile({ language: code });
      toast.success(t("Kaydedildi", "Saved"));
    } catch {
      toast.error(t("Kaydedilemedi", "Couldn't save"));
    }
  };

  const handleSignOut = () => {
    signOut();
    window.location.href = "/";
  };

  // Flushes a still-pending name edit immediately instead of relying on the
  // 900ms debounce above — otherwise closing the panel right after typing
  // (before the debounce fires) discarded the edit just like the old
  // onBlur-only behavior did.
  const closeAndFlush = () => {
    saveName(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto"
      onClick={closeAndFlush} data-testid="settings-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-purple-400/20 p-6"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <SettingsIcon size={17} className="text-purple-300" /> {t("Ayarlar", "Settings")}
          </h2>
          <button onClick={closeAndFlush} data-testid="settings-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-colors">
            <X size={16} />
          </button>
        </div>

        <Section title={t("Profil", "Profile")}>
          <Row icon={User} label={t("İsim", "Name")}>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder={t("Adın", "Your name")} data-testid="settings-name-input"
              className="w-32 bg-black/25 outline-none px-3 py-1.5 rounded-full border border-purple-400/20 focus:border-purple-400 text-xs text-white text-right placeholder:text-white/30" />
          </Row>
        </Section>

        <Section title={t("Luna Davranışı", "Luna's Behavior")}>
          <div className="py-2.5">
            <span className="flex items-center gap-3 text-sm text-white/85 mb-2.5">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(192,132,252,0.12)" }}>
                <Sparkles size={15} className="text-purple-300" />
              </span>
              {t("Konuşma Tarzı", "Conversation Style")}
            </span>
            <div className="flex gap-1.5 ml-11">
              {TONES.map((tn) => (
                <button key={tn.key} onClick={() => changeTone(tn.key)} data-testid={`settings-tone-${tn.key}`}
                  className="text-[11px] px-2.5 py-1.5 rounded-full border transition-colors"
                  style={tone === tn.key
                    ? { borderColor: "#c084fc", color: "#fff", backgroundColor: "rgba(192,132,252,0.15)" }
                    : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
                  {t(tn.tr, tn.en)}
                </button>
              ))}
            </div>
          </div>
          <div className="py-2.5 relative">
            <span className="flex items-center gap-3 text-sm text-white/85 mb-2.5">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(192,132,252,0.12)" }}>
                <MessageCircle size={15} className="text-purple-300" />
              </span>
              {t("Luna'nın Konuştuğu Dil", "Luna's Reply Language")}
            </span>
            <div className="ml-11">
              <button data-testid="settings-reply-lang-button" onClick={() => setReplyLangOpen((o) => !o)}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-purple-400/30 text-purple-200 hover:bg-white/5 transition-colors">
                <span>{LANGUAGES.find((l) => l.code === replyLang)?.flag}</span>
                {LANGUAGES.find((l) => l.code === replyLang)?.label || replyLang.toUpperCase()}
              </button>
              {replyLangOpen && (
                <>
                  <div className="fixed inset-0 z-[95]" onClick={() => setReplyLangOpen(false)} />
                  <div className="absolute left-11 top-full mt-1 z-[96] rounded-xl border border-white/10 overflow-hidden min-w-[160px]"
                    style={{ backgroundColor: "#150f24", boxShadow: "0 12px 40px rgba(0,0,0,0.55)" }}>
                    {LANGUAGES.map((l) => (
                      <button key={l.code} data-testid={`settings-reply-lang-${l.code}`}
                        onClick={() => changeReplyLang(l.code)}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left hover:bg-white/5 transition-colors">
                        <span>{l.flag}</span>
                        <span className="flex-1 text-white/80">{l.label}</span>
                        {l.code === replyLang && <span className="text-purple-300">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Section>

        <Section title={t("Yedekleme", "Backup")}>
          <Row icon={Mail} label={t("Haftalık Sohbet Yedeği", "Weekly Chat Backup")}>
            <Switch checked={backupEnabled} onCheckedChange={toggleBackup} disabled={!emailVerified}
              data-testid="settings-backup-toggle" />
          </Row>
          {!emailVerified && (
            <p className="text-[11px] text-white/35 px-1 -mt-1">
              {t("Önce e-postanı bağlayıp doğrulaman gerekiyor.", "Link and verify your email first.")}
            </p>
          )}
        </Section>

        <Section title={t("Genel", "General")}>
          <Row icon={Globe} label={t("Dil", "Language")}>
            <button data-testid="settings-lang-toggle" onClick={() => setLang((l) => (l === "tr" ? "en" : "tr"))}
              className="text-xs font-mono font-bold px-3 py-1.5 rounded-full border border-purple-400/30 text-purple-200 hover:bg-purple-400 hover:text-black transition-colors">
              {lang === "tr" ? "TR" : "EN"}
            </button>
          </Row>
          <Row icon={Smartphone} label={t("Telefon Eşleşmesi", "Phone Pairing")}>
            <button data-testid="settings-pair-button" onClick={onOpenPair}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors"
              style={paired
                ? { borderColor: "rgba(74,222,128,0.4)", color: "#86efac", backgroundColor: "rgba(74,222,128,0.08)" }
                : { borderColor: "rgba(192,132,252,0.3)", color: "#e9d5ff" }}>
              {paired ? t("Eşleşti ✓", "Paired ✓") : t("Eşleştir", "Pair")}
            </button>
          </Row>
        </Section>

        <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300/60 mb-3">{t("Gizlilik ve Veri", "Privacy & Data")}</p>

          <div className="pb-3 mb-2 border-b border-white/[0.06]">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={consentSwitchId} className="flex items-center gap-2.5 text-sm text-white/85 cursor-pointer">
                <ShieldCheck size={15} className="text-purple-300 shrink-0" />
                {t("Özel nitelikli veriler için açık rıza", "Explicit consent for special-category data")}
              </label>
              <Switch id={consentSwitchId} checked={specialConsent} onCheckedChange={toggleSpecialConsent}
                disabled={consentSaving} data-testid="settings-special-consent-toggle" />
            </div>
            <p className="text-[11px] text-white/40 leading-relaxed mt-1.5 pl-[25px]">
              {t(
                "Açıksa Luna, sohbetlerinde paylaştığın sağlık, inanç gibi bilgileri hafızasına kaydedebilir. Kapalıysa kaydetmez.",
                "When on, Luna may save information you share in chats, such as health or beliefs, to its memory. When off, it doesn't."
              )}{" "}
              <LegalLink href={LEGAL_URLS.consent} className="text-purple-300/90 hover:text-purple-200">
                {t("Açık Rıza Metni", "Explicit Consent Notice")}
              </LegalLink>
            </p>
          </div>

          <button data-testid="settings-clear-chat" onClick={onClearChat}
            className="w-full flex items-center gap-2.5 text-sm text-red-300/85 hover:text-red-200 transition-colors py-1.5">
            <Trash2 size={15} /> {t("Sohbet geçmişini temizle", "Clear chat history")}
          </button>
          <button data-testid="settings-clear-memories" onClick={() => setConfirming("memories")}
            className="w-full flex items-center gap-2.5 text-sm text-red-300/85 hover:text-red-200 transition-colors py-1.5">
            <Trash2 size={15} /> {t("Tüm anıları sil", "Clear all memories")}
          </button>
          <button data-testid="settings-delete-account" onClick={() => setConfirming("account")}
            className="w-full flex items-center gap-2.5 text-sm font-semibold text-red-300/85 hover:text-red-200 transition-colors py-1.5">
            <UserX size={15} /> {t("Hesabımı sil", "Delete my account")}
          </button>

          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-white/40 mt-3 pt-3 border-t border-white/[0.06]">
            <LegalLink href={LEGAL_URLS.terms}>{t("Kullanım Şartları", "Terms of Use")}</LegalLink>
            <span aria-hidden="true">·</span>
            <LegalLink href={LEGAL_URLS.privacy}>{t("Gizlilik Politikası", "Privacy Policy")}</LegalLink>
            <span aria-hidden="true">·</span>
            <LegalLink href={LEGAL_URLS.kvkk}>{t("KVKK Aydınlatma Metni", "KVKK Privacy Notice")}</LegalLink>
          </p>
        </div>

        <button onClick={handleSignOut} data-testid="settings-sign-out"
          className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-white/40 hover:text-white transition-colors py-2">
          <LogOut size={14} /> {t("Bu cihazdan çıkış yap", "Sign out of this device")}
        </button>

        <ConfirmDialog
          open={confirming === "consent"}
          danger
          busy={consentSaving}
          title={t("Açık rızanı geri almak istiyor musun?", "Withdraw your consent?")}
          body={consentWithdrawalBody(t)}
          confirmLabel={t("İznimi geri al", "Withdraw consent")}
          cancelLabel={t("Vazgeç", "Cancel")}
          onConfirm={() => saveSpecialConsent(false)}
          onCancel={() => setConfirming(null)}
        />

        <ConfirmDialog
          open={confirming === "memories"}
          danger
          busy={clearingMemories}
          title={t("Tüm anıları silmek istiyor musun?", "Delete all memories?")}
          body={t(
            "Tüm anıların kalıcı olarak silinecek. Bu işlem geri alınamaz.",
            "All your memories will be permanently deleted. This can't be undone."
          )}
          confirmLabel={t("Tümünü sil", "Delete all")}
          cancelLabel={t("Vazgeç", "Cancel")}
          onConfirm={confirmClearMemories}
          onCancel={() => setConfirming(null)}
        />

        <ConfirmDialog
          open={confirming === "account"}
          danger
          busy={deletingAccount}
          title={t("Hesabını silmek istiyor musun?", "Delete your account?")}
          body={accountDeletionBody(t)}
          confirmLabel={accountDeleted
            ? t("Hesabın silindi, yönlendiriliyorsun...", "Account deleted, redirecting...")
            : t("Hesabımı kalıcı olarak sil", "Permanently delete my account")}
          cancelLabel={t("Vazgeç", "Cancel")}
          onConfirm={confirmDeleteAccount}
          onCancel={() => setConfirming(null)}
        />
      </div>
    </div>
  );
}
