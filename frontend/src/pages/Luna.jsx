import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import lunaBg from "@/assets/luna-bg.jpg";
import BootSequence from "@/components/BootSequence";
import PairDeviceModal from "@/components/PairDeviceModal";
import Sidebar from "@/components/Sidebar";
import FriendPanel from "@/components/FriendPanel";
import ImageGalleryPanel from "@/components/ImageGalleryPanel";
import ConversationsPanel from "@/components/ConversationsPanel";
import DocGeneratorPanel from "@/components/DocGeneratorPanel";
import PremiumPanel from "@/components/PremiumPanel";
import VoiceCallModal from "@/components/VoiceCallModal";
import TermsGate from "@/components/TermsGate";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { useReminderAlerts } from "@/hooks/useReminderAlerts";
import { dayKey } from "@/lib/dates";
import PanelSlot, { lazyPanel } from "@/components/panel/PanelSlot";
import {
  sendChat, streamVoiceChat, sendMedia, sendMediaBatch, generateImage, clearMessages, fetchMessages, clearMemories, isPaired, fetchProfile,
  getReplyLang, setReplyLang,
  generatePdf, generateExcel, generateWord, generatePpt, generateTableImage, generateChart,
} from "@/lib/api";

// Sidebar panels load on demand — see components/panel/PanelSlot.jsx.
const MemoryPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/MemoryPanel"));
const MoodPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/MoodPanel"));
const DayInfoPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/DayInfoPanel"));
const UsagePanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/UsagePanel"));
const SettingsPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/SettingsPanel"));
const NotesPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/NotesPanel"));
const GoalsPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/GoalsPanel"));
const RemindersPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/RemindersPanel"));
const JournalPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/JournalPanel"));
const HobbiesPanel = lazyPanel(() => import(/* webpackPrefetch: true */ "@/components/HobbiesPanel"));

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
    tr: (name) => `Merhaba${name ? ` ${name}` : ""}! 🌙 Bugün nasılsın, neler konuşalım?`,
    en: (name) => `Hi${name ? ` ${name}` : ""}! 🌙 How are you today — what shall we talk about?`,
  },
  work: {
    tr: (name) => `Hoş geldin${name ? `, ${name}` : ""}! 🌙 LunaWorks hazır — görsel, PDF, Excel, Word, ne istersen üretmeye başlayalım.`,
    en: (name) => `Welcome${name ? `, ${name}` : ""}! 🌙 LunaWorks is ready — let's create an image, PDF, Excel, Word, whatever you need.`,
  },
};

// A turn spoken in the voice call. Her reply streams in, and the call
// (hooks/useVoiceCall.js, reached through callRef) starts saying its first
// sentence while the rest is still being written. If the stream never got
// going — before any of the reply arrived: a network error, a server or
// proxy that can't stream — the turn is asked once the normal way, under the
// same idempotency key, so the server never answers it twice (a 409 means
// the streamed request is still being answered: its reply is replayed once
// it is done). After part of the reply arrived, a broken stream is a failed
// turn (the caller's catch). gen: the call the turn belongs to; signal: the
// call lets the turn go (hung up, or you cut her off mid-stream) — whatever
// is on its way then stops.
const FALLBACK_409_RETRIES = 6;
const FALLBACK_409_WAIT_MS = 1500;

async function sendSpokenTurn(args, callRef, gen, turnId, signal) {
  const idempotencyKey = `voice-${turnId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
  let started = false;
  try {
    return await streamVoiceChat({
      ...args,
      idempotencyKey,
      signal,
      onDelta: (text) => {
        if (!started) {
          started = true;
          callRef.current?.onReplyStart(gen, turnId);
        }
        callRef.current?.onReplyDelta(text, gen);
      },
    });
  } catch (e) {
    if (started || !e?.canFallBack || signal?.aborted) throw e;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendChat({ ...args, voice: true, idempotencyKey, signal });
    } catch (e) {
      if (signal?.aborted || e?.response?.status !== 409 || attempt >= FALLBACK_409_RETRIES) throw e;
      await new Promise((resolve) => setTimeout(resolve, FALLBACK_409_WAIT_MS));
      if (signal?.aborted) throw e;
    }
  }
}

function buildWelcomeMessage(mode, lang, name) {
  const key = mode === "work" ? "work" : "friend";
  const text = WELCOME_LINES[key][lang === "tr" ? "tr" : "en"](name);
  return { id: "welcome-" + Date.now(), role: "luna", text, mode };
}

export default function Luna() {
  const [booting, setBooting] = useState(() => {
    try {
      return !localStorage.getItem("luna_booted");
    } catch {
      return false;
    }
  });
  const [mode, setMode] = useState(() => {
    // "jarvis" is a stale value from before L.U.N.A. Modu was removed —
    // never let an old localStorage entry land a user on a mode that no
    // longer renders anything.
    const saved = localStorage.getItem("luna_mode");
    return saved === "jarvis" ? "friend" : saved || "friend";
  });
  const [lang, setLang] = useState(() => localStorage.getItem("luna_lang") || "tr");
  // Ruh Halim: only a mood picked TODAY counts (it's sent with each message
  // so Luna can take it into account); yesterday's pick expires on its own.
  const [mood, setMood] = useState(() => {
    try {
      return localStorage.getItem("luna_mood_day") === dayKey() ? localStorage.getItem("luna_mood") : null;
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(false);
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
  const t =(tr, en) => (lang === "tr" ? tr : en);
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
  useEffect(() => {
    try {
      if (mood) {
        localStorage.setItem("luna_mood", mood);
        localStorage.setItem("luna_mood_day", dayKey());
      } else {
        localStorage.removeItem("luna_mood");
        localStorage.removeItem("luna_mood_day");
      }
    } catch {}
  }, [mood]);

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
      if (cancelled) return;
      // A reply language other than TR/EN can only come from the Settings
      // picker (on this or another device) — keep it, instead of letting
      // this device's interface language overwrite it on the next message.
      const serverLang = p?.profile?.language;
      if (!getReplyLang() && serverLang && serverLang !== "tr" && serverLang !== "en") setReplyLang(serverLang);
      if (!p?.terms_current_version) return;
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
  // copy (old conversationId, and a stale voice flag inside the call screen).
  const handleSendRef = useRef(() => {});

  // The voice call (hooks/useVoiceCall.js), reached through a ref so the
  // speech callbacks below don't need to be recreated with it.
  const callRef = useRef(null);

  // meta: { turnId } when the phrase came from server-side recognition (the
  // call's fallback engine) — the reply's voice then counts as the same turn.
  const onSpeechResult = useCallback((text, meta) => {
    // In a call, phrases are gathered into one turn (sent after a short
    // silence); in the chat composer a phrase is sent right away, as before.
    if (callRef.current?.handleFinal(text, meta)) return;
    sttStopRef.current();
    if (text) handleSendRef.current(text);
  }, []);
  const onSpeechEnd = useCallback((info) => callRef.current?.handleSpeechEnd(info), []);

  const speech = useSpeechRecognition({ lang, onResult: onSpeechResult, onEnd: onSpeechEnd, autoRestart: false });
  const { listening, interim, supported, start, stop } = speech;
  sttStopRef.current = stop;

  const call = useVoiceCall({
    lang,
    mode,
    t,
    quotaMessage,
    speech,
    sending,
    sendTurn: (text, opts) => handleSendRef.current(text, { voice: true, turnId: opts?.turnId, signal: opts?.signal }),
  });
  callRef.current = call;

  // The help card for a flagged message said in the call (see handleSend),
  // shown on the call screen until the call ends.
  const [callSafety, setCallSafety] = useState(null);
  useEffect(() => {
    if (!call.active) setCallSafety(null);
  }, [call.active]);

  useReminderAlerts({ lang });

  // The chat composer's mic has no screen of its own (the call shows its
  // errors itself): say what went wrong instead of silently doing nothing.
  const micErrorCtx = useRef({});
  micErrorCtx.current = { t, inCall: call.active };
  useEffect(() => {
    const { t: tr, inCall } = micErrorCtx.current;
    if (!speech.error || inCall) return;
    const message = {
      "not-allowed": tr("Mikrofon izni gerekli. Tarayıcının site ayarlarından Luna'ya izin ver.", "Microphone access is needed. Allow it for Luna in your browser's site settings."),
      "audio-capture": tr("Mikrofon bulunamadı.", "No microphone found."),
      quota: tr("Sesli kullanım sınırına ulaştın; yazarak devam edebilirsin.", "You've reached your voice limit; you can keep going by text."),
    }[speech.error] || tr("Sesini alamadım, tekrar dener misin?", "I couldn't hear you. Could you try again?");
    toast.error(message);
  }, [speech.error]);

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

  // voice: a turn spoken in the call (turnId, signal: see useVoiceCall).
  const handleSend = useCallback(async (text, { voice = false, turnId = null, signal = null } = {}) => {
    const content = (typeof text === "string" ? text : input).trim();
    if (!content || sending) return;
    if (!voice) setInput("");
    const optimistic = { id: "u-" + Date.now(), role: "user", text: content, mode };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    // Which call (if any) this turn belongs to — a reply is only spoken in
    // the same call it was asked in.
    const callGen = callRef.current?.generation();
    try {
      // A mood picked on an earlier day no longer applies.
      const todaysMood = mood && localStorage.getItem("luna_mood_day") === dayKey() ? mood : null;
      // The server flags a message about self-harm or abuse (backend
      // services/safety.py): its reply then carries the help card.
      let safety = null;
      const onSafety = (s) => { safety = s; };
      const args = { message: content, mode, lang, conversationId, mood: todaysMood, onSafety };
      // A spoken turn streams (she starts talking at her first sentence).
      const reply = voice ? await sendSpokenTurn(args, callRef, callGen, turnId, signal) : await sendChat(args);
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: reply, mode, ...(safety ? { safety } : {}) };
      setMessages((m) => [...m, lunaMsg]);
      if (voice && safety) setCallSafety(safety);
      // Chat text replies stay silent by default — Luna only speaks while
      // the dedicated voice-call screen is open (there the whole reply
      // finishes what streamed in, or is said from its start).
      if (voice && callRef.current?.isLive()) callRef.current.onReply(lunaMsg, callGen, turnId);
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
      // A turn spoken in the call is answered inside the call screen — and
      // one the call let go itself (hung up mid-answer) needs no message.
      if (voice && callRef.current?.isLive() && callRef.current.onTurnFailed(e, callGen)) return;
      if (voice && signal?.aborted) return;
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
  }, [input, sending, mode, lang, conversationId, mood]);
  handleSendRef.current = handleSend;

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

  // The chat composer's mic (the call has its own controls).
  const toggleMic = () => {
    if (!supported) {
      toast.error(t("Tarayıcı sesli girişi desteklemiyor", "Voice input not supported here"));
      return;
    }
    listening ? stop() : start();
  };

  const handleClear = async () => {
    await clearMessages(mode, conversationId);
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

  if (booting) {
    return <BootSequence lang={lang} onDone={() => {
      try { localStorage.setItem("luna_booted", "1"); } catch { /* shows again next time */ }
      setBooting(false);
    }} />;
  }

  return (
    <div className="relative h-screen overflow-hidden flex bg-[#05040c]" data-testid="luna-app">
      <div className="pointer-events-none fixed inset-0 z-0 bg-cover bg-bottom"
        style={{ backgroundImage: `url(${lunaBg})` }} />
      <div className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "linear-gradient(180deg, rgba(5,4,12,0.55) 0%, rgba(5,4,12,0.75) 55%, rgba(5,4,12,0.92) 100%)" }} />
      <div className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "radial-gradient(50% 35% at 20% 0%, rgba(217,70,239,0.14), transparent 70%)" }} />

      {/* inert while the full-screen call is open: keyboard focus and screen
          readers stay inside the call instead of reaching hidden controls. */}
      <div className="contents" inert={call.active}>
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
      </div>

      <div className="relative z-10 flex-1 min-w-0 h-screen overflow-hidden flex flex-col px-4 sm:px-8 py-4 gap-3" inert={call.active}>
        <FriendPanel
          lang={lang}
          messages={messages}
          sending={sending}
          // (the fallback recognizer is still turning your words into text)
          listening={listening || speech.transcribing}
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
          onOpenCall={call.open}
          workMode={mode === "work"}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />
      </div>

      {settingsOpen && (
        <PanelSlot lang={lang} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel
          lang={lang}
          setLang={setLang}
          paired={paired}
          onOpenPair={() => { setSettingsOpen(false); setPairOpen(true); }}
          onClearChat={handleClear}
          onClearMemories={handleClearAllMemories}
          onClose={() => setSettingsOpen(false)}
        />
        </PanelSlot>
      )}

      {memoriesOpen && (
        <PanelSlot lang={lang} onClose={() => setMemoriesOpen(false)}>
          <MemoryPanel lang={lang} onClose={() => setMemoriesOpen(false)} />
        </PanelSlot>
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

      {openPanel === "notes" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><NotesPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "goals" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><GoalsPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "alarms" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><RemindersPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "journal" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><JournalPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "hobbies" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><HobbiesPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "mood" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><MoodPanel lang={lang} mood={mood} setMood={setMood} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "day-info" && <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}><DayInfoPanel lang={lang} onClose={() => setOpenPanel(null)} /></PanelSlot>}
      {openPanel === "usage" && (
        <PanelSlot lang={lang} onClose={() => setOpenPanel(null)}>
          <UsagePanel lang={lang} onClose={() => setOpenPanel(null)}
            onOpenPremium={() => { setOpenPanel(null); setPremiumOpen(true); }} />
        </PanelSlot>
      )}
      {openPanel === "work-images" && <ImageGalleryPanel lang={lang} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-pdf" && <DocGeneratorPanel kind="pdf" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-excel" && <DocGeneratorPanel kind="excel" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-word" && <DocGeneratorPanel kind="word" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-ppt" && <DocGeneratorPanel kind="ppt" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-table" && <DocGeneratorPanel kind="table" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {openPanel === "work-chart" && <DocGeneratorPanel kind="chart" lang={lang} mode={mode} onClose={() => setOpenPanel(null)} />}
      {premiumOpen && <PremiumPanel lang={lang} onClose={() => setPremiumOpen(false)} />}

      {call.active && <VoiceCallModal lang={lang} {...call.modalProps} safety={callSafety} />}

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
