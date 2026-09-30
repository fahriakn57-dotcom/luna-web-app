import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, PhoneOff, Mic, ArrowUp, Square } from "lucide-react";
import MoonCanvas from "@/components/voice/MoonCanvas";
import lunaLogo from "@/assets/luna-logo.png";

// The voice call. Luna is drawn as a moon whose phase shows the state of the
// call (see voice/moonScene.js); below it, what is being said right now —
// your words while you talk, Luna's while she answers.

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Reply text as it will be heard: no markdown, links reduced to their label.
function toSpoken(text) {
  return (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#`>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Caption-sized pieces: sentences, with long ones split at word boundaries.
function toChunks(text) {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) || [text];
  const chunks = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= 140) {
      chunks.push(s);
      continue;
    }
    let cur = "";
    for (const w of s.split(" ")) {
      if (cur && (cur + " " + w).length > 110) {
        chunks.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) chunks.push(cur);
  }
  return chunks.length ? chunks : [text];
}

// Luna's reply, one caption at a time, words lighting up roughly in step
// with the audio (progress = currentTime / duration of the reply).
function SpokenCaption({ text, audioRef }) {
  const chunks = useMemo(() => toChunks(toSpoken(text)), [text]);
  const total = useMemo(() => chunks.reduce((n, c) => n + c.length + 1, 0), [chunks]);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    setPos(0);
    const id = setInterval(() => {
      const a = audioRef.current;
      if (!a || !a.duration || !isFinite(a.duration)) return;
      setPos(Math.min(total, (a.currentTime / a.duration + 0.02) * total));
    }, 90);
    return () => clearInterval(id);
  }, [text, total, audioRef]);

  let offset = 0;
  let index = 0;
  for (let i = 0; i < chunks.length; i++) {
    index = i;
    if (pos < offset + chunks[i].length + 1 || i === chunks.length - 1) break;
    offset += chunks[i].length + 1;
  }
  const spoken = pos - offset;
  let acc = 0;
  return (
    <p key={index} className="call-caption text-[17px] sm:text-lg leading-[1.55] font-medium">
      {chunks[index].split(" ").map((w, i) => {
        const start = acc;
        acc += w.length + 1;
        return (
          <span key={i} className={`transition-colors duration-200 ${start < spoken ? "text-white" : "text-white/35"}`}>
            {w}{" "}
          </span>
        );
      })}
    </p>
  );
}

function SideButton({ icon: Icon, label, onClick, tone = "neutral", testId }) {
  const styles = tone === "danger"
    ? "bg-rose-500/15 border-rose-400/35 text-rose-200 hover:bg-rose-500 hover:text-white"
    : "bg-white/[0.06] border-white/15 text-white/80 hover:bg-white/[0.12] hover:text-white";
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="group flex w-[88px] flex-col items-center gap-2 rounded-2xl focus:outline-none">
      <span className={`flex h-[54px] w-[54px] items-center justify-center rounded-full border transition-colors group-focus-visible:ring-2 group-focus-visible:ring-violet-300 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[#070613] ${styles}`}>
        <Icon size={20} />
      </span>
      <span className="text-xs text-white/60">{label}</span>
    </button>
  );
}

export default function VoiceCallModal({
  lang, sending, preparing, listening, interim, speaking, supported = true, speechError,
  lastUserText, lastLunaText, audioRef, analyser, onToggleMic, onClose,
}) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [elapsed, setElapsed] = useState(0);
  const stageRef = useRef(null);
  const mainButtonRef = useRef(null);
  const micBlocked = speechError === "not-allowed";
  // Where the mic permission lives: the Android app (a TWA), the installed
  // desktop app window, or a normal browser tab.
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const inAndroidApp = document.referrer.startsWith("android-app://")
    || (standalone && /Android/i.test(navigator.userAgent));

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // onClose is a new function on every parent render — read it through a
  // ref so this runs once (focus must not jump back every second).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    mainButtonRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.(); // back to the button that opened the call
    };
  }, []);

  const state = !supported || (speechError && !listening)
    ? "error"
    : sending || preparing ? "thinking"
    : listening ? "listening"
    : speaking ? "speaking"
    : "idle";

  const copy = {
    idle: {
      title: t("Seni dinlemeye hazırım", "Ready when you are"),
      hint: t("Konuşmak için mikrofona dokun.", "Tap the microphone to talk."),
      action: t("Konuş", "Talk"),
    },
    listening: {
      title: t("Dinliyorum", "Listening"),
      hint: t("Sözünü bitirdiğinde Luna cevap verir.", "Luna answers when you finish."),
      // With nothing heard yet the button just stops listening.
      action: interim ? t("Gönder", "Send") : t("Durdur", "Stop"),
    },
    thinking: {
      title: t("Düşünüyorum", "Thinking"),
      hint: "",
      action: t("Bekle", "Wait"),
    },
    speaking: {
      title: t("Luna konuşuyor", "Luna is speaking"),
      hint: "",
      action: t("Araya gir", "Interrupt"),
    },
    error: !supported
      ? {
          title: t("Sesli görüşme bu tarayıcıda çalışmıyor", "Voice calls don't work in this browser"),
          hint: t("Chrome ya da Edge ile açabilir ya da yazarak devam edebilirsin.", "Open Luna in Chrome or Edge, or continue by text."),
          action: t("Kullanılamıyor", "Unavailable"),
        }
      : speechError === "service-not-allowed"
      ? {
          title: t("Ses tanıma bu tarayıcıda kapalı", "Speech recognition is off in this browser"),
          hint: t("Chrome ya da Edge ile deneyebilir ya da yazarak devam edebilirsin.", "Try Chrome or Edge, or continue by text."),
          action: t("Tekrar dene", "Try again"),
        }
      : micBlocked
      ? {
          title: t("Mikrofon izni gerekli", "Microphone access needed"),
          // The apps have no address bar to point at.
          hint: inAndroidApp
            ? t("Telefonunun ayarlarında Chrome'un mikrofon iznini aç, sonra Chrome > Site ayarları > Mikrofon'dan lunai.tr'ye izin ver.",
                "Turn on Chrome's microphone permission in your phone settings, then allow lunai.tr in Chrome > Site settings > Microphone.")
            : standalone
            ? t("Pencerenin üst çubuğundaki site ayarları simgesinden mikrofona izin ver, sonra tekrar dene.",
                "Allow the microphone from the site settings icon in the window's title bar, then try again.")
            : t("Adres çubuğunun solundaki site ayarları simgesinden Luna'ya mikrofon izni ver, sonra tekrar dene.",
                "Allow the microphone from the site settings icon at the left of the address bar, then try again."),
          action: t("Tekrar dene", "Try again"),
        }
      : speechError === "audio-capture"
      ? {
          title: t("Mikrofon bulunamadı", "No microphone found"),
          hint: t("Bir mikrofon bağlı olduğundan emin olup tekrar dene.", "Make sure a microphone is connected, then try again."),
          action: t("Tekrar dene", "Try again"),
        }
      : speechError === "network"
      ? {
          title: t("Ses tanıma bağlantısı kurulamadı", "Couldn't reach speech recognition"),
          hint: t("İnternet bağlantını kontrol edip tekrar dene.", "Check your internet connection, then try again."),
          action: t("Tekrar dene", "Try again"),
        }
      : {
          title: t("Sesini alamadım", "I couldn't hear you"),
          hint: t("Tekrar denemek için mikrofona dokun.", "Tap the microphone to try again."),
          action: t("Tekrar dene", "Try again"),
        },
  }[state];

  const mainDisabled = state === "thinking" || !supported;
  const mainStyle = {
    idle: "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_10px_40px_-6px_rgba(167,139,250,0.75)]",
    listening: "bg-[#f1ecff] text-violet-800 shadow-[0_0_0_8px_rgba(207,224,255,0.14),0_10px_40px_-6px_rgba(207,224,255,0.6)]",
    speaking: "bg-white/[0.1] border border-white/25 text-white backdrop-blur-md",
    thinking: "bg-white/[0.06] border border-white/10 text-white/40",
    error: "bg-white/[0.08] border border-white/20 text-white/80",
  }[state];
  const listenPreview = interim && interim.length > 150 ? "…" + interim.slice(-150) : interim;

  return (
    // overflow-y-auto: on a very short screen (phone in landscape) the
    // controls stay reachable by scrolling instead of being cut off.
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto overflow-x-hidden bg-[#070613] text-white"
      role="dialog" aria-modal="true" aria-label={t("Luna ile sesli görüşme", "Voice call with Luna")}
      data-testid="voice-call-modal" data-call-state={state}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(90% 55% at 50% 0%, #1b1440 0%, rgba(27,20,64,0) 70%), radial-gradient(70% 40% at 50% 100%, rgba(76,29,149,0.22), transparent 70%)" }} />
      <MoonCanvas state={state} analyser={speaking ? analyser : null} activityKey={listening ? interim : ""} stageRef={stageRef} />

      <header className="call-rise relative flex shrink-0 items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <span className="flex items-center gap-2.5">
          <img src={lunaLogo} alt="" className="h-7 w-7 rounded-full" />
          <span className="text-[15px] font-semibold text-white/90">Luna</span>
        </span>
        <span className="text-[13px] tabular-nums text-white/50" aria-label={t("Görüşme süresi", "Call duration")}>
          {formatTime(elapsed)}
        </span>
      </header>

      {/* Reserved space — the moon is drawn centred on it and sized to fit
          (MoonCanvas), so it may shrink on short screens. */}
      <div ref={stageRef} className="relative min-h-[72px] flex-1" />

      <section className="call-rise relative mx-auto flex w-full max-w-xl shrink-0 flex-col items-center px-6 text-center">
        <h2 className="text-[22px] font-semibold tracking-tight sm:text-2xl" aria-live="polite">{copy.title}</h2>
        {/* Fixed height: captions change every few seconds and must not
            resize the moon's stage (that would make the moon jump). */}
        <div className="mt-3 flex h-[132px] w-full max-w-[34ch] items-start justify-center overflow-hidden sm:max-w-[40ch] [@media(max-height:560px)]:mt-1.5 [@media(max-height:560px)]:h-[80px] [@media(max-height:560px)]:text-[15px]">
          {state === "speaking" && lastLunaText ? (
            <SpokenCaption text={lastLunaText} audioRef={audioRef} />
          ) : state === "listening" && listenPreview ? (
            <p className="text-[17px] leading-[1.55] text-white sm:text-lg">{listenPreview}</p>
          ) : state === "thinking" && lastUserText ? (
            <p className="line-clamp-3 text-[15px] leading-[1.55] text-white/45">“{lastUserText}”</p>
          ) : (
            <p className="text-[15px] leading-[1.55] text-white/55">{copy.hint}</p>
          )}
        </div>
        {/* Screen readers get Luna's whole reply once, not every caption tick. */}
        <p className="sr-only" aria-live="polite">{state === "speaking" ? toSpoken(lastLunaText) : ""}</p>
      </section>

      <nav className="call-rise relative flex shrink-0 items-end justify-center gap-6 px-4 pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))] pt-6 sm:gap-10 [@media(max-height:560px)]:pb-3 [@media(max-height:560px)]:pt-2"
        aria-label={t("Görüşme kontrolleri", "Call controls")}>
        <SideButton icon={Keyboard} label={t("Yazıya geç", "Type instead")} onClick={onClose}
          testId="voice-call-continue-text-button" />

        {/* aria-disabled, not disabled: a disabled button drops keyboard
            focus every thinking turn (and can't take focus on open). */}
        <button ref={mainButtonRef} type="button" onClick={mainDisabled ? undefined : onToggleMic}
          aria-disabled={mainDisabled} data-testid="voice-call-mic-button"
          className="group flex w-[96px] flex-col items-center gap-2 focus:outline-none aria-disabled:cursor-not-allowed">
          <span className={`relative flex h-[76px] w-[76px] items-center justify-center rounded-full transition-all duration-300 group-focus-visible:ring-2 group-focus-visible:ring-violet-200 group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-[#070613] ${mainDisabled ? "" : "group-active:scale-95"} ${mainStyle}`}>
            {state === "thinking" && (
              <span className="call-spin absolute inset-[-3px] rounded-full border-2 border-transparent border-t-violet-300/80" aria-hidden="true" />
            )}
            {state === "listening"
              ? (interim ? <ArrowUp size={28} strokeWidth={2.4} /> : <Square size={22} fill="currentColor" strokeWidth={0} />)
              : <Mic size={28} strokeWidth={state === "speaking" ? 2 : 2.2} />}
          </span>
          <span className="text-xs font-medium text-white/75">{copy.action}</span>
        </button>

        <SideButton icon={PhoneOff} label={t("Bitir", "End")} onClick={onClose} tone="danger"
          testId="voice-call-stop-button" />
      </nav>
    </div>
  );
}
