import { Phone, HeartHandshake } from "lucide-react";

// Shown under a reply when the server flagged the user's message as a
// possible crisis (backend services/safety.py: "self_harm" or "abuse").
// Calm on purpose — no alarm red, no dismiss button: the card belongs to that
// reply and stays with it. The numbers are shown as text as well, because a
// tel: link does nothing on most desktops.
// 112: Türkiye's single emergency number. 183: ALO 183, the Ministry of
// Family and Social Services' 24/7 line for violence and abuse.
const LINES = {
  self_harm: [{ phone: "112", tr: "Acil yardım", en: "Emergency" }],
  abuse: [
    { phone: "112", tr: "Acil yardım", en: "Emergency" },
    { phone: "183", tr: "ALO 183 Sosyal Destek Hattı", en: "ALO 183 support line" },
  ],
};

const COPY = {
  self_harm: {
    title: ["Yalnız değilsin", "You're not alone"],
    body: [
      "Kendini şu an güvende hissetmiyorsan hemen yardım iste. Güvendiğin biriyle konuşmak da iyi gelebilir.",
      "If you don't feel safe right now, please get help straight away. Talking to someone you trust can help too.",
    ],
  },
  abuse: {
    title: ["Yardım almak senin hakkın", "You deserve to be safe"],
    body: [
      "Şiddet ya da istismar yaşıyorsan bu senin suçun değil. Bu hatlar günün her saati açık.",
      "If you're facing violence or abuse, it is not your fault. These lines are open around the clock.",
    ],
  },
};

export default function CrisisCard({ kind, lang, compact = false }) {
  const lines = LINES[kind];
  const copy = COPY[kind];
  if (!lines || !copy) return null;
  const i = lang === "tr" ? 0 : 1;
  return (
    <section
      role="region"
      aria-label={copy.title[i]}
      data-testid="crisis-card"
      className={`rounded-2xl border border-rose-200/25 bg-[#2a1426]/90 text-rose-50 backdrop-blur-md ${
        compact ? "px-3.5 py-3" : "ml-9 max-w-[80%] px-4 py-3.5"
      }`}
    >
      <div className="flex items-center gap-2">
        <HeartHandshake size={17} className="shrink-0 text-rose-200" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{copy.title[i]}</h3>
      </div>
      {!compact && <p className="mt-1.5 text-[13px] leading-relaxed text-rose-50/85">{copy.body[i]}</p>}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {lines.map((l) => (
          <a
            key={l.phone}
            href={`tel:${l.phone}`}
            data-testid={`crisis-call-${l.phone}`}
            className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3.5 py-2 text-[13px] font-semibold text-[#3b1030] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100"
          >
            <Phone size={14} aria-hidden="true" />
            <span className="tabular-nums">{l.phone}</span>
            <span className="font-medium opacity-80">{lang === "tr" ? l.tr : l.en}</span>
          </a>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-rose-50/65">
        {lang === "tr"
          ? "Luna bir yapay zekadır; profesyonel desteğin yerini tutmaz."
          : "Luna is an AI and can't replace professional support."}
      </p>
    </section>
  );
}
