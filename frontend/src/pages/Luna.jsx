import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import lunaBg from "@/assets/luna-bg.jpg";
import BootSequence from "@/components/BootSequence";
import MemoryPanel from "@/components/MemoryPanel";
import MoodPanel from "@/components/MoodPanel";
import DayInfoPanel from "@/components/DayInfoPanel";
import UsagePanel from "@/components/UsagePanel";
import PairDeviceModal from "@/components/PairDeviceModal";
import SettingsPanel from "@/components/SettingsPanel";
import Sidebar from "@/components/Sidebar";
import FriendPanel from "@/components/FriendPanel";
import NotesPanel from "@/components/NotesPanel";
import GoalsPanel from "@/components/GoalsPanel";
import RemindersPanel from "@/components/RemindersPanel";
import JournalPanel from "@/components/JournalPanel";
import HobbiesPanel from "@/components/HobbiesPanel";
import ImageGalleryPanel from "@/components/ImageGalleryPanel";
import ConversationsPanel from "@/components/ConversationsPanel";
import DocGeneratorPanel from "@/components/DocGeneratorPanel";
import PremiumPanel from "@/components/PremiumPanel";
import VoiceCallModal from "@/components/VoiceCallModal";
import TermsGate from "@/components/TermsGate";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  sendChat, sendMedia, sendMediaBatch, generateImage, clearMessages, fetchMessages, fetchTTS, clearMemories, isPaired, fetchProfile,
  generatePdf, generateExcel, generateWord, generatePpt, generateTableImage, generateChart,
} from "@/lib/api";

// Wand-menu doc kinds (everything except "image", which already has its own
// generateImage/imageUrl path) — one shared handler below drives all of
// them straight from the chat composer instead of the old modal form.
// Minimum time the "Görsel çiziliyor..." state stays visible before the
// image reply appears, even if the backend already responded sooner.
const MIN_IMAGE_GEN_MS = 10000;

const DOC_GEN_CONFIG = {
  pdf: { generate: generatePdf, ext: "pdf" },
  word: { generate: generateWord, ext: "docx" },
  ppt: { generate: generatePpt, ext: "pptx" },
  excel: { generate: generateExcel, ext: "xlsx" },
  table: { generate: generateTableImage, ext: "png" },
  chart: { generate: generateChart, ext: "png" },
};

const WELCOME_LINES = {
  friend: {
    tr: (name) => `Hoş geldin${name ? `, ${name}` : ""}! 🌙 Seni tekrar görmek güzel — bugün nasıl geçiyor?`,
    en: (name) => `Welcome back${name ? `, ${name}` : ""}! 🌙 Good to see you — how's your day going?`,
  },
  work: {
    tr: (name) => `Hoş geldin${name ? `, ${name}` : ""}! 🌙 LunaWorks hazır — görsel, PDF, Excel, Word, ne istersen üretmeye başlayalım.`,
    en: (name) => `Welcome back${name ? `, ${name}` : ""}! 🌙 LunaWorks is ready — let's create an image, PDF, Excel, Word, whatever you need.`,
  },
};

function buildWelcomeMessage(mode, lang, name) {
  const key = mode === "work" ? "work" : "friend";
  const text = WELCOME_LINES[key][lang === "tr" ? "tr" : "en"](name);
  return { id: "welcome-" + Date.now(), role: "luna", text, mode };
}

export default function Luna() {
  const [booting, setBooting] = useState(() => !sessionStorage.getItem("luna_booted"));
  const [mode, setMode] = useState(() => {
    // "jarvis" is a stale value from before L.U.N.A. Modu was removed —
    // never let an old localStorage entry land a user on a mode that no
    // longer renders anything.
    const saved = localStorage.getItem("luna_mode");
    return saved === "jarvis" ? "friend" : saved || "friend";
  });
  const [lang, setLang] = useState(() => localStorage.getItem("luna_lang") || "tr");
  const [mood, setMood] = useState(() => localStorage.getItem("luna_mood") || "good");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [paired, setPaired] = useState(isPaired());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState(null); // "journal" | "goals" | "notes" | "alarms" | "mood" | "day-info" | "usage" | null
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  // null = the default, single ever-growing thread for this mode (unchanged
  // behavior from before Sohbetler existed — just a fresh greeting each
  // visit). A real id means a specific past/new chat is open — its actual
  // transcript loads instead (see the mode/conversationId effect below).
  const [conversationId, setConversationId] = useState(null);
  const [premiumOpen, setPremiumOpen] = useState(false);
  // The profile, kept only while its terms still need (re-)accepting — see
  // the mount effect below; null = nothing to accept.
  const [termsProfile, setTermsProfile] = useState(null);
  const [userName, setUserName] = useState("");
  // True only while the dedicated voice-call screen is open — the only
  // place Luna speaks replies aloud; normal chat stays silent.
  const [callActive, setCallActive] = useState(false);
  // Read at the moment a reply/TTS arrives, not when the request started —
  // closing the call mid-request must keep Luna silent.
  const callActiveRef = useRef(false);
  callActiveRef.current = callActive;

  const audioRef = useRef(null);
  const t = (tr, en) => (lang === "tr" ? tr : en);
  // A plan-quota 429 carries a curated reason already translated into the
  // account's language (free plan's daily count, or a paid plan's weekly /
  // 30-day quota) — show it instead of guessing "daily". A rate-limit 429
  // (it has Retry-After) gets our own localized text instead of its
  // Turkish-only detail. null for other errors.
  const quotaMessage = (e) => {
    if (e?.response?.status !== 429) return null;
    if (e.response.headers?.["retry-after"]) {
      return t("Çok hızlı gidiyorsun, birkaç saniye sonra tekrar dene.", "You're going a bit fast — try again in a few seconds.");
    }
    const detail = e.response.data?.detail;
    return (typeof detail === "string" && detail) || t("Kullanım sınırına ulaştın.", "You've reached your usage limit.");
  };

  useEffect(() => { localStorage.setItem("luna_mode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("luna_lang", lang); }, [lang]);
  useEffect(() => { localStorage.setItem("luna_mood", mood); }, [mood]);

  // The browser lands back here after an iyzico checkout (see
  // routers/subscription.py::billing_callback's RedirectResponse to
  // `${PUBLIC_APP_URL}/app?billing=success|failed|error`) — surface the
  // result once, then strip the query param so a refresh doesn't re-fire it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "success") {
      toast.success(t("Ödeme alındı — Premium aktif! 🎉", "Payment received — Premium is active! 🎉"));
      setPremiumOpen(true);
    } else if (billing === "failed") {
      toast.error(t("Ödeme tamamlanamadı. Tekrar deneyebilirsin.", "Payment didn't go through. You can try again."));
      setPremiumOpen(true);
    } else {
      toast.error(t("Ödeme işlemiyle ilgili bir sorun oldu.", "Something went wrong with the payment."));
    }
    params.delete("billing");
    const newSearch = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time terms check on mount (NOT in the messages effect below, which
  // re-runs on every mode switch). Accounts that never accepted the current
  // Kullanım Şartları version — older accounts, Google sign-ups, or everyone
  // after a terms update — get the TermsGate modal. A backend that doesn't
  // report terms_current_version yet shows nothing rather than a gate whose
  // "accept" could never stick.
  useEffect(() => {
    let cancelled = false;
    fetchProfile().then((p) => {
      if (cancelled || !p?.terms_current_version) return;
      if (p.terms_accepted_version !== p.terms_current_version) setTermsProfile(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Indirection so onSpeechResult can call the CURRENT stop() without a
  // circular dependency (the hook below needs onSpeechResult as an input,
  // stop only exists once the hook itself has run).
  const sttStopRef = useRef(() => {});
  // Same indirection for handleSend: onSpeechResult is only recreated on
  // mode/lang changes, so calling handleSend directly would use a stale
  // copy (old conversationId, and callActive=false inside the call screen).
  const handleSendRef = useRef(() => {});

  const onSpeechResult = useCallback((text) => {
    sttStopRef.current();
    if (text) handleSendRef.current(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lang]);

  const { listening, interim, supported, start, stop, abort } = useSpeechRecognition({ lang, onResult: onSpeechResult, autoRestart: false });
  sttStopRef.current = stop;

  // Switching mode always drops back to that mode's default thread — a
  // specific Sohbet picked in Arkadaş Modu shouldn't still be "open" after
  // hopping to LunaWorks Modu and back.
  useEffect(() => { setConversationId(null); }, [mode]);

  useEffect(() => {
    let cancelled = false;
    if (conversationId) {
      // A specific Sohbet (past or brand new) is open — show its real
      // transcript, the whole point of Sohbetler being an actual ChatGPT-
      // style history instead of one single ever-growing thread.
      fetchMessages(mode, conversationId).then((msgs) => {
        if (cancelled) return;
        setMessages(msgs.length ? msgs : [buildWelcomeMessage(mode, lang, userName)]);
      }).catch(() => {
        if (!cancelled) setMessages([buildWelcomeMessage(mode, lang, userName)]);
      });
      return () => { cancelled = true; };
    }
    // Arkadaş Modu and LunaWorks Modu each have their own separate default
    // thread — switching `mode` must re-fetch, not just keep showing
    // whichever mode's messages happened to load first.
    // Every time the app is opened (mount, reload, or a mode switch), Luna
    // greets first — a local-only, un-persisted bubble. Older saved history
    // stays on the server (still there for the backend/AI context) but is
    // deliberately NOT re-rendered here, so each visit starts on a clean,
    // uncluttered screen instead of an ever-growing wall of old messages.
    setMessages([buildWelcomeMessage(mode, lang, "")]);
    fetchProfile().then((profile) => {
      if (cancelled) return;
      const name = profile?.name || "";
      if (name) {
        setUserName(name);
        setMessages([buildWelcomeMessage(mode, lang, name)]);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, mode, conversationId]);

  const playAudio = useCallback(async (msg) => {
    try {
      setLoadingId(msg.id);
      const url = await fetchTTS({ text: msg.text, mode });
      setLoadingId(null);
      if (!callActiveRef.current) return;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(msg.id);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      await audio.play();
    } catch (e) {
      // pause() interrupted a pending play() — endCall (already reset the
      // state) or a newer reply taking over; not a real failure.
      if (e?.name === "AbortError") return;
      setLoadingId(null);
      setPlayingId(null);
      if (!callActiveRef.current) return;
      toast.error(t("Ses oluşturulamadı", "Voice failed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lang]);

  const handleSend = useCallback(async (text) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    const optimistic = { id: "u-" + Date.now(), role: "user", text: content, mode };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const reply = await sendChat({ message: content, mode, lang, conversationId });
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, mode };
      setMessages((m) => [...m, lunaMsg]);
      // Chat text replies stay silent by default — Luna only speaks while
      // the dedicated voice-call screen is open.
      if (callActiveRef.current) playAudio(lunaMsg);
    } catch (e) {
      // Covers both a failed /api/chat call and a failed auth step inside
      // sendChat() (authHeaders() -> registerDevice(), which throws the
      // same way on a backend/network failure) — no backend detail, stack
      // trace, or system info reaches the user, just a short in-character
      // message. The optimistic user bubble above is intentionally left in
      // place (not removed) so nothing the user typed disappears, and
      // `finally` below always clears `sending` so the input stays usable
      // for an immediate retry. The one exception is a usage limit (429),
      // whose curated message tells the user when they can continue.
      toast.error(
        quotaMessage(e) || t(
          "🌙 Şu an sana cevap verirken küçük bir sorun yaşadım. Biraz sonra tekrar deneyelim.",
          "🌙 I ran into a small problem answering you just now. Let's try again in a bit."
        ),
        { duration: 6000 }
      );
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sending, mode, lang, conversationId]);
  handleSendRef.current = handleSend;

  const endCall = () => {
    setCallActive(false);
    callActiveRef.current = false;
    if (audioRef.current) audioRef.current.pause();
    setPlayingId(null);
    setLoadingId(null);
    if (listening) abort();
  };

  // Same optimistic-bubble/error-handling shape as handleSend above, for an
  // image (png/jpg/webp/gif) or document (pdf/txt) instead of plain text —
  // see api.js::sendMedia. Images get a real local preview (msg.imageUrl,
  // an object URL — nothing is uploaded anywhere but Luna's own vision
  // call); documents just show their filename, matching what the backend
  // actually stores as this turn's message text.
  const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  const handleSendMedia = useCallback(async (file, caption) => {
    if (!file || sending) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    const optimistic = {
      id: "u-" + Date.now(),
      role: "user",
      text: caption?.trim() || (isImage ? "" : `📄 ${file.name}`),
      imageUrl: isImage ? URL.createObjectURL(file) : undefined,
      mode,
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const reply = await sendMedia(file, caption?.trim(), mode);
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, mode };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      const status = e?.response?.status;
      const msg = quotaMessage(e) || (status === 415
        ? t("Bu dosya türünü okuyamıyorum (png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, zip olmalı).", "I can't read this file type (must be png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, or zip).")
        : status === 413
        ? t("Dosya çok büyük.", "That file is too large.")
        : t("🌙 Dosyayı işlerken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem with that file. Could you try again?"));
      toast.error(msg, { duration: 6000 });
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, mode]);

  // Same shape as handleSendMedia above, for up to 10 files sent together
  // in one turn (FriendPanel only calls this when more than one file is
  // pending — see its handleSendWithAttachment). Each image gets its own
  // optimistic bubble (so multiple images render the way a multi-image
  // message naturally would); non-image files collapse into one filename
  // summary bubble, carrying the caption if there were no images.
  const handleSendMediaBatch = useCallback(async (files, caption) => {
    if (!files?.length || sending) return;
    const imageFiles = files.filter((f) => IMAGE_EXT.has((f.name.split(".").pop() || "").toLowerCase()));
    const docFiles = files.filter((f) => !imageFiles.includes(f));
    const trimmedCaption = caption?.trim() || "";
    const optimisticMsgs = imageFiles.map((f, i) => ({
      id: `u-${Date.now()}-${i}`,
      role: "user",
      text: i === 0 && !docFiles.length ? trimmedCaption : "",
      imageUrl: URL.createObjectURL(f),
      mode,
    }));
    if (docFiles.length) {
      optimisticMsgs.push({
        id: `u-${Date.now()}-docs`,
        role: "user",
        text: (trimmedCaption ? trimmedCaption + " — " : "") + docFiles.map((f) => `📄 ${f.name}`).join(", "),
        mode,
      });
    } else if (!imageFiles.length && trimmedCaption) {
      optimisticMsgs.push({ id: `u-${Date.now()}-caption`, role: "user", text: trimmedCaption, mode });
    }
    setMessages((m) => [...m, ...optimisticMsgs]);
    setSending(true);
    try {
      const reply = await sendMediaBatch(files, trimmedCaption, mode);
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, mode };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "";
      const msg = quotaMessage(e) || (status === 415
        ? t("Bu dosya türünü okuyamıyorum (png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, zip olmalı).", "I can't read this file type (must be png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, or zip).")
        : status === 413 && detail.includes("fazla")
        ? t("En fazla 10 dosya birden gönderebilirsin.", "You can send at most 10 files at once.")
        : status === 413
        ? t("Dosyalardan biri çok büyük.", "One of the files is too large.")
        : t("🌙 Dosyaları işlerken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem with those files. Could you try again?"));
      toast.error(msg, { duration: 6000 });
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, mode]);

  // Luna DRAWS a new image from a prompt (LunaWorks Modu) — distinct from
  // handleSendMedia above, which sends an existing file for Luna to look
  // at. Same optimistic-bubble/error-handling shape, but the user bubble is
  // the prompt text and the reply bubble carries the generated image itself
  // (see api.js::generateImage -> routers/media.py::generate_image).
  const handleGenerateImage = useCallback(async (prompt) => {
    if (!prompt || generatingImage) return;
    const optimistic = { id: "u-" + Date.now(), role: "user", text: `🎨 ${prompt}`, mode };
    setMessages((m) => [...m, optimistic]);
    setGeneratingImage(true);
    const startedAt = Date.now();
    try {
      const { reply, imageUrl } = await generateImage(prompt, mode);
      // The backend actually finishes in a second or two, but showing the
      // result that fast reads as cheap/rushed for something framed as
      // "Luna drawing" — pad the visible "generating" state out to a
      // minimum of MIN_IMAGE_GEN_MS so it feels like real, careful work.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_IMAGE_GEN_MS) await new Promise((r) => setTimeout(r, MIN_IMAGE_GEN_MS - elapsed));
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, imageUrl, mode };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      const msg = quotaMessage(e)
        || t("🌙 Görseli çizerken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem drawing that. Could you try again?");
      toast.error(msg, { duration: 6000 });
    } finally {
      setGeneratingImage(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingImage, mode]);

  // Same inline-composer shape as handleGenerateImage above, but for the
  // PDF/Word/PowerPoint/Excel/Tablo/Grafik wand-menu items — the reply
  // bubble carries a fileUrl/fileName instead of an imageUrl (ChatMessage
  // already renders that as a downloadable file card).
  const handleGenerateDoc = useCallback(async (kind, prompt) => {
    const cfg = DOC_GEN_CONFIG[kind];
    if (!cfg || !prompt || generatingDoc) return;
    const optimistic = { id: "u-" + Date.now(), role: "user", text: prompt, mode };
    setMessages((m) => [...m, optimistic]);
    setGeneratingDoc(true);
    try {
      const { reply, title, fileUrl } = await cfg.generate(prompt, "", mode);
      // \w is ASCII-only in JS regex — a plain [^\w\s-] strip would eat
      // every Turkish letter (ç/ğ/ı/ö/ş/ü) out of the filename. \p{L}\p{N}
      // (with the /u flag) keeps any language's letters/digits and only
      // strips real filesystem-unsafe characters.
      const fileName = `${(title || "luna-dosya").replace(/[^\p{L}\p{N}\s-]/gu, "").trim() || "luna-dosya"}.${cfg.ext}`;
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, fileUrl, fileName, mode };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      toast.error(quotaMessage(e) || t("🌙 Oluştururken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem generating that. Could you try again?"), { duration: 6000 });
    } finally {
      setGeneratingDoc(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingDoc, mode]);

  const toggleMic = () => {
    if (!supported) {
      toast.error(t("Tarayıcı sesli girişi desteklemiyor", "Voice input not supported here"));
      return;
    }
    listening ? stop() : start();
  };

  const handleClear = async () => {
    await clearMessages(mode);
    setMessages([]);
    setSettingsOpen(false);
    toast.success(t("Sohbet temizlendi", "Chat cleared"));
  };

  const handleClearAllMemories = async () => {
    await clearMemories();
    setSettingsOpen(false);
    toast.success(t("Tüm anılar silindi", "All memories cleared"));
  };

  const handlePaired = () => {
    setPairOpen(false);
    setPaired(true);
    toast.success(t("Telefonunla eşleştirildi 🌙", "Paired with your phone 🌙"));
  };

  if (booting) return <BootSequence lang={lang} onDone={() => { sessionStorage.setItem("luna_booted", "1"); setBooting(false); }} />;

  return (
    <div className="relative h-screen overflow-hidden flex bg-[#05040c]" data-testid="luna-app">
      <div className="pointer-events-none fixed inset-0 z-0 bg-cover bg-bottom"
        style={{ backgroundImage: `url(${lunaBg})` }} />
      <div className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "linear-gradient(180deg, rgba(5,4,12,0.55) 0%, rgba(5,4,12,0.75) 55%, rgba(5,4,12,0.92) 100%)" }} />
      <div className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "radial-gradient(50% 35% at 20% 0%, rgba(217,70,239,0.14), transparent 70%)" }} />

      <Sidebar
        mode={mode}
        lang={lang}
        active={mode}
        onNavigate={(key) => setMode(key === "work" ? "work" : "friend")}
        onOpenMemories={() => setMemoriesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPanel={setOpenPanel}
        onOpenPremium={() => setPremiumOpen(true)}
        onOpenConversations={() => setConversationsOpen(true)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="relative z-10 flex-1 min-w-0 h-screen overflow-hidden flex flex-col px-4 sm:px-8 py-4 gap-3">
        <FriendPanel
          lang={lang}
          messages={messages}
          sending={sending}
          listening={listening}
          interim={interim}
          input={input}
          setInput={setInput}
          onSend={handleSend}
          onSendMedia={handleSendMedia}
          onSendMediaBatch={handleSendMediaBatch}
          onGenerateImage={handleGenerateImage}
          generatingImage={generatingImage}
          onGenerateDoc={handleGenerateDoc}
          generatingDoc={generatingDoc}
          onToggleMic={toggleMic}
          onOpenCall={() => setCallActive(true)}
          workMode={mode === "work"}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />
      </div>

      {settingsOpen && (
        <SettingsPanel
          lang={lang}
          setLang={setLang}
          paired={paired}
          onOpenPair={() => { setSettingsOpen(false); setPairOpen(true); }}
          onClearChat={handleClear}
          onClearMemories={handleClearAllMemories}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {memoriesOpen && (
        <MemoryPanel lang={lang} onClose={() => setMemoriesOpen(false)} />
      )}

      {conversationsOpen && (
        <ConversationsPanel
          lang={lang}
          mode={mode}
          activeConversationId={conversationId}
          onSelect={setConversationId}
          onClose={() => setConversationsOpen(false)}
        />
      )}

      {pairOpen && (
        <PairDeviceModal lang={lang} onPaired={handlePaired} onClose={() => setPairOpen(false)} />
      )}

      {openPanel === "notes" && <NotesPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "goals" && <GoalsPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "alarms" && <RemindersPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "journal" && <JournalPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "hobbies" && <HobbiesPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "mood" && <MoodPanel lang={lang} mood={mood} setMood={setMood} onClose={() => setOpenPanel(null)} />}
      {openPanel === "day-info" && <DayInfoPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "usage" && <UsagePanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-images" && <ImageGalleryPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-pdf" && <DocGeneratorPanel kind="pdf" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-excel" && <DocGeneratorPanel kind="excel" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-word" && <DocGeneratorPanel kind="word" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-ppt" && <DocGeneratorPanel kind="ppt" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-table" && <DocGeneratorPanel kind="table" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-chart" && <DocGeneratorPanel kind="chart" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {premiumOpen && <PremiumPanel lang={lang} onClose={() => setPremiumOpen(false)} />}

      {callActive && (
        <VoiceCallModal
          lang={lang}
          sending={sending}
          listening={listening}
          interim={interim}
          playingId={playingId}
          lastLunaId={[...messages].reverse().find((m) => m.role === "luna")?.id}
          onToggleMic={toggleMic}
          onClose={endCall}
        />
      )}

      {termsProfile && (
        <TermsGate
          lang={lang}
          currentVersion={termsProfile.terms_current_version}
          initialConsent={!!termsProfile.special_data_consent}
          onAccepted={() => setTermsProfile(null)}
        />
      )}
    </div>
  );
}
