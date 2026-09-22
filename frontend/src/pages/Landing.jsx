import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ShieldCheck, Sparkles, Play, Mail, Moon, ArrowRight, ChevronDown, Check,
} from "lucide-react";
import StarField from "@/components/StarField";
import lunaLogo from "@/assets/luna-logo.png";
import { LANGUAGES } from "@/lib/languages";
import { getLandingCopy } from "@/lib/landing-copy";

const NAV_IDS = ["anasayfa", "ozellikler", "nasil-calisir", "hakkinda", "guvenlik", "sss", "iletisim"];

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getInitialLang() {
  try {
    const saved = localStorage.getItem("luna_lang");
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {}
  return "tr";
}

function LangSwitcher({ lang, setLang }) {
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="lang-switcher-button"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/80 hover:bg-white/5 transition-colors"
      >
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.code.toUpperCase()}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border border-white/10 overflow-hidden min-w-[150px]"
            style={{ backgroundColor: "rgba(12,8,22,0.95)", backdropFilter: "blur(14px)", boxShadow: "0 12px 40px rgba(0,0,0,0.55)" }}>
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                data-testid={`lang-option-${l.code}`}
                onClick={() => { setLang(l.code); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-white/5 transition-colors"
              >
                <span>{l.flag}</span>
                <span className="flex-1 text-white/80">{l.label}</span>
                {l.code === lang && <Check size={14} className="text-purple-300" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [lang, setLang] = useState(getInitialLang);
  const copy = getLandingCopy(lang);

  useEffect(() => {
    try { localStorage.setItem("luna_lang", lang); } catch {}
  }, [lang]);

  return (
    <div className="relative min-h-screen bg-[#05040c] text-white overflow-x-hidden">
      <StarField mode="jarvis" />
      <div className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "radial-gradient(60% 40% at 50% 0%, rgba(139,92,246,0.18), transparent 70%)" }} />

      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#05040c]/80 border-b border-purple-500/15">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <a href="#anasayfa" onClick={(e) => { e.preventDefault(); scrollToId("anasayfa"); }}
            className="flex items-center gap-2.5 shrink-0" data-testid="landing-logo">
            <img src={lunaLogo} alt="Luna" className="w-8 h-8 rounded-full object-cover" />
            <span className="font-extrabold tracking-[0.15em] text-lg">LUNA</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            {NAV_IDS.map((id, i) => (
              <a key={id} href={`#${id}`} data-testid={`nav-link-${id}`}
                onClick={(e) => { e.preventDefault(); scrollToId(id); }}
                className="hover:text-white transition-colors whitespace-nowrap">
                {copy.nav[i]}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <LangSwitcher lang={lang} setLang={setLang} />
            <button onClick={() => navigate("/app")} data-testid="nav-cta-button"
              className="luna-cta-btn flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white">
              {copy.ctaStart} <ArrowRight size={15} className="luna-cta-arrow" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main id="anasayfa" className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pt-20 pb-24 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide px-3 py-1 rounded-full border border-purple-400/30 text-purple-300 bg-purple-500/10 mb-6">
            <Sparkles size={12} /> {copy.badge}
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.1] mb-5 tracking-tight">
            {copy.heroTitle[0]}<br className="hidden sm:block" /> {copy.heroTitle[1]}
          </h1>
          <p className="text-white/70 text-lg mb-3 max-w-md">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent font-semibold">Luna</span>,{" "}
            {copy.heroLead}
          </p>
          <p className="text-white/45 max-w-md mb-9 leading-relaxed">
            {copy.heroSub}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate("/app")} data-testid="hero-cta-button"
              className="luna-cta-btn flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-white">
              {copy.ctaMeet} <ArrowRight size={16} className="luna-cta-arrow" />
            </button>
            <button onClick={() => scrollToId("ozellikler")} data-testid="hero-secondary-button"
              className="flex items-center gap-2 px-6 py-3 rounded-full font-semibold border border-white/15 text-white/85 hover:bg-white/5 transition-colors">
              <Play size={14} /> {copy.ctaExplore}
            </button>
          </div>
        </div>

        <div className="relative flex items-center justify-center" style={{ minHeight: 380 }}>
          <div className="absolute rounded-full blur-3xl opacity-50"
            style={{ width: 380, height: 380, background: "radial-gradient(circle, rgba(139,92,246,0.55), transparent 70%)" }} />
          <div className="absolute rounded-full" style={{ width: 300, height: 300, border: "1px solid rgba(192,132,252,0.2)" }} />
          <div className="absolute rounded-full animate-spin-slow" style={{ width: 340, height: 340, border: "1px dashed rgba(192,132,252,0.18)" }} />
          <img src={lunaLogo} alt="Luna" className="relative rounded-full object-cover"
            style={{ width: 220, height: 220, boxShadow: "0 0 80px rgba(168,85,247,0.55)" }} />

          <div className="absolute -bottom-2 right-0 sm:right-6 rounded-2xl px-4 py-3 max-w-[220px]"
            style={{ backgroundColor: "rgba(18,10,32,0.75)", backdropFilter: "blur(10px)", border: "1px solid rgba(192,132,252,0.25)", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] font-mono tracking-wide text-white/50 uppercase">{copy.onlineBadge}</span>
            </div>
            <p className="text-xs text-white/85">{copy.onlineMsg}</p>
          </div>
        </div>
      </main>

      {/* Features */}
      <section id="ozellikler" className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">{copy.featuresTitle}</h2>
          <p className="text-white/45 max-w-xl mx-auto">{copy.featuresSub}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {copy.features.map((f) => (
            <div key={f.title} data-testid={`feature-card-${f.title}`}
              className="rounded-2xl border border-white/10 jarvis-glass p-6 hover:border-purple-400/30 hover:-translate-y-1 transition-all">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-5 ${f.color}`}>
                <f.icon size={19} />
              </div>
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="nasil-calisir" className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">{copy.howTitle}</h2>
          <p className="text-white/45 max-w-xl mx-auto">{copy.howSub}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {copy.how.map((s, i) => (
            <div key={s.title} className="relative">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: "rgba(192,132,252,0.15)", color: "#e9d5ff", border: "1px solid rgba(192,132,252,0.3)" }}>
                  {i + 1}
                </span>
                <s.icon size={18} className="text-purple-300" />
              </div>
              <h3 className="font-semibold mb-1.5">{s.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="hakkinda" className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4">{copy.aboutTitle}</h2>
        <p className="text-white/60 max-w-2xl mx-auto mb-4 leading-relaxed">
          {copy.aboutP1[0]}<strong className="text-white">{copy.aboutP1[1]}</strong>{copy.aboutP1[2]}
          <strong className="text-white">{copy.aboutP1[3]}</strong>{copy.aboutP1[4]}
        </p>
        <p className="text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
          {copy.aboutP2}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {copy.stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 jarvis-glass py-5">
              <div className="text-xl font-extrabold bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">{s.value}</div>
              <div className="text-xs text-white/45 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="guvenlik" className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20">
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-8 sm:p-10">
          <div className="flex items-center gap-3 mb-5">
            <ShieldCheck className="text-emerald-400" size={26} />
            <h2 className="text-2xl sm:text-3xl font-bold">{copy.securityTitle}</h2>
          </div>
          <ul className="grid sm:grid-cols-2 gap-4 text-sm text-white/65">
            {copy.security.map((s, i) => (
              <li key={i} className="flex gap-2"><span className="text-emerald-400 mt-0.5">✓</span> {s}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section id="sss" className="relative z-10 max-w-3xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20">
        <h2 className="text-2xl sm:text-3xl font-bold mb-10 text-center">{copy.faqTitle}</h2>
        <div className="space-y-4">
          {copy.faq.map((item, i) => (
            <div key={item.q} data-testid={`faq-item-${i}`} className="rounded-2xl border border-white/10 jarvis-glass p-5">
              <h3 className="font-semibold text-white mb-2">{item.q}</h3>
              <p className="text-sm text-white/55 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="iletisim" className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pb-24 scroll-mt-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">{copy.readyTitle}</h2>
        <p className="text-white/55 mb-7">{copy.readySub}</p>
        <div className="flex flex-wrap justify-center gap-3 mb-10">
          <button onClick={() => navigate("/app")} data-testid="footer-cta-button"
            className="luna-cta-btn flex items-center gap-2 px-7 py-3 rounded-full font-semibold text-white">
            {copy.ctaStart} <ArrowRight size={16} className="luna-cta-arrow" />
          </button>
          <a href="mailto:xsfei.technology@gmail.com" data-testid="contact-email-link"
            className="flex items-center gap-2 px-7 py-3 rounded-full font-semibold border border-white/15 text-white/85 hover:bg-white/5 transition-colors">
            <Mail size={15} /> xsfei.technology@gmail.com
          </a>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 py-8 text-center text-xs text-white/35">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Moon size={13} /> LUNA
        </div>
        © {new Date().getFullYear()} XSF Technology — {copy.footerRights}
      </footer>
    </div>
  );
}
