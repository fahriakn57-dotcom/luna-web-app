import { useEffect, useRef, useState } from "react";
import { Send, Mic, MicOff, Menu, Paperclip, X, Wand2, Phone } from "lucide-react";
import { toast } from "sonner";
import ChatMessage from "@/components/ChatMessage";
import { IconTile, LunaIcon, hueRgb } from "@/components/icons/LunaIcon";
import { GlyphTile, GlowIcon } from "@/components/icons/GlyphTile";

const ACCEPTED_EXT = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "csv", "docx", "xlsx", "pptx", "zip"];
const ACCEPTED_ATTR = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx,.pptx,.zip";
const MAX_FILES = 10;

const QUICK_CHIPS = [
  { tr: "Bana motive edici bir söz söyle", en: "Give me a motivational quote" },
  { tr: "Bugün nasıl geçti anlatayım", en: "Let's talk about my day" },
  { tr: "Benimle sohbet et", en: "Let's just chat" },
];

const WORK_QUICK_CHIPS = [
  { tr: "Bu belgeyi özetle", en: "Summarize this document" },
  { tr: "Bu görselde ne var, anlat", en: "Tell me what's in this image" },
  { tr: "Bana yardım et", en: "Help me with something" },
];

// LunaWorks'ün sohbet giriş çubuğundaki Wand2 butonuna basınca açılan üretim
// menüsü. Hepsi (görsel dahil) aynı inline akışı kullanıyor: bir mod
// seçilir, kullanıcı yazar, gönderince Luna.jsx'teki ilgili generate*
// fonksiyonu çağrılır ve sonuç doğrudan sohbete düşer — ayrı bir modal
// pencere açılmıyor. `glyph` Luna'nın kendi (Celestial) ikonu — kenar
// çubuğundaki "Ürettiklerim" satırlarıyla aynı ikon ve renk.
const GEN_KIND_CONFIG = {
  image: {
    glyph: "images", tr: "Görsel", en: "Image",
    chip: { tr: "Görsel oluşturma modu — ne çizeyim?", en: "Image mode — what should I draw?" },
    placeholder: { tr: "Örn: mor tonlarda hilal ay şeklinde bir logo...", en: "E.g.: a crescent moon logo in purple tones..." },
  },
  pdf: {
    glyph: "pdf", tr: "PDF", en: "PDF",
    chip: { tr: "PDF modu — verini yaz ya da yapıştır", en: "PDF mode — write or paste your data" },
    placeholder: { tr: "Örn: geçen ayın gider listesi...", en: "E.g.: last month's expense list..." },
  },
  word: {
    glyph: "word", tr: "Word", en: "Word",
    chip: { tr: "Word modu — içeriğini yaz ya da yapıştır", en: "Word mode — write or paste your content" },
    placeholder: { tr: "Örn: proje raporu taslağı...", en: "E.g.: a project report draft..." },
  },
  ppt: {
    glyph: "ppt", tr: "PowerPoint", en: "PowerPoint",
    chip: { tr: "Sunum modu — konu başlıklarını yaz", en: "Slides mode — write your talking points" },
    placeholder: { tr: "Örn: yeni ürün lansmanı sunumu...", en: "E.g.: a new product launch deck..." },
  },
  excel: {
    glyph: "excel", tr: "Excel", en: "Excel",
    chip: { tr: "Excel modu — verini yaz ya da yapıştır", en: "Excel mode — write or paste your data" },
    placeholder: { tr: "Örn: haftalık satış rakamları...", en: "E.g.: weekly sales figures..." },
  },
  table: {
    glyph: "table", tr: "Tablo", en: "Table",
    chip: { tr: "Tablo modu — verini yaz ya da yapıştır", en: "Table mode — write or paste your data" },
    placeholder: { tr: "Örn: öğrenci not listesi...", en: "E.g.: a student grade list..." },
  },
  chart: {
    glyph: "chart", tr: "Grafik", en: "Chart",
    chip: { tr: "Grafik modu — sayısal verini yaz", en: "Chart mode — write your numeric data" },
    placeholder: { tr: "Örn: aylık gelir: Ocak 10bin, Şubat 12bin...", en: "E.g.: monthly revenue: Jan 10k, Feb 12k..." },
  },
};
const GEN_MENU_ORDER = ["image", "pdf", "word", "ppt", "excel", "table", "chart"];

export default function FriendPanel({
  lang, messages, sending, listening, interim,
  input, setInput, onSend, onSendMedia, onSendMediaBatch, onToggleMic, onOpenCall,
  workMode, onGenerateImage, generatingImage, onGenerateDoc, generatingDoc, onOpenMobileMenu,
}) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [genKind, setGenKind] = useState(null); // null | "image" | "pdf" | "word" | "ppt" | "excel" | "table" | "chart"
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const genMenuRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const hasMessages = messages.length > 0;
  const busy = sending || generatingImage || generatingDoc;

  useEffect(() => {
    if (!genMenuOpen) return;
    const onClickOutside = (e) => {
      if (genMenuRef.current && !genMenuRef.current.contains(e.target)) setGenMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [genMenuOpen]);

  const handleGenMenuPick = (key) => {
    setGenMenuOpen(false);
    setPendingFiles([]);
    setGenKind(key);
  };

  // Accepts up to MAX_FILES at once (file picker's `multiple` attr or a
  // multi-file drag-and-drop) — invalid-type files are dropped individually
  // (one toast, not one per bad file) so a batch with one bad apple still
  // sends the rest.
  const acceptFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const valid = incoming.filter((f) => ACCEPTED_EXT.includes((f.name.split(".").pop() || "").toLowerCase()));
    if (valid.length < incoming.length) {
      toast.error(t("Bazı dosyaları okuyamıyorum (png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, zip olmalı).", "I can't read some of these files (must be png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx, or zip)."));
    }
    if (!valid.length) return;
    setGenKind(null);
    setPendingFiles((prev) => {
      const merged = [...prev, ...valid];
      if (merged.length > MAX_FILES) {
        toast.error(t(`En fazla ${MAX_FILES} dosya ekleyebilirsin.`, `You can attach at most ${MAX_FILES} files.`));
      }
      return merged.slice(0, MAX_FILES);
    });
  };

  const handleFilePick = (e) => {
    acceptFiles(e.target.files);
    e.target.value = ""; // lets picking the SAME file(s) again re-fire onChange
  };

  const removePendingFile = (idx) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Drag-and-drop straight from the OS (e.g. dragging a file out of the
  // browser's own download-history panel, as opposed to only the paperclip
  // button's file picker). dragDepth counts enter/leave pairs because
  // dragenter/dragleave fire once per CHILD element too — without it the
  // highlight flickers off the instant the pointer crosses into a child.
  const handleDragEnter = (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (e) => {
    e.preventDefault(); // required for onDrop to ever fire
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    acceptFiles(e.dataTransfer?.files);
  };

  // Ctrl+V a screenshot/copied image straight into the text field — browsers
  // expose a clipboard image as a File-like item (kind "file"), same shape
  // acceptFiles already handles for drag-and-drop and the file picker. Only
  // intercepts when the clipboard actually carries an image; a normal text
  // paste falls through untouched.
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = Array.from(items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length) {
      e.preventDefault();
      acceptFiles(imageFiles);
    }
  };

  const handleSendWithAttachment = () => {
    if (genKind) {
      const prompt = input.trim();
      if (!prompt) return;
      setInput("");
      const kind = genKind;
      setGenKind(null);
      if (kind === "image") onGenerateImage(prompt);
      else onGenerateDoc(kind, prompt);
      return;
    }
    if (pendingFiles.length) {
      const caption = input;
      const files = pendingFiles;
      setPendingFiles([]);
      setInput("");
      if (files.length === 1) onSendMedia(files[0], caption);
      else onSendMediaBatch(files, caption);
      return;
    }
    onSend();
  };
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  return (
    <div className="flex flex-col min-h-0 min-w-0 flex-1">
        <div className="flex items-center mb-1 gap-2">
          <button onClick={onOpenMobileMenu} data-testid="mobile-menu-button"
            aria-label={t("Menü", "Menu")}
            className="lg:hidden w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white/60 border border-white/10 hover:bg-white/5">
            <Menu size={17} />
          </button>
          <div className="min-w-0">
            <p className="text-white/60 text-sm">{t("Merhaba! 👋", "Hey there! 👋")}</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              {workMode
                ? <>{t("", "")}<span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">LunaWorks</span>{t(" — görsel, PDF, belge, ne istersen.", " — images, PDFs, documents, whatever you need.")}</>
                : <>{t("Ben ", "I'm ")}<span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">Luna</span>{t(", senin AI arkadaşın.", ", your AI companion.")}</>}
            </h1>
          </div>
          {!workMode && (
            <button onClick={onOpenCall} data-testid="open-voice-call-button"
              aria-label={t("Sesli ara", "Voice call")}
              className="ml-auto shrink-0 w-10 h-10 rounded-full flex items-center justify-center border border-purple-400/30 text-purple-200 hover:bg-purple-400/15 transition-colors"
              style={{ backgroundColor: "rgba(192,132,252,0.10)" }}>
              <Phone size={17} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${sending || listening ? "bg-purple-400 animate-pulse" : "bg-emerald-400"}`} />
          <span className="text-xs text-white/50">
            {listening ? (interim || t("Dinliyorum...", "Listening...")) : sending ? t("Düşünüyorum...", "Thinking...") : t("Luna aktif ve seni dinliyor", "Luna is active and listening")}
          </span>
        </div>

        <div className="relative flex-1 min-h-0 rounded-3xl border overflow-hidden flex flex-col transition-colors"
          onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          style={{
            backgroundColor: dragOver ? "rgba(192,132,252,0.08)" : "rgba(255,255,255,0.035)",
            borderColor: dragOver ? "rgba(192,132,252,0.6)" : "rgba(192,132,252,0.15)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          }}>
          {!hasMessages && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
              <div style={{ width: 320, height: 320, borderRadius: "9999px",
                background: "radial-gradient(circle, rgba(192,132,252,0.16), transparent 70%)", filter: "blur(2px)" }} />
            </div>
          )}
          {dragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
              style={{ backgroundColor: "rgba(10,8,20,0.55)" }}>
              <div className="flex flex-col items-center gap-2 px-6 py-5 rounded-2xl border-2 border-dashed border-purple-400/60"
                style={{ backgroundColor: "rgba(20,11,40,0.9)" }}>
                <GlyphTile icon={Paperclip} hue="violet" size={48} />
                <p className="text-sm font-semibold text-white">{t("Bırak, Luna baksın 👀", "Drop it — Luna will take a look 👀")}</p>
              </div>
            </div>
          )}

          <div ref={listRef} data-testid="chat-message-list" className="relative flex-1 overflow-y-auto px-5 py-5 space-y-3 min-h-[220px]">
            {!hasMessages && (
              <div className="min-h-full flex flex-col items-center justify-center text-center gap-4">
                <IconTile name={workMode ? "work" : "friend"} size={56} />
                <p className="text-white/80 max-w-sm">
                  {workMode
                    ? t("Bir görsel/PDF yükle, bana bir görsel çizdir ya da ne yapmam gerektiğini yaz 📎🎨", "Upload an image/PDF, ask me to draw one, or just tell me what you need 📎🎨")
                    : t("Selam! Ben Luna 🌙 Bugün nasılsın?", "Hey! I'm Luna 🌙 How are you today?")}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {(workMode ? WORK_QUICK_CHIPS : QUICK_CHIPS).map((q, i) => (
                    <button key={i} data-testid="quick-prompt-chip" onClick={() => onSend(t(q.tr, q.en))}
                      className="text-xs px-3.5 py-1.5 rounded-full border border-purple-400/30 text-purple-200 hover:bg-purple-400 hover:text-black transition-all hover:-translate-y-0.5">
                      {t(q.tr, q.en)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <ChatMessage key={m.id} msg={m} />
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-purple-400/20 bg-[#140b28]/90 px-4 py-3">
                  {generatingImage ? (
                    <span className="text-xs text-purple-200/80">{t("Görsel çiziliyor... 🎨", "Drawing your image... 🎨")}</span>
                  ) : generatingDoc ? (
                    <span className="text-xs text-purple-200/80">{t("Oluşturuluyor... 📄", "Generating... 📄")}</span>
                  ) : (
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative p-3 border-t border-white/5">
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2 mx-1">
                {pendingFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} data-testid="pending-attachment-chip"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-400/10 border border-purple-400/25 text-xs text-purple-100 max-w-[180px]">
                    <GlowIcon icon={Paperclip} hue="violet" size={13} />
                    <span className="truncate">{f.name}</span>
                    <button onClick={() => removePendingFile(i)} data-testid="remove-attachment-button"
                      aria-label={t("Dosyayı kaldır", "Remove file")}
                      className="shrink-0 text-purple-300/70 hover:text-white transition-colors">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {pendingFiles.length > 1 && (
                  <button onClick={() => setPendingFiles([])} data-testid="clear-all-attachments-button"
                    className="text-[11px] text-white/40 hover:text-white/70 px-1.5">
                    {t("Tümünü kaldır", "Clear all")}
                  </button>
                )}
              </div>
            )}
            {genKind && (
              <div data-testid="generate-mode-chip"
                className="flex items-center gap-2 mb-2 mx-1 px-3 py-1.5 rounded-full bg-fuchsia-400/10 border border-fuchsia-400/25 text-xs text-fuchsia-100 w-fit max-w-full">
                <LunaIcon name={GEN_KIND_CONFIG[genKind].glyph} size={16}
                  style={{ filter: `drop-shadow(0 0 4px rgba(${hueRgb(GEN_KIND_CONFIG[genKind].glyph)},.55))` }} />
                <span>{t(GEN_KIND_CONFIG[genKind].chip.tr, GEN_KIND_CONFIG[genKind].chip.en)}</span>
                <button onClick={() => setGenKind(null)} data-testid="cancel-generate-mode-button"
                  aria-label={t("İptal et", "Cancel")}
                  className="shrink-0 text-fuchsia-300/70 hover:text-white transition-colors">
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept={ACCEPTED_ATTR} multiple onChange={handleFilePick}
                className="hidden" data-testid="chat-file-input" />
              <button data-testid="attach-file-button" onClick={() => fileInputRef.current?.click()}
                aria-label={t("Görsel veya belge ekle", "Attach an image or document")}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 border border-purple-400/25 text-purple-200 hover:bg-purple-400/15">
                <Paperclip size={16} />
              </button>
              {workMode && (
                <div ref={genMenuRef} className="relative shrink-0">
                  <button data-testid="generate-image-toggle-button"
                    onClick={() => setGenMenuOpen((v) => !v)}
                    aria-label={t("Görsel/belge oluştur", "Generate an image/document")}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 border ${
                      genKind || genMenuOpen ? "bg-fuchsia-400/20 border-fuchsia-400 text-fuchsia-200" : "border-purple-400/25 text-purple-200 hover:bg-purple-400/15"}`}>
                    <Wand2 size={16} />
                  </button>
                  {genMenuOpen && (
                    <div data-testid="generate-menu" role="menu"
                      className="absolute bottom-full left-0 mb-2 w-44 rounded-2xl border border-purple-400/25 p-1.5 shadow-2xl shadow-black/40 z-20"
                      style={{ backgroundColor: "rgba(15,10,28,0.97)", backdropFilter: "blur(10px)" }}>
                      {GEN_MENU_ORDER.map((key) => {
                        const it = GEN_KIND_CONFIG[key];
                        return (
                          <button key={key} data-testid={`generate-menu-item-${key}`}
                            onClick={() => handleGenMenuPick(key)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-purple-100 hover:bg-purple-400/15 hover:text-white transition-colors text-left">
                            <LunaIcon name={it.glyph} size={18} />
                            {t(it.tr, it.en)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <input data-testid="chat-input-field" value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendWithAttachment()}
                onPaste={handlePaste}
                placeholder={genKind
                  ? t(GEN_KIND_CONFIG[genKind].placeholder.tr, GEN_KIND_CONFIG[genKind].placeholder.en)
                  : pendingFiles.length
                  ? t("İsteğe bağlı bir not ekle...", "Add an optional note...")
                  : t("Luna'ya bir şey yaz...", "Write something to Luna...")}
                className="flex-1 min-w-0 bg-black/25 outline-none px-3 sm:px-4 py-2.5 rounded-full border border-purple-400/20 focus:border-purple-400 text-sm text-white placeholder:text-white/30 transition-colors" />
              <button data-testid="mic-toggle-button" onClick={onToggleMic}
                aria-label={t("Sesli konuş", "Speak")}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 ${
                  listening ? "bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.5)]" : "border border-purple-400/25 text-purple-200 hover:bg-purple-400/15"}`}>
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button data-testid="send-message-button" onClick={handleSendWithAttachment}
                disabled={(!input.trim() && !pendingFiles.length) || busy}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all disabled:opacity-40 hover:scale-105 shrink-0 bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
    </div>
  );
}
