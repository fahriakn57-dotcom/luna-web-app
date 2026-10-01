import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Settings as SettingsIcon, User, Smartphone, Languages, Mail, ShieldCheck, Scale, MessageSquareX, Brain, UserX,
  LogOut, Check, ChevronDown, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import ConfirmDialog from "@/components/ConfirmDialog";
import { accountDeletionBody, consentWithdrawalBody } from "@/lib/legalCopy";
import LegalLink, { LEGAL_URLS } from "@/components/LegalLink";
import { fetchProfile, updateProfile, signOut, deleteAccount, getReplyLang, setReplyLang } from "@/lib/api";
import { LANGUAGES, langLabel } from "@/lib/languages";
import { locale } from "@/lib/dates";
import {
  Panel, PanelHeader, PanelBody, Segmented, SectionLabel, SkeletonList, ErrorState, ACCENTS, fieldClass, usePanelTitleId,
} from "@/components/panel/Panel";

const TONES = [
  {
    key: "warm", tr: "Daha samimi", trShort: "Samimi", en: "Warmer", enShort: "Warm",
    descTr: "Sıcak ve arkadaşça konuşur, sohbeti yakın tutar.",
    descEn: "Warm and friendly, keeps the conversation personal.",
  },
  {
    key: "neutral", tr: "Dengeli", trShort: "Dengeli", en: "Balanced", enShort: "Balanced",
    descTr: "Sakin ve dengeli konuşur; ne fazla resmi ne fazla samimi.",
    descEn: "Calm and balanced, neither too formal nor too casual.",
  },
  {
    key: "technical", tr: "Daha profesyonel", trShort: "Profesyonel", en: "More professional", enShort: "Professional",
    descTr: "Net ve doğrudan konuşur, lafı dolandırmaz.",
    descEn: "Clear and direct, gets straight to the point.",
  },
];

const cardClass = "rounded-2xl border border-white/[0.07] bg-white/[0.03]";

// The shadcn Switch ships light-theme tokens (near-black when on, light grey
// when off), which look the same on this dark surface. The pseudo-element
// widens its 36x20 hit area to a comfortable touch target.
const switchClass =
  "relative data-[state=checked]:bg-violet-500 data-[state=unchecked]:bg-white/15 " +
  "focus-visible:ring-violet-300/70 focus-visible:ring-offset-[#0d0a1a] " +
  "before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']";

const dangerButtonClass =
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl min-h-[40px] px-3.5 text-[13px] font-semibold " +
  "text-rose-200 border border-rose-400/25 bg-rose-500/[0.08] transition-colors hover:bg-rose-500/[0.16] hover:text-rose-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 disabled:opacity-40";

// FastAPI validation errors put a list in `detail`; only pass plain strings through.
const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
};

function IconTile({ icon: Icon, accent = "violet" }) {
  const tone = ACCENTS[accent] || ACCENTS.violet;
  return (
    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: tone.tile }}>
      <Icon size={17} style={{ color: tone.fg }} aria-hidden="true" />
    </span>
  );
}

// icon tile + title + one-line description + control. `stack` puts the
// control under the text on phones (for wide controls like the language
// picker); switches and short buttons stay on the right.
function SettingRow({ icon, accent, title, titleFor, description, descriptionId, children, stack = false, alignTop = false }) {
  const Title = titleFor ? "label" : "p";
  return (
    <div className="flex items-start gap-3 sm:gap-3.5 px-4 py-3.5">
      <IconTile icon={icon} accent={accent} />
      <div className={`min-w-0 flex-1 flex ${stack
        ? "flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
        : `gap-3 ${alignTop ? "items-start" : "items-center"}`}`}>
        <div className="min-w-0 flex-1 pt-px">
          <Title htmlFor={titleFor} className={`block text-sm font-medium text-white leading-snug ${titleFor ? "cursor-pointer" : ""}`}>
            {title}
          </Title>
          {description && <div id={descriptionId} className="mt-0.5 text-[12.5px] leading-relaxed text-white/50">{description}</div>}
        </div>
        {children && <div className={`shrink-0 ${alignTop ? "pt-1" : ""}`}>{children}</div>}
      </div>
    </div>
  );
}

function CodeBadge({ code, active }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-none tabular-nums ${
      active ? "bg-violet-400/20 text-violet-100" : "bg-white/[0.08] text-white/55"
    }`}>
      {code.toUpperCase()}
    </span>
  );
}

function ProfileAvatar({ name, lang }) {
  const first = Array.from(name.trim())[0];
  return (
    <span aria-hidden="true"
      className="relative w-14 h-14 rounded-full shrink-0 flex items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 ring-4 ring-violet-400/10 shadow-[0_10px_30px_-10px_rgba(192,38,211,0.7),inset_0_1px_0_rgba(255,255,255,0.25)]">
      {first
        ? <span className="text-[22px] font-semibold text-white">{first.toLocaleUpperCase(locale(lang))}</span>
        : <User size={24} className="text-white/90" />}
    </span>
  );
}

function SettingsSkeleton({ label }) {
  const pulse = "animate-pulse motion-reduce:animate-none";
  return (
    <div className="space-y-6">
      <div aria-hidden="true" className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 sm:p-5">
        <div className={`h-14 w-14 shrink-0 rounded-full bg-white/[0.07] ${pulse}`} />
        <div className="flex-1 space-y-2.5">
          <div className={`h-3 w-16 rounded-full bg-white/[0.07] ${pulse}`} />
          <div className={`h-10 rounded-xl bg-white/[0.05] ${pulse}`} />
        </div>
      </div>
      <SkeletonList rows={3} label={label} />
    </div>
  );
}

export default function SettingsPanel({
  lang, setLang, paired, onOpenPair, onClearChat, onClearMemories, onClose,
}) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const nameId = useId();
  const backupSwitchId = useId();
  const backupDescId = useId();
  const consentSwitchId = useId();
  const consentDescId = useId();
  const langListId = useId();

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState("");
  const [nameStatus, setNameStatus] = useState("idle"); // idle | saving | saved | error
  const [tone, setTone] = useState("warm");
  const [language, setLanguage] = useState(() => getReplyLang() || lang);
  const [langOpen, setLangOpen] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);
  const [specialConsent, setSpecialConsent] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  // Which confirmation is open: "consent" (withdrawing the special-category
  // consent) | "chat" | "memories" | "account" | null.
  const [confirming, setConfirming] = useState(null);
  const [clearingChat, setClearingChat] = useState(false);
  const [clearingMemories, setClearingMemories] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);

  const langWrapRef = useRef(null);
  const langButtonRef = useRef(null);
  // Set right before signing out / after deleting the account: from then on
  // nothing may call the API (with the device credentials gone,
  // authHeaders() would silently mint a brand-new anonymous account).
  const leavingRef = useRef(false);
  // The name value currently being sent — blur, the debounce and the close
  // flush can all fire for the same edit; it only needs to go out once.
  const savingNameRef = useRef(null);
  // Set once the panel is closing: a name save that fails after that can no
  // longer show its inline status, so it toasts instead.
  const closedRef = useRef(false);
  // The control that opened a confirmation, to give focus back on cancel.
  const confirmTriggerRef = useRef(null);
  // Rapid tone picks can fail out of order: only the latest one rolls back,
  // and it rolls back to what the server last confirmed.
  const toneRequestRef = useRef(0);
  const savedToneRef = useRef("warm");

  const loadProfile = useCallback(async () => {
    setStatus("loading");
    try {
      const p = await fetchProfile();
      setName(p.name || "");
      setNameSaved(p.name || "");
      setTone(p.profile?.tone || "warm");
      savedToneRef.current = p.profile?.tone || "warm";
      // Every chat message re-posts `getReplyLang() || interface language`,
      // so a stored TR/EN server value without a local choice is about to be
      // overwritten — only a non-TR/EN one is a real choice made elsewhere.
      const serverLang = p.profile?.language;
      const chosenElsewhere = serverLang && serverLang !== "tr" && serverLang !== "en" ? serverLang : null;
      setLanguage((current) => getReplyLang() || chosenElsewhere || current);
      setEmailVerified(!!p.email_verified);
      setBackupEnabled(!!p.backup_email_enabled);
      setSpecialConsent(!!p.special_data_consent);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveName = async () => {
    const value = name;
    if (value === nameSaved || leavingRef.current || savingNameRef.current === value) return;
    savingNameRef.current = value;
    setNameStatus("saving");
    try {
      await updateProfile({ name: value });
      setNameSaved(value);
      setNameStatus("saved");
    } catch {
      setNameStatus("error");
      if (closedRef.current && !leavingRef.current) {
        toast.error(t("Adın kaydedilemedi. Ayarları açıp tekrar dene.", "Couldn't save your name. Open Settings and try again."));
      }
    } finally {
      if (savingNameRef.current === value) savingNameRef.current = null;
    }
  };
  const saveNameRef = useRef(saveName);
  saveNameRef.current = saveName;

  // Auto-save shortly after typing stops — onBlur alone missed the common
  // case of typing a name then closing the tab/panel before ever blurring
  // the field, which silently discarded it.
  useEffect(() => {
    if (name === nameSaved) return undefined;
    const id = setTimeout(() => { saveNameRef.current(); }, 900);
    return () => clearTimeout(id);
  }, [name, nameSaved]);

  useEffect(() => {
    if (nameStatus !== "saved") return undefined;
    const id = setTimeout(() => setNameStatus("idle"), 2200);
    return () => clearTimeout(id);
  }, [nameStatus]);

  // The parent also unmounts this panel itself (pairing, clearing chat or
  // memories) without going through closeAndFlush — don't drop a name typed
  // just before. saveName skips it when the close flush already sent it.
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      saveNameRef.current();
    };
  }, []);

  // Flushes a still-pending name edit immediately instead of waiting for the
  // 900ms debounce — closing right after typing used to discard the edit.
  const closeAndFlush = () => {
    closedRef.current = true;
    saveName();
    onClose();
  };

  const openConfirm = (kind) => {
    confirmTriggerRef.current = document.activeElement;
    setConfirming(kind);
  };
  const closeConfirm = () => {
    setConfirming(null);
    const trigger = confirmTriggerRef.current;
    confirmTriggerRef.current = null;
    if (trigger?.isConnected && typeof trigger.focus === "function") trigger.focus({ preventScroll: true });
  };

  const changeTone = async (key) => {
    if (key === tone) return;
    const request = ++toneRequestRef.current;
    setTone(key);
    try {
      await updateProfile({ tone: key });
      savedToneRef.current = key;
    } catch (e) {
      // A newer pick has already replaced this one — don't roll back over it.
      if (request !== toneRequestRef.current) return;
      setTone(savedToneRef.current);
      toast.error(apiError(e, t("Konuşma tarzı kaydedilemedi. Tekrar dene.", "Couldn't save the conversation style. Try again.")));
    }
  };

  // The reply language lives on this device (getReplyLang) and is re-posted
  // to the profile before every message, so a failed profile write here
  // still takes effect on the next message — no rollback needed.
  const chooseLanguage = (code) => {
    setLanguage(code);
    setLangOpen(false);
    setReplyLang(code);
    setLang(code === "tr" ? "tr" : "en");
    updateProfile({ language: code }).catch(() => {});
    langButtonRef.current?.focus();
  };

  // Escape (captured before the Panel's own listener, which skips
  // defaultPrevented events) and outside clicks close only the picker. A
  // click, not pointerdown: on phones a touch that only scrolls the panel
  // must not collapse the list mid-scroll.
  useEffect(() => {
    if (!langOpen) return undefined;
    langWrapRef.current?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    langWrapRef.current?.scrollIntoView?.({ block: "nearest" });
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setLangOpen(false);
      langButtonRef.current?.focus();
    };
    const onOutside = (e) => {
      if (!langWrapRef.current?.contains(e.target)) setLangOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onOutside);
    };
  }, [langOpen]);

  const toggleBackup = async (next) => {
    setBackupEnabled(next);
    setBackupSaving(true);
    try {
      const p = await updateProfile({ backup_email_enabled: next });
      setBackupEnabled(!!p.backup_email_enabled);
      toast.success(next ? t("Haftalık yedek açıldı", "Weekly backup turned on") : t("Haftalık yedek kapatıldı", "Weekly backup turned off"));
    } catch (e) {
      setBackupEnabled(!next);
      toast.error(apiError(e, t("Yedekleme ayarı kaydedilemedi. Tekrar dene.", "Couldn't save the backup setting. Try again.")));
    } finally {
      setBackupSaving(false);
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
      toast.error(apiError(e, t("Açık rıza tercihin kaydedilemedi. Tekrar dene.", "Couldn't save your consent choice. Try again.")));
    } finally {
      setConsentSaving(false);
      closeConfirm();
    }
  };

  const toggleSpecialConsent = (next) => {
    if (!next && specialConsent) {
      openConfirm("consent");
      return;
    }
    saveSpecialConsent(next);
  };

  const confirmClearChat = async () => {
    setClearingChat(true);
    try {
      // Luna.jsx's handler closes this panel and toasts on success.
      await onClearChat();
    } catch (e) {
      toast.error(apiError(e, t("Sohbet geçmişi temizlenemedi. Tekrar dene.", "Couldn't clear the chat history. Try again.")));
    } finally {
      setClearingChat(false);
      closeConfirm();
    }
  };

  const confirmClearMemories = async () => {
    setClearingMemories(true);
    try {
      // Luna.jsx's handler closes this panel and toasts on success.
      await onClearMemories();
    } catch (e) {
      toast.error(apiError(e, t("Anılar silinemedi. Tekrar dene.", "Couldn't delete memories. Try again.")));
    } finally {
      setClearingMemories(false);
      closeConfirm();
    }
  };

  const confirmDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    leavingRef.current = true;
    try {
      // deleteAccount() also signs this browser out — nothing below may
      // call the API again (see its comment in api.js), only redirect.
      await deleteAccount();
      setAccountDeleted(true);
      toast.success(t("Hesabın ve verilerin silindi. Hoşça kal.", "Your account and your data were deleted. Goodbye."));
      setTimeout(() => { window.location.href = "/"; }, 1800);
    } catch (e) {
      leavingRef.current = false;
      setDeletingAccount(false);
      toast.error(apiError(e, t("Hesabın silinemedi. Tekrar dene.", "Couldn't delete your account. Try again.")));
    }
  };

  const handleSignOut = () => {
    leavingRef.current = true;
    signOut();
    window.location.href = "/";
  };

  // Other clients may store a tone this panel doesn't offer (e.g. "playful").
  const selectedTone = TONES.find((x) => x.key === tone);
  const toneOptions = TONES.map((x) => ({
    value: x.key,
    label: (
      <>
        <span className="sm:hidden">{t(x.trShort, x.enShort)}</span>
        <span className="hidden sm:inline">{t(x.tr, x.en)}</span>
      </>
    ),
  }));
  const nameDirty = name !== nameSaved;

  return (
    <Panel onClose={closeAndFlush} size="lg" accent="violet" labelledBy={titleId} testId="settings-panel">
      <PanelHeader
        icon={SettingsIcon}
        accent="violet"
        title={t("Ayarlar", "Settings")}
        subtitle={t("Profilin, Luna'nın tarzı ve gizlilik tercihlerin", "Your profile, Luna's style and your privacy choices")}
        titleId={titleId}
        onClose={closeAndFlush}
        closeLabel={t("Kapat", "Close")}
        closeTestId="settings-close-button"
      />

      <PanelBody className="space-y-6">
        {status === "loading" && <SettingsSkeleton label={t("Ayarlar yükleniyor", "Loading settings")} />}

        {status === "error" && (
          <ErrorState
            title={t("Ayarların yüklenemedi", "Couldn't load your settings")}
            body={t("Bağlantını kontrol edip tekrar dene.", "Check your connection and try again.")}
            onRetry={loadProfile}
            retryLabel={t("Tekrar dene", "Try again")}
          />
        )}

        {status === "ready" && (
          <>
            {/* Profile */}
            <section className={`${cardClass} relative overflow-hidden`} aria-label={t("Profil", "Profile")}>
              <div aria-hidden="true" className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-fuchsia-500/10 blur-3xl" />
              <div className="relative flex items-center gap-4 p-4 sm:p-5">
                <ProfileAvatar name={name} lang={lang} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[20px]">
                    <label htmlFor={nameId} className="text-xs font-medium text-white/55">{t("Adın", "Your name")}</label>
                    <span role="status" aria-live="polite" className="text-[11.5px] font-medium">
                      {nameStatus === "saving" && (
                        <span className="inline-flex items-center gap-1 text-white/45">
                          <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          {t("Kaydediliyor", "Saving")}
                        </span>
                      )}
                      {nameStatus === "saved" && !nameDirty && (
                        <span className="inline-flex items-center gap-1 text-emerald-300/85">
                          <Check size={12} aria-hidden="true" /> {t("Kaydedildi", "Saved")}
                        </span>
                      )}
                      {nameStatus === "error" && (
                        <span className="inline-flex items-center gap-1.5 text-rose-300">
                          {t("Kaydedilemedi", "Not saved")}
                          <button type="button" onClick={() => saveName()} data-testid="settings-name-retry"
                            className="rounded font-semibold text-white/80 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
                            {t("Tekrar dene", "Retry")}
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                  <input id={nameId} value={name} maxLength={80} autoComplete="given-name"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => saveName()}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    placeholder={t("Luna sana nasıl hitap etsin?", "What should Luna call you?")}
                    data-testid="settings-name-input"
                    className={`${fieldClass} text-[15px] font-medium`} />
                </div>
              </div>
              <div className="relative border-t border-white/[0.06]">
                <SettingRow
                  icon={Smartphone}
                  accent={paired ? "emerald" : "sky"}
                  title={t("Telefon eşleşmesi", "Phone pairing")}
                  description={paired
                    ? t("Bu tarayıcı telefonundaki Luna'ya bağlı.", "This browser is linked to Luna on your phone.")
                    : t("Bu tarayıcıyı telefonundaki Luna'yla aynı hafızaya bağla.", "Link this browser to the same memory as Luna on your phone.")}
                >
                  <button type="button" data-testid="settings-pair-button" onClick={onOpenPair}
                    className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl min-h-[40px] px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
                      paired
                        ? "border border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200 hover:bg-emerald-400/[0.14]"
                        : "border border-white/[0.12] bg-white/[0.04] text-white/85 hover:bg-white/[0.08] hover:text-white"
                    }`}>
                    {paired && <Check size={14} aria-hidden="true" />}
                    {paired ? t("Eşleşti", "Paired") : t("Eşleştir", "Pair")}
                  </button>
                </SettingRow>
              </div>
            </section>

            {/* Luna's style */}
            <section>
              <SectionLabel>{t("Luna'nın tarzı", "Luna's style")}</SectionLabel>
              <div className={`${cardClass} p-4`}>
                <div className="[&>div]:flex [&>div]:w-full [&_button]:grow [&_button]:basis-0 [&_button]:min-h-[40px] [&_button]:px-2.5 sm:[&_button]:px-3.5">
                  <Segmented options={toneOptions} value={tone} onChange={changeTone}
                    label={t("Konuşma tarzı", "Conversation style")} testIdPrefix="settings-tone" />
                </div>
                <p className="mt-3 px-1 text-[13px] leading-relaxed text-white/60" aria-live="polite">
                  {selectedTone
                    ? t(selectedTone.descTr, selectedTone.descEn)
                    : t("Luna'nın seninle nasıl konuşacağını seç.", "Choose how Luna talks to you.")}
                </p>
              </div>
            </section>

            {/* Preferences */}
            <section>
              <SectionLabel>{t("Tercihler", "Preferences")}</SectionLabel>
              <div className={`${cardClass} divide-y divide-white/[0.06]`}>
                <div ref={langWrapRef}>
                  <SettingRow
                    icon={Languages}
                    accent="sky"
                    title={t("Dil", "Language")}
                    description={t(
                      "Arayüz Türkçe veya İngilizce görünür; Luna seçtiğin dilde cevap verir.",
                      "The interface shows in Turkish or English; Luna replies in the language you pick."
                    )}
                    stack
                  >
                    <button ref={langButtonRef} type="button" data-testid="settings-reply-lang-button"
                      aria-label={`${t("Dil", "Language")}: ${langLabel(language)}`}
                      aria-expanded={langOpen} aria-controls={langListId} onClick={() => setLangOpen((o) => !o)}
                      className="inline-flex w-full sm:w-auto sm:min-w-[160px] items-center justify-between gap-3 rounded-xl min-h-[40px] pl-3.5 pr-3 text-sm font-medium text-white border border-white/10 bg-white/[0.04] transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{langLabel(language)}</span>
                        <CodeBadge code={language} />
                      </span>
                      <ChevronDown size={16} aria-hidden="true"
                        className={`shrink-0 text-white/45 transition-transform motion-reduce:transition-none ${langOpen ? "rotate-180" : ""}`} />
                    </button>
                  </SettingRow>
                  {langOpen && (
                    <div id={langListId} role="group" aria-label={t("Dil seç", "Choose a language")}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-4 pb-4 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
                      {LANGUAGES.map((l) => {
                        const active = l.code === language;
                        return (
                          <button key={l.code} type="button" aria-pressed={active} data-testid={`settings-reply-lang-${l.code}`}
                            onClick={() => chooseLanguage(l.code)}
                            className={`flex items-center justify-between gap-2 rounded-xl border min-h-[44px] px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${
                              active
                                ? "border-violet-300/40 bg-violet-400/[0.12] text-white"
                                : "border-white/[0.08] bg-white/[0.02] text-white/75 hover:bg-white/[0.06] hover:text-white"
                            }`}>
                            <span className="flex items-center gap-2 min-w-0">
                              <CodeBadge code={l.code} active={active} />
                              <span className="truncate font-medium">{l.label}</span>
                            </span>
                            {active && <Check size={15} className="shrink-0 text-violet-200" aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <SettingRow
                  icon={Mail}
                  accent="emerald"
                  title={t("Haftalık sohbet yedeği", "Weekly chat backup")}
                  titleFor={backupSwitchId}
                  descriptionId={backupDescId}
                  description={
                    <>
                      {t("Son 7 günün sohbeti her hafta e-postana gelir.", "Your last 7 days of chat, emailed to you every week.")}
                      {!emailVerified && (
                        <span className="block mt-1 text-amber-200/75">
                          {t("Önce e-postanı bağlayıp doğrulaman gerekiyor.", "Link and verify your email first.")}
                        </span>
                      )}
                    </>
                  }
                >
                  {/* Turning it off never needs a verified email (the backend allows it). */}
                  <Switch id={backupSwitchId} checked={backupEnabled} onCheckedChange={toggleBackup}
                    disabled={(!emailVerified && !backupEnabled) || backupSaving} className={switchClass}
                    aria-describedby={backupDescId} data-testid="settings-backup-toggle" />
                </SettingRow>
              </div>
            </section>

            {/* Privacy */}
            <section>
              <SectionLabel>{t("Gizlilik", "Privacy")}</SectionLabel>
              <div className={`${cardClass} divide-y divide-white/[0.06]`}>
                <SettingRow
                  icon={ShieldCheck}
                  accent="violet"
                  title={t("Özel nitelikli veriler için açık rıza", "Explicit consent for special-category data")}
                  titleFor={consentSwitchId}
                  descriptionId={consentDescId}
                  alignTop
                  description={
                    <>
                      {t(
                        "Açıksa Luna, sohbetlerinde paylaştığın sağlık, inanç gibi bilgileri hafızasına kaydedebilir. Kapalıysa kaydetmez.",
                        "When on, Luna may save information you share in chats, such as health or beliefs, to its memory. When off, it doesn't."
                      )}{" "}
                      <LegalLink href={LEGAL_URLS.consent} className="text-violet-300 hover:text-violet-200">
                        {t("Açık Rıza Metni", "Explicit Consent Notice")}
                      </LegalLink>
                    </>
                  }
                >
                  <Switch id={consentSwitchId} checked={specialConsent} onCheckedChange={toggleSpecialConsent}
                    disabled={consentSaving} className={switchClass} aria-describedby={consentDescId}
                    data-testid="settings-special-consent-toggle" />
                </SettingRow>
                <SettingRow
                  icon={Scale}
                  accent="indigo"
                  title={t("Yasal metinler", "Legal")}
                  description={
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <LegalLink href={LEGAL_URLS.terms} className="py-1 text-white/65 hover:text-white">{t("Kullanım Şartları", "Terms of Use")}</LegalLink>
                      <span aria-hidden="true" className="text-white/25">·</span>
                      <LegalLink href={LEGAL_URLS.privacy} className="py-1 text-white/65 hover:text-white">{t("Gizlilik Politikası", "Privacy Policy")}</LegalLink>
                      <span aria-hidden="true" className="text-white/25">·</span>
                      <LegalLink href={LEGAL_URLS.kvkk} className="py-1 text-white/65 hover:text-white">{t("KVKK Aydınlatma Metni", "KVKK Privacy Notice")}</LegalLink>
                    </span>
                  }
                />
              </div>
            </section>

            {/* Danger zone */}
            <section>
              <SectionLabel>{t("Tehlikeli işlemler", "Danger zone")}</SectionLabel>
              <div className="rounded-2xl border border-rose-400/[0.15] bg-rose-500/[0.04] divide-y divide-rose-300/[0.08]">
                <SettingRow
                  icon={MessageSquareX}
                  accent="rose"
                  title={t("Sohbet geçmişini temizle", "Clear chat history")}
                  description={t("Açık olan sohbetin mesajları silinir, anıların kalır.", "The open chat's messages are deleted; memories stay.")}
                >
                  <button type="button" data-testid="settings-clear-chat" onClick={() => openConfirm("chat")} className={dangerButtonClass}>
                    {t("Temizle", "Clear")}
                  </button>
                </SettingRow>
                <SettingRow
                  icon={Brain}
                  accent="rose"
                  title={t("Tüm anıları sil", "Delete all memories")}
                  description={t("Anılarım'daki tüm anılar kalıcı olarak silinir.", "Every memory in My Memories is permanently deleted.")}
                >
                  <button type="button" data-testid="settings-clear-memories" onClick={() => openConfirm("memories")} className={dangerButtonClass}>
                    {t("Sil", "Delete")}
                  </button>
                </SettingRow>
                <SettingRow
                  icon={UserX}
                  accent="rose"
                  title={t("Hesabımı sil", "Delete my account")}
                  description={t("Hesabın ve ona bağlı verilerin kalıcı olarak silinir.", "Your account and the data tied to it are permanently deleted.")}
                >
                  <button type="button" data-testid="settings-delete-account" onClick={() => openConfirm("account")} className={dangerButtonClass}>
                    {t("Hesabı sil", "Delete account")}
                  </button>
                </SettingRow>
              </div>
            </section>
          </>
        )}

        <button type="button" onClick={handleSignOut} data-testid="settings-sign-out"
          className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-white/[0.07] bg-white/[0.02] text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
          <LogOut size={15} aria-hidden="true" /> {t("Bu cihazdan çıkış yap", "Sign out of this device")}
        </button>
      </PanelBody>

      <ConfirmDialog
        open={confirming === "consent"}
        danger
        busy={consentSaving}
        title={t("Açık rızanı geri almak istiyor musun?", "Withdraw your consent?")}
        body={consentWithdrawalBody(t)}
        confirmLabel={t("İznimi geri al", "Withdraw consent")}
        cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={() => saveSpecialConsent(false)}
        onCancel={closeConfirm}
      />

      <ConfirmDialog
        open={confirming === "chat"}
        danger
        busy={clearingChat}
        title={t("Sohbet geçmişini temizlemek istiyor musun?", "Clear your chat history?")}
        body={t(
          "Şu an açık olan sohbetin tüm mesajları kalıcı olarak silinecek. Diğer sohbetlerin ve Luna'nın anıları silinmez. Bu işlem geri alınamaz.",
          "Every message in the chat that's open right now will be permanently deleted. Your other chats and Luna's memories stay. This can't be undone."
        )}
        confirmLabel={t("Temizle", "Clear")}
        cancelLabel={t("Vazgeç", "Cancel")}
        onConfirm={confirmClearChat}
        onCancel={closeConfirm}
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
        onCancel={closeConfirm}
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
        onCancel={closeConfirm}
      />
    </Panel>
  );
}
