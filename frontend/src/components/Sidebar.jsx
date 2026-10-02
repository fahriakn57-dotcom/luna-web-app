import { ChevronRight, X } from "lucide-react";
import { LunaIcon, hueRgb } from "@/components/icons/LunaIcon";
import lunaLogo from "@/assets/luna-logo.png";

const MODE_ITEMS = [
  { key: "friend", glyph: "friend", label: "Arkadaş Modu" },
  { key: "work", glyph: "work", label: "LunaWorks Modu" },
];

const FRIEND_ITEMS = [
  { key: "journal", glyph: "journal", label: "Günlük" },
  { key: "memories", glyph: "memories", label: "Anılarım" },
  { key: "mood", glyph: "mood", label: "Ruh Halim" },
  { key: "day-info", glyph: "dayinfo", label: "Günün Anlamı" },
  { key: "hobbies", glyph: "hobbies", label: "Hobilerim" },
  { key: "goals", glyph: "goals", label: "Hedeflerim & Planlarım" },
  { key: "notes", glyph: "notes", label: "Notlarım" },
  { key: "alarms", glyph: "alarms", label: "Alarmlar" },
  { key: "usage", glyph: "usage", label: "Kullanımım" },
  { key: "settings", glyph: "settings", label: "Ayarlar" },
];

// Görsel üretiminin kendisi LunaWorks'ün sohbet giriş çubuğundaki Wand2
// butonundan çalışıyor (FriendPanel.jsx); "work-images" burada o üretimlerin
// galeri/liste görünümü (ImageGalleryPanel.jsx). PDF/Excel/Word/PowerPoint/
// Tablo/Grafik üretimi kendi panelinde (DocGeneratorPanel.jsx) — veri
// yapıştır, üret. "work-table" bir tabloyu görsel (PNG) olarak üretir —
// "work-excel" ise indirilebilir bir .xlsx dosyası; ikisi de aynı
// structure_table() çıktısını farklı şekilde render eder.
const WORK_ITEMS = [
  { key: "work-images", glyph: "images", label: "Ürettiklerim: Görsel" },
  { key: "work-pdf", glyph: "pdf", label: "Ürettiklerim: PDF" },
  { key: "work-excel", glyph: "excel", label: "Ürettiklerim: Excel" },
  { key: "work-word", glyph: "word", label: "Ürettiklerim: Word" },
  { key: "work-ppt", glyph: "ppt", label: "Ürettiklerim: PowerPoint" },
  { key: "work-table", glyph: "table", label: "Ürettiklerim: Tablo" },
  { key: "work-chart", glyph: "chart", label: "Ürettiklerim: Grafik" },
  { key: "settings", glyph: "settings", label: "Ayarlar" },
];

// The router's basename is "/app", so react-router's navigate("/") only
// lands back on /app/ — leaving for the marketing site needs a real
// full-page navigation to the domain root.
const goToMarketingHome = () => { window.location.href = "/"; };

// Luna's own icons, bare at 20px: slightly dimmed at rest, full on hover, and
// glowing softly in their own hue when the row is the active one.
function SidebarGlyph({ name, active = false }) {
  return (
    <LunaIcon name={name} size={20}
      className={`transition-opacity ${active ? "opacity-100" : "opacity-85 group-hover:opacity-100"}`}
      style={active ? { filter: `drop-shadow(0 0 4px rgba(${hueRgb(name)},.55))` } : undefined} />
  );
}

export default function Sidebar({ mode, lang, active, onNavigate, onOpenMemories, onOpenSettings, onOpenPanel, onOpenPremium, onOpenConversations, mobileOpen, onCloseMobile }) {
  const items = mode === "work" ? WORK_ITEMS : FRIEND_ITEMS;
  const t = (tr, en) => (lang === "tr" ? tr : en);

  const handleClick = (key) => {
    onCloseMobile?.();
    if (key === "memories") return onOpenMemories();
    if (key === "settings") return onOpenSettings();
    if (key === "friend" || key === "work") return onNavigate(key);
    if (["journal", "goals", "notes", "alarms", "hobbies", "mood", "day-info", "usage", "work-images", "work-pdf", "work-excel", "work-word", "work-ppt", "work-table", "work-chart"].includes(key)) return onOpenPanel(key);
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-[97] bg-black/60 lg:hidden" onClick={onCloseMobile} data-testid="sidebar-mobile-overlay" />
      )}
      <aside className={`fixed lg:static inset-y-0 left-0 z-[98] flex flex-col w-64 shrink-0 h-screen overflow-hidden border-r border-white/10 backdrop-blur-xl px-4 py-4 transition-transform duration-300 ease-out lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
        style={{ backgroundColor: "rgba(7,4,15,0.96)" }}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button onClick={goToMarketingHome} data-testid="sidebar-logo"
          className="flex items-center gap-2.5 px-2">
          <img src={lunaLogo} alt="Luna" className="w-8 h-8 rounded-full object-cover" />
          <span className="font-extrabold tracking-[0.15em] text-white">LUNA</span>
        </button>
        <button onClick={onCloseMobile} data-testid="sidebar-mobile-close"
          className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5">
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {MODE_ITEMS.map((it) => {
          const isActive = it.key === mode;
          return (
            <button key={it.key} data-testid={`sidebar-item-${it.key}`}
              onClick={() => handleClick(it.key)}
              className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gradient-to-r from-indigo-500/25 to-fuchsia-500/25 text-white border border-purple-400/30"
                  : "text-white/55 hover:text-white hover:bg-white/5"
              }`}>
              <SidebarGlyph name={it.glyph} active={isActive} />
              {it.label}
            </button>
          );
        })}

        <button data-testid="sidebar-item-conversations"
          onClick={() => { onCloseMobile?.(); onOpenConversations(); }}
          className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-white/55 hover:text-white hover:bg-white/5">
          <SidebarGlyph name="chats" />
          {t("Sohbetlerim", "My Chats")}
        </button>

        <div className="my-2 border-t border-white/10" />

        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button key={it.key} data-testid={`sidebar-item-${it.key}`}
              onClick={() => handleClick(it.key)}
              className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gradient-to-r from-indigo-500/25 to-fuchsia-500/25 text-white border border-purple-400/30"
                  : "text-white/55 hover:text-white hover:bg-white/5"
              }`}>
              <SidebarGlyph name={it.glyph} active={isActive} />
              {it.label}
            </button>
          );
        })}
      </nav>

      <div data-testid="sidebar-premium-card" onClick={onOpenPremium} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onOpenPremium()}
        className="cursor-pointer rounded-2xl border border-purple-400/25 bg-gradient-to-br from-indigo-500/10 to-fuchsia-500/10 p-4 mb-3 hover:border-purple-400/45 transition-colors">
        <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
          <LunaIcon name="premium" size={18} style={{ filter: `drop-shadow(0 0 4px rgba(${hueRgb("premium")},.55))` }} /> Luna Premium
        </div>
        <p className="text-[11px] text-white/50 mb-2">{t("Günlük mesaj sınırı yok, daha yüksek kullanım kotası.", "No daily message limit, a higher usage quota.")}</p>
        <span data-testid="sidebar-premium-button"
          className="w-full flex items-center justify-between text-xs font-semibold text-purple-200">
          {t("Detaylar", "Details")} <ChevronRight size={13} />
        </span>
      </div>

      <button onClick={goToMarketingHome} data-testid="sidebar-logout"
        className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/45 hover:text-white hover:bg-white/5 transition-colors">
        <SidebarGlyph name="home" /> {t("Ana sayfaya dön", "Back to home")}
      </button>
      </aside>
    </>
  );
}
