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
import { randomId, sendStreamedTurn, streamingReply } from "@/lib/streamedTurn";
import { serverDetail } from "@/lib/errorText";
import {
  initialUiLang, initialReplyLang, seedReplyLang, makeT, uiLang, accountLanguage, justCreatedHere,
} from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { pendingKind } from "@/lib/chatIntent";
import { replyExtras } from "@/lib/turnExtras";
import {
  sendMedia, sendMediaBatch, generateImage, clearMessages, fetchMessages, clearMemories, isPaired, fetchProfile,
  updateProfile, getReplyLang, setReplyLang, turnResult,
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

// Luna greets in the language she answers in (Settings' reply language, or
// the interface's): a German visitor reads English screens and a German hello.
const WELCOME_LINES = {
  friend: {
    tr: (name) => `Merhaba${name ? ` ${name}` : ""}! 🌙 Bugün nasılsın, neler konuşalım?`,
    en: (name) => `Hi${name ? ` ${name}` : ""}! 🌙 How are you today — what shall we talk about?`,
    es: (name) => `¡Hola${name ? ` ${name}` : ""}! 🌙 ¿Cómo estás hoy? ¿De qué hablamos?`,
    de: (name) => `Hallo${name ? ` ${name}` : ""}! 🌙 Wie geht's dir heute — worüber wollen wir reden?`,
    ru: (name) => `Привет${name ? `, ${name}` : ""}! 🌙 Как ты сегодня? О чём поговорим?`,
    it: (name) => `Ciao${name ? ` ${name}` : ""}! 🌙 Come stai oggi? Di cosa parliamo?`,
  },
  work: {
    tr: (name) => `Hoş geldin${name ? `, ${name}` : ""}! 🌙 LunaWorks hazır — görsel, PDF, Excel, Word, ne istersen üretmeye başlayalım.`,
    en: (name) => `Welcome${name ? `, ${name}` : ""}! 🌙 LunaWorks is ready — let's create an image, PDF, Excel, Word, whatever you need.`,
    es: (name) => `¡Hola${name ? ` ${name}` : ""}! 🌙 LunaWorks está listo: una imagen, un PDF, un Excel, un Word, lo que necesites.`,
    de: (name) => `Willkommen${name ? `, ${name}` : ""}! 🌙 LunaWorks ist bereit — Bild, PDF, Excel, Word, was immer du brauchst.`,
    ru: (name) => `Добро пожаловать${name ? `, ${name}` : ""}! 🌙 LunaWorks готов — изображение, PDF, Excel, Word, всё, что нужно.`,
    it: (name) => `Ciao${name ? ` ${name}` : ""}! 🌙 LunaWorks è pronto: un'immagine, un PDF, un Excel, un Word, tutto ciò che ti serve.`,
  },
};

// A turn spoken in the voice call: the call (hooks/useVoiceCall.js, reached
// through callRef) starts saying her first sentence while the rest is still
// being written. gen: the call the turn belongs to; signal: the call lets
// the turn go (hung up, or you cut her off mid-stream).
function sendSpokenTurn(args, callRef, gen, turnId, signal) {
  let started = false;
  return sendStreamedTurn(args, {
    voice: true,
    idempotencyKey: `voice-${turnId || randomId()}`,
    signal,
    onDelta: (text) => {
      if (!started) {
        started = true;
        callRef.current?.onReplyStart(gen, turnId);
      }
      callRef.current?.onReplyDelta(text, gen);
    },
  });
}

function buildWelcomeMessage(mode, lang, name) {
  const key = mode === "work" ? "work" : "friend";
  const lines = WELCOME_LINES[key];
  // (the browser's language counts before it is kept as the reply language)
  const text = (lines[getReplyLang() || initialReplyLang(lang) || lang] || lines[uiLang(lang)])(name);
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
  // The interface language, always "tr" or "en" (lib/i18n.js): the saved
  // one, else the browser's — a first visit from abroad is in English, not
  // Turkish. Every panel gets this, so none can fall back to Turkish for a
  // "de". The reply language (Settings; lib/api.js getReplyLang) is apart:
  // replySeed is the browser's own language when Luna speaks it (read now,
  // before luna_lang is rewritten), kept below unless one is chosen already.
  const [lang, setLang] = useState(() => initialUiLang());
  const [replySeed] = useState(() => initialReplyLang(initialUiLang()));
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
  const t = makeT(lang);
  // Which abilities the server has on (GET /api/features, lib/features.js).
  const features = useFeatures();
  // What the turn being answered most likely makes ("doc" | "image" | null,
  // lib/chatIntent.js): the waiting bubble then says so instead of showing
  // three dots for the minute a researched deck can take.
  const [making, setMaking] = useState(null);
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
  useEffect(() => {
    localStorage.setItem("luna_lang", lang);
    // (screen readers and the browser's own translate offer read the page's language)
    document.documentElement.lang = lang;
  }, [lang]);
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
      // The account's own language when it has one (lib/i18n.js
      // accountLanguage): a reply language other than TR/EN (only the
      // Settings picker sets one), or ANY language of an existing account
      // signing in on a new browser — a Turkish account on a German or
      // English browser stays Turkish (screens, replies, the mic) instead
      // of being moved to the browser's language and having that saved
      // over its own with the next message. Otherwise the browser's own
      // language, when Luna speaks it and it isn't TR/EN (seedReplyLang:
      // never over a choice), and a just-created account saves the
      // language it starts with right away.
      const own = accountLanguage(p);
      if (own) {
        setReplyLang(own.reply);
        if (own.ui) setLang(own.ui);
        // (the greeting already on screen was in the browser's language)
        setMessages((m) => (m.length === 1 && String(m[0]?.id || "").startsWith("welcome-")
          ? [buildWelcomeMessage(m[0].mode, own.ui || initialUiLang(), p?.name || "")] : m));
      } else {
        const seeded = seedReplyLang(replySeed);
        const startLang = seeded || getReplyLang() || initialUiLang();
        if (justCreatedHere(p) && startLang && startLang !== p?.profile?.language) {
          updateProfile({ language: startLang }).catch(() => {});
        }
      }
      if (!p?.terms_current_version) return;
      if (p.terms_accepted_version !== p.terms_current_version) setTermsProfile(p);
    }).catch(() => {
      if (!cancelled) seedReplyLang(replySeed);
    });
    return () => { cancelled = true; };
  }, [replySeed]); // (replySeed never changes: this runs once, on mount)

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

  // It listens in the language you talk to Luna in — her reply language
  // (Settings, or the browser's own until that is kept), else the
  // interface's: German replies, German ears.
  const speech = useSpeechRecognition({ lang: getReplyLang() || replySeed || lang, onResult: onSpeechResult, onEnd: onSpeechEnd, autoRestart: false });
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
    // An HD (speech-to-speech) call stores its turns in this thread on the
    // server; each finished one also shows in the chat behind the call
    // screen, as a classic call's turns do.
    conversationId,
    // (`actions`: what her tools did in the call — a reminder, a note — shown
    // as the reply's cards, even when she said nothing more about it.)
    onTranscriptTurn: ({ role, text, actions } = {}) => {
      const said = typeof text === "string" ? text.trim() : "";
      const cards = role === "assistant" && Array.isArray(actions) && actions.length ? actions : null;
      if ((!said && !cards) || (role !== "user" && role !== "assistant")) return;
      const id = `${role === "user" ? "u" : "l"}-rt-${randomId()}`;
      setMessages((m) => [...m, {
        id, role: role === "user" ? "user" : "luna", text: said, mode, ...(cards ? { actions: cards } : {}),
      }]);
    },
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
    // (a typed "X hakkında sunum hazırla" / "bir kedi çiz": the waiting
    // bubble says a file / picture is being made — never in the call)
    setMaking(voice ? null : pendingKind(content, features));
    // Which call (if any) this turn belongs to — a reply is only spoken in
    // the same call it was asked in.
    const callGen = callRef.current?.generation();
    // A typed turn's reply bubble, filled in as the reply streams.
    const typed = voice ? null : streamingReply(setMessages, mode);
    // The server flags a message about self-harm or abuse (backend
    // services/safety.py): its reply then carries the help card.
    let safety = null;
    const onSafety = (s) => { safety = s; };
    try {
      // A mood picked on an earlier day no longer applies.
      const todaysMood = mood && localStorage.getItem("luna_mood_day") === dayKey() ? mood : null;
      // full: the whole turn comes back — a picture or file made in chat
      // (attachments) and the pages a searched reply used (sources) too.
      const args = { message: content, mode, lang, conversationId, mood: todaysMood, onSafety, full: true };
      // Both stream: a spoken turn so she starts talking at her first
      // sentence, a typed one so her reply shows up as it is written (and,
      // if the connection breaks off mid-reply, is fetched whole: recover).
      const result = turnResult(voice
        ? await sendSpokenTurn(args, callRef, callGen, turnId, signal)
        : await sendStreamedTurn(args, { voice: false, idempotencyKey: `text-${randomId()}`, onDelta: typed.onDelta,
          recover: true }));
      const lunaMsg = {
        id: typed?.id || "l-" + Date.now(), role: "luna", text: result.reply, mode,
        ...(safety ? { safety } : {}), ...replyExtras(result),
      };
      if (typed) typed.finish(lunaMsg);
      else setMessages((m) => [...m, lunaMsg]);
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
      // A flagged turn the server failed mid-reply (e.reply, see lib/api.js
      // streamChat) was closed with the caring crisis reply: that and the
      // help card take the partial text's place — never a "try again"
      // toast (launch audit 2026-10-03). In the call it goes into the chat
      // behind the call screen, and the card onto the call screen.
      if (e?.reply) {
        const kept = { id: typed?.id || "l-" + Date.now(), role: "luna", text: e.reply, mode, ...(safety ? { safety } : {}) };
        if (typed) {
          typed.finish(kept);
          return;
        }
        setMessages((m) => [...m, kept]);
        if (!callRef.current?.isLive()) return; // (the call is over: the reply and its card are in the chat)
        if (safety && callRef.current.generation() === callGen) setCallSafety(safety);
      }
      // A typed reply that failed after part of it showed (and couldn't be
      // fetched whole — see lib/streamedTurn.js) takes its partial text away.
      typed?.drop();
      // A turn spoken in the call is answered inside the call screen — and
      // one the call let go itself (hung up mid-answer) needs no message.
      if (voice && callRef.current?.isLive() && callRef.current.onTurnFailed(e, callGen)) return;
      if (voice && signal?.aborted) return;
      // A typed message the server refused as too long (413) was never
      // taken: it goes back into the composer (to shorten, or to send as a
      // file) instead of staying in the chat as if it had been sent.
      if (!voice && e?.response?.status === 413) {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setInput((cur) => cur || content);
      }
      // The server's own reason when it gives one (too long, not allowed,
      // a plan limit — lib/errorText.js), else the in-character message.
      // A plan's limit (the free plan's 30 messages a day, a paid plan's
      // quota — a 429 without Retry-After) offers the plans right there
      // while paid plans are on sale.
      const planLimit = e?.response?.status === 429 && !e.response.headers?.["retry-after"];
      toast.error(
        quotaMessage(e) || serverDetail(e) || t(
          "🌙 Şu an sana cevap verirken küçük bir sorun yaşadım. Biraz sonra tekrar deneyelim.",
          "🌙 I ran into a small problem answering you just now. Let's try again in a bit."
        ),
        planLimit && features.sales
          ? { duration: 10000, action: { label: t("Planları gör", "See plans"), onClick: () => setPremiumOpen(true) } }
          : { duration: 6000 }
      );
    } finally {
      setSending(false);
      setMaking(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sending, mode, lang, conversationId, mood, features]);
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
      // (a photo + "bunu anime yap" comes back with the new picture in
      // attachments — shown right in the reply)
      const result = turnResult(await sendMedia(file, caption?.trim(), mode, { full: true }));
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: result.reply, mode, ...replyExtras(result) };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      const status = e?.response?.status;
      // The server's own text first: a 413 is the file ("Dosya çok büyük
      // (max 15MB)"); a too-long caption is a 422 (code
      // "caption_too_long") that says how to shorten it.
      const msg = quotaMessage(e) || serverDetail(e) || (status === 415
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
      const result = turnResult(await sendMediaBatch(files, trimmedCaption, mode, { full: true }));
      const lunaMsg = { id: "l-" + Date.now(), role: "luna", text: result.reply, mode, ...replyExtras(result) };
      setMessages((m) => [...m, lunaMsg]);
    } catch (e) {
      const status = e?.response?.status;
      // The server's own text first: a 413 may be too many files ("En fazla
      // 10 dosya ekleyebilirsin") or one too big; a too-long caption is a
      // 422 that says how to shorten it.
      const msg = quotaMessage(e) || serverDetail(e) || (status === 415
        ? t("Bu dosya türünü okuyamıyorum (png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, zip olmalı).", "I can't read this file type (must be png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, or zip).")
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
      // A picture refused under the content rules (422 "image_refused" with
      // the reason and the strikes left; 502 from an older server) or
      // picture making paused after repeated refusals (403) must say so —
      // "tekrar dener misin?" there only leads into (or prolongs) the pause.
      const msg = quotaMessage(e) || serverDetail(e, [403, 413, 422, 429, 502])
        || t("🌙 Görseli çizerken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem drawing that. Could you try again?");
      toast.error(msg, { duration: 8000 });
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
      toast.error(quotaMessage(e) || serverDetail(e) || t("🌙 Oluştururken küçük bir sorun yaşadım. Tekrar dener misin?", "🌙 I ran into a small problem generating that. Could you try again?"), { duration: 6000 });
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
          // (also while a typed turn makes a picture / a file in chat — the
          // waiting bubble's "Görsel çiziliyor..." / "Oluşturuluyor...")
          generatingImage={generatingImage || (sending && making === "image")}
          onGenerateDoc={handleGenerateDoc}
          generatingDoc={generatingDoc || (sending && making === "doc")}
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
