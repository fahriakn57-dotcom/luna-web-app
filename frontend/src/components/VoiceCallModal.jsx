import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, PhoneOff, Mic, ArrowUp, Square, Play, RotateCcw } from "lucide-react";
import MoonCanvas from "@/components/voice/MoonCanvas";
import lunaLogo from "@/assets/luna-logo.png";
import lunaSky from "@/assets/luna-bg.jpg";
import { toSpoken, toChunks } from "@/lib/spokenText";
import { haptics } from "@/lib/haptics";

// The voice call screen. Luna is drawn as a moon whose phase shows the state
// of the call (voice/moonScene.js); below it, what is being said right now.
// The conversation logic (hands-free turns, playback, closing) lives in
// hooks/useVoiceCall.js — this component only shows it.
//
// state: idle | listening | thinking | speaking | paused | readout | error

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Luna's reply, one caption at a time, words lighting up roughly in step
// with the audio. Progress = currentTime / duration, spread over the pieces
// by their timing weight (sentence ends and commas take a little longer).
function SpokenCaption({ text, audioRef }) {
  const chunks = useMemo(() => toChunks(toSpoken(text)), [text]);
  const total = useMemo(() => chunks.reduce((n, c) => n + c.weight, 0), [chunks]);
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
    if (pos < offset + chunks[i].weight || i === chunks.length - 1) break;
    offset += chunks[i].weight;
  }
  const chunk = chunks[index];
  const spoken = ((pos - offset) / chunk.weight) * (chunk.text.length + 1);
  let acc = 0;
  return (
    <p key={index} className="call-caption font-medium [text-wrap:pretty]">
      {chunk.text.split(" ").map((w, i) => {
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

// Keep the screen on during the call (a hands-free conversation shouldn't die
// when the phone dims); let it go after two quiet minutes.
function useScreenWakeLock(enabled, quiet) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return undefined;
    let sentinel = null;
    let cancelled = false;
    let quietTimer = null;
    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        sentinel.addEventListener("release", () => { sentinel = null; });
        if (cancelled) sentinel.release().catch(() => {});
      } catch (_) {}
    };
    const release = () => {
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
    if (quiet) quietTimer = setTimeout(release, 120000);
    acquire();
    const onVisibility = () => { if (document.visibilityState === "visible" && !quiet) acquire(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(quietTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, quiet]);
}

export default function VoiceCallModal({
  lang, state, capturing, interim, pendingText, speechError, supported = true, lastSent, replyText,
  voiceFailedMessage, canReplay, handsFree, autoPaused, coach, audioRef, analyser, flareKey, exiting,
  onMainAction, onTalkInstead, onReplay, onToggleHandsFree, onClose,
}) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [micSlow, setMicSlow] = useState(false);
  const stageRef = useRef(null);
  const mainButtonRef = useRef(null);
  const micBlocked = speechError === "not-allowed";
  // Where the mic permission lives: the Android app (a TWA), the installed
  // desktop app window, or a normal browser tab.
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const inAndroidApp = document.referrer.startsWith("android-app://")
    || (standalone && /Android/i.test(navigator.userAgent));

  // Measured from the start, so it stays right after the screen was off.
  useEffect(() => {
    if (exiting) return undefined;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    const id = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [exiting]);

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

  // Waiting for a tap counts as quiet: after two minutes the screen may sleep.
  useScreenWakeLock(!exiting, ["idle", "error", "paused", "readout"].includes(state));

  // "Mikrofon açılıyor" until the engine really records; some engines never
  // report it, so fall back after a moment.
  useEffect(() => {
    setMicSlow(false);
    if (state !== "listening" || capturing) return undefined;
    const id = setTimeout(() => setMicSlow(true), 2500);
    return () => clearTimeout(id);
  }, [state, capturing]);
  const micOpen = state === "listening" && (capturing || micSlow);

  // Feel the turns (Android): the mic is open, something broke…
  const prev = useRef({ state, micOpen });
  useEffect(() => {
    const p = prev.current;
    if (micOpen && !p.micOpen) haptics.tick();
    if (state === "error" && p.state !== "error") haptics.error();
    prev.current = { state, micOpen };
  }, [state, micOpen]);
  // …and your words really went (flareKey changes only on a real send).
  const lastFlare = useRef(flareKey);
  useEffect(() => {
    if (flareKey === lastFlare.current) return;
    lastFlare.current = flareKey;
    haptics.doubleTick();
  }, [flareKey]);

  const idleHint = autoPaused
    ? t("Buradayım. Hazır olduğunda dokun.", "I'm here. Tap when you're ready.")
    : coach
    ? t("Konuş; sustuğunda Luna cevap verir. Sözünü kesmek için dokunabilirsin.", "Just talk; Luna answers when you pause. Tap to interrupt her.")
    : t("Konuşmak için dokun.", "Tap to talk.");

  const heard = [pendingText, interim].filter(Boolean).join(" ");

  const copy = {
    idle: { title: t("Seni dinlemeye hazırım", "Ready when you are"), hint: idleHint, action: t("Konuş", "Talk") },
    listening: {
      title: micOpen ? t("Dinliyorum", "Listening") : t("Mikrofon açılıyor", "Opening the mic"),
      hint: coach
        ? t("Sözünü bitirince kısa bir sessizlik yeter.", "When you're done, just pause for a moment.")
        : t("Sözünü bitirdiğinde Luna cevap verir.", "Luna answers when you finish."),
      action: heard ? t("Gönder", "Send") : t("Durdur", "Stop"),
    },
    thinking: { title: t("Düşünüyorum", "Thinking"), hint: "", action: t("Bekle", "Wait") },
    speaking: { title: t("Luna konuşuyor", "Luna is speaking"), hint: "", action: t("Araya gir", "Interrupt") },
    paused: {
      title: t("Luna durdu", "Luna paused"),
      hint: t("Kaldığı yerden devam etmek için dokun.", "Tap to continue where she stopped."),
      action: t("Devam et", "Resume"),
    },
    readout: { title: t("Cevabımı yazdım", "Here's my answer in text"), hint: voiceFailedMessage, action: t("Konuş", "Talk") },
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

  // Fixed accessible names — a label that flips while you talk would be
  // read aloud into the open mic.
  const mainAriaLabel = {
    idle: t("Konuşmaya başla", "Start talking"),
    listening: t("Konuşmayı bitir", "Finish talking"),
    thinking: t("Luna düşünüyor", "Luna is thinking"),
    speaking: t("Luna'nın sözünü kes ve konuş", "Interrupt Luna and talk"),
    paused: t("Luna'yı kaldığı yerden devam ettir", "Resume Luna"),
    readout: t("Konuşmaya başla", "Start talking"),
    error: supported ? t("Tekrar dene", "Try again") : t("Sesli görüşme kullanılamıyor", "Voice calls unavailable"),
  }[state];

  // Screen readers: announce only what isn't being heard anyway — never
  // read over Luna's voice or into the open mic.
  const liveText = state === "thinking" ? copy.title
    : state === "error" || state === "paused" ? `${copy.title}. ${copy.hint}`
    : state === "readout" ? `${voiceFailedMessage} ${toSpoken(replyText)}`
    : "";

  const mainDisabled = state === "thinking" || !supported;
  const mainStyle = {
    idle: "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_10px_40px_-6px_rgba(167,139,250,0.75)]",
    listening: "bg-[#eef3ff] text-indigo-800 shadow-[0_0_0_8px_rgba(207,224,255,0.14),0_10px_40px_-6px_rgba(207,224,255,0.6)]",
    speaking: "bg-white/[0.1] border border-white/25 text-white backdrop-blur-md",
    paused: "bg-[#f1ecff] text-violet-800 shadow-[0_10px_40px_-6px_rgba(196,181,253,0.6)]",
    readout: "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_10px_40px_-6px_rgba(167,139,250,0.75)]",
    thinking: "bg-white/[0.06] border border-white/10 text-white/40",
    error: "bg-white/[0.08] border border-white/20 text-white/80",
  }[state];
  const MainIcon = state === "listening" ? (heard ? ArrowUp : Square) : state === "paused" ? Play : Mic;
  // The turn is about to be sent (you paused after speaking): a ring drains
  // around the button; talking again restarts it.
  const endpointing = state === "listening" && !!pendingText && !interim;
  const sceneState = state === "readout" ? "idle" : state;
  const showAfterglow = state === "idle" && canReplay && !!replyText;

  return (
    // overflow-y-auto: on a very short screen (phone in landscape) the
    // controls stay reachable by scrolling instead of being cut off.
    <div className={`fixed inset-0 z-[100] flex flex-col overflow-y-auto overflow-x-hidden bg-[#070613] text-white ${exiting ? "call-exit pointer-events-none" : ""}`}
      role="dialog" aria-modal="true" aria-label={t("Luna ile sesli görüşme", "Voice call with Luna")}
      data-testid="voice-call-modal" data-call-state={state}>
      {/* The same sky as the chat screen, deeper: Luna rises as a moon above
          the glowing planet horizon. Its colour follows the call — cooler
          while it's your turn, warmer while Luna speaks (index.css). */}
      <div className="call-sky pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="call-sky-image absolute inset-0 bg-cover bg-bottom" style={{ backgroundImage: `url(${lunaSky})` }} />
      </div>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true"
        style={{ background: "linear-gradient(180deg, rgba(7,6,19,0.9) 0%, rgba(7,6,19,0.72) 38%, rgba(7,6,19,0.55) 62%, rgba(7,6,19,0.78) 100%)" }} />
      <MoonCanvas state={sceneState} analyser={analyser} activityKey={state === "listening" ? interim : ""}
        stageRef={stageRef} flareKey={flareKey} exiting={exiting} />

      <header className="call-rise relative flex shrink-0 items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <span className="flex items-center gap-2.5">
          <img src={lunaLogo} alt="" className="h-7 w-7 rounded-full" />
          <span className="text-[15px] font-semibold text-white/90">Luna</span>
        </span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={onToggleHandsFree} aria-pressed={handsFree} data-testid="voice-call-handsfree-toggle"
            title={t("Luna konuşmayı bitirince mikrofon kendiliğinden açılsın", "Reopen the mic automatically when Luna finishes")}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${
              handsFree ? "border-indigo-300/40 bg-indigo-400/15 text-indigo-100" : "border-white/15 text-white/50 hover:text-white/80"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${handsFree ? "bg-indigo-200" : "bg-white/30"}`} aria-hidden="true" />
            {t("Eller serbest", "Hands-free")}
          </button>
          <span className="text-[13px] tabular-nums text-white/50" aria-label={t("Görüşme süresi", "Call duration")}>
            {formatTime(elapsed)}
          </span>
        </span>
      </header>

      {/* Reserved space — the moon is drawn centred on it and sized to fit
          (MoonCanvas), so it may shrink on short screens. */}
      <div ref={stageRef} className="relative min-h-[72px] flex-1" />

      <section className="call-rise relative mx-auto flex w-full max-w-xl shrink-0 flex-col items-center px-6 text-center">
        <h2 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{copy.title}</h2>
        {/* Fixed height in em: grows with the user's text size, but never
            changes during the call (the moon's stage must not jump). */}
        <div className="relative mt-3 flex h-[7.75em] w-full max-w-[34ch] items-start justify-center overflow-hidden text-[17px] leading-[1.55] sm:max-w-[40ch] sm:text-lg [@media(max-height:560px)]:mt-1.5 [@media(max-height:560px)]:h-[4.65em] [@media(max-height:560px)]:text-[15px]">
          {state === "speaking" && replyText ? (
            <SpokenCaption text={replyText} audioRef={audioRef} />
          ) : state === "listening" && heard ? (
            // Newest words stay visible: long text overflows upward.
            <div className={`flex max-h-full flex-col justify-end overflow-hidden ${heard.length > 110 ? "[mask-image:linear-gradient(to_bottom,transparent,#000_1.6em)]" : ""}`}>
              <p className="text-white [text-wrap:pretty]">
                {pendingText && <span>{pendingText} </span>}
                {interim && <span className="text-white/75">{interim}</span>}
              </p>
            </div>
          ) : state === "thinking" && lastSent ? (
            <p key={lastSent} className="call-sent line-clamp-4 text-white/80 [@media(max-height:560px)]:line-clamp-3">“{lastSent}”</p>
          ) : state === "readout" ? (
            <div className="h-full w-full overflow-y-auto pb-[1.2em] text-left [mask-image:linear-gradient(to_bottom,#000_78%,transparent)] [scrollbar-width:thin]">
              {voiceFailedMessage && <p className="mb-2 text-center text-[0.85em] text-white/55">{voiceFailedMessage}</p>}
              <p className="text-white/85 [text-wrap:pretty]">{toSpoken(replyText)}</p>
            </div>
          ) : showAfterglow ? (
            <p className="line-clamp-4 text-[0.9em] text-white/45 [text-wrap:pretty] [@media(max-height:560px)]:line-clamp-3">{toSpoken(replyText)}</p>
          ) : (
            <p className="text-[0.9em] text-white/55 [text-wrap:pretty]">{copy.hint}</p>
          )}
        </div>
        {/* One fixed-height row for the small secondary actions, so showing
            them never moves anything else. */}
        <div className="flex h-9 items-center justify-center">
          {showAfterglow && (
            <button type="button" onClick={onReplay} data-testid="voice-call-replay"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              <RotateCcw size={13} /> {t("Tekrar dinle", "Play again")}
            </button>
          )}
          {state === "paused" && (
            <button type="button" onClick={onTalkInstead} data-testid="voice-call-talk-instead"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              <Mic size={13} /> {t("Bunun yerine konuş", "Talk instead")}
            </button>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{liveText}</p>
      </section>

      <nav className="call-rise relative flex shrink-0 items-end justify-center gap-6 px-4 pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))] pt-4 sm:gap-10 [@media(max-height:560px)]:pb-3 [@media(max-height:560px)]:pt-1"
        aria-label={t("Görüşme kontrolleri", "Call controls")}>
        <SideButton icon={Keyboard} label={t("Yazıya geç", "Type instead")} onClick={onClose}
          testId="voice-call-continue-text-button" />

        {/* aria-disabled, not disabled: a disabled button drops keyboard
            focus every thinking turn (and can't take focus on open). */}
        <button ref={mainButtonRef} type="button" onClick={mainDisabled ? undefined : onMainAction}
          aria-disabled={mainDisabled} aria-label={mainAriaLabel} data-testid="voice-call-mic-button"
          className="group flex w-[96px] flex-col items-center gap-2 focus:outline-none aria-disabled:cursor-not-allowed">
          <span className={`relative flex h-[76px] w-[76px] items-center justify-center rounded-full transition-all duration-300 group-focus-visible:ring-2 group-focus-visible:ring-violet-200 group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-[#070613] ${mainDisabled ? "" : "group-active:scale-95"} ${mainStyle}`}>
            {state === "thinking" && (
              <span className="call-spin absolute inset-[-3px] rounded-full border-2 border-transparent border-t-violet-300/80" aria-hidden="true" />
            )}
            {endpointing && (
              <svg key={pendingText} className="call-endpoint absolute inset-[-6px] h-[88px] w-[88px] -rotate-90" viewBox="0 0 88 88" aria-hidden="true">
                <circle cx="44" cy="44" r="42" fill="none" stroke="rgba(207,224,255,0.7)" strokeWidth="2" strokeLinecap="round" pathLength="100" />
              </svg>
            )}
            <MainIcon size={state === "listening" && !heard ? 22 : 28}
              fill={state === "paused" || (state === "listening" && !heard) ? "currentColor" : "none"}
              strokeWidth={state === "listening" && !heard ? 0 : state === "speaking" ? 2 : 2.2} />
          </span>
          <span className="text-xs font-medium text-white/75" aria-hidden="true">{copy.action}</span>
        </button>

        <SideButton icon={PhoneOff} label={t("Bitir", "End")} onClick={onClose} tone="danger"
          testId="voice-call-stop-button" />
      </nav>
    </div>
  );
}
