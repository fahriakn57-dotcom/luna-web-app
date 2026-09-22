import { useEffect, useState } from "react";
import { X, FileText, Table, FileType2, Presentation, Grid3x3, BarChart3, Trash2, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  generatePdf, generateExcel, generateWord, generatePpt, generateTableImage, generateChart,
  fetchGeneratedPdfs, fetchGeneratedExcels, fetchGeneratedWords, fetchGeneratedPpts, fetchGeneratedTableImages, fetchGeneratedCharts,
  deleteGeneratedPdf, deleteGeneratedExcel, deleteGeneratedWord, deleteGeneratedPpt, deleteGeneratedTableImage, deleteGeneratedChart,
} from "@/lib/api";

// One panel, four flavors — "Ürettiklerim: PDF / Excel / Word / PowerPoint"
// are the exact same form + list layout, only the generate/fetch/delete
// calls, icon, accent color and a couple of labels differ per kind.
const KIND_CONFIG = {
  pdf: {
    Icon: FileText, accent: "text-rose-300", gradient: "linear-gradient(90deg,#f43f5e,#c084fc)", ext: "pdf",
    title: { tr: "Ürettiklerim: PDF", en: "My Generated PDFs" },
    generateLabel: { tr: "PDF Oluştur", en: "Generate PDF" },
    placeholder: {
      tr: "Verini buraya yapıştır — bir liste, tablo, satır satır bilgi, ne olursa olsun. Luna onu düzenli bir tabloya çevirecek.",
      en: "Paste your data here — a list, a table, line-by-line info, anything. Luna will turn it into a clean table.",
    },
    generate: generatePdf, fetchFiles: fetchGeneratedPdfs, deleteFile: deleteGeneratedPdf,
  },
  excel: {
    Icon: Table, accent: "text-emerald-300", gradient: "linear-gradient(90deg,#10b981,#6366f1)", ext: "xlsx",
    title: { tr: "Ürettiklerim: Excel", en: "My Generated Excel Files" },
    generateLabel: { tr: "Excel Oluştur", en: "Generate Excel" },
    placeholder: {
      tr: "Verini buraya yapıştır — bir liste, tablo, satır satır bilgi, ne olursa olsun. Luna onu düzenli bir tabloya çevirecek.",
      en: "Paste your data here — a list, a table, line-by-line info, anything. Luna will turn it into a clean table.",
    },
    generate: generateExcel, fetchFiles: fetchGeneratedExcels, deleteFile: deleteGeneratedExcel,
  },
  word: {
    Icon: FileType2, accent: "text-sky-300", gradient: "linear-gradient(90deg,#0ea5e9,#6366f1)", ext: "docx",
    title: { tr: "Ürettiklerim: Word", en: "My Generated Word Docs" },
    generateLabel: { tr: "Word Belgesi Oluştur", en: "Generate Word Doc" },
    placeholder: {
      tr: "İçeriğini buraya yapıştır — notlar, taslak bir metin, ne olursa olsun. Luna onu başlıklara bölünmüş düzenli bir Word belgesine çevirecek.",
      en: "Paste your content here — notes, a rough draft, anything. Luna will turn it into a clean, sectioned Word document.",
    },
    generate: generateWord, fetchFiles: fetchGeneratedWords, deleteFile: deleteGeneratedWord,
  },
  ppt: {
    Icon: Presentation, accent: "text-amber-300", gradient: "linear-gradient(90deg,#f59e0b,#ef4444)", ext: "pptx",
    title: { tr: "Ürettiklerim: PowerPoint", en: "My Generated Slides" },
    generateLabel: { tr: "Sunum Oluştur", en: "Generate Slides" },
    placeholder: {
      tr: "İçeriğini buraya yapıştır — notlar, konu başlıkları, ne olursa olsun. Luna onu maddeler halinde bir sunuma çevirecek.",
      en: "Paste your content here — notes, talking points, anything. Luna will turn it into a bulleted slide deck.",
    },
    generate: generatePpt, fetchFiles: fetchGeneratedPpts, deleteFile: deleteGeneratedPpt,
  },
  table: {
    Icon: Grid3x3, accent: "text-violet-300", gradient: "linear-gradient(90deg,#8b5cf6,#6366f1)", ext: "png",
    title: { tr: "Ürettiklerim: Tablo", en: "My Generated Tables" },
    generateLabel: { tr: "Tablo Oluştur", en: "Generate Table" },
    placeholder: {
      tr: "Verini buraya yapıştır — bir liste, tablo, satır satır bilgi, ne olursa olsun. Luna onu görsel olarak paylaşılabilir düzenli bir tablo resmine çevirecek.",
      en: "Paste your data here — a list, a table, line-by-line info, anything. Luna will turn it into a clean, shareable table image.",
    },
    generate: generateTableImage, fetchFiles: fetchGeneratedTableImages, deleteFile: deleteGeneratedTableImage,
  },
  chart: {
    Icon: BarChart3, accent: "text-orange-300", gradient: "linear-gradient(90deg,#f97316,#eab308)", ext: "png",
    title: { tr: "Ürettiklerim: Grafik", en: "My Generated Charts" },
    generateLabel: { tr: "Grafik Oluştur", en: "Generate Chart" },
    placeholder: {
      tr: "Sayısal verini buraya yapıştır — kategori/değer çiftleri, bir liste, ne olursa olsun. Luna en uygun grafiği (çubuk, çizgi ya da pasta) çizecek.",
      en: "Paste your numeric data here — category/value pairs, a list, anything. Luna will draw the chart type (bar, line or pie) that fits best.",
    },
    generate: generateChart, fetchFiles: fetchGeneratedCharts, deleteFile: deleteGeneratedChart,
  },
};

export default function DocGeneratorPanel({ kind, lang, mode, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const cfg = KIND_CONFIG[kind];
  const { Icon, accent, gradient, ext: fileExt } = cfg;
  const panelTitle = t(cfg.title.tr, cfg.title.en);
  const generateLabel = t(cfg.generateLabel.tr, cfg.generateLabel.en);
  const dataPlaceholder = t(cfg.placeholder.tr, cfg.placeholder.en);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [rawData, setRawData] = useState("");
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const { fetchFiles, generate, deleteFile } = cfg;

  useEffect(() => {
    fetchFiles()
      .then(setFiles)
      .catch(() => toast.error(t("Dosyalar yüklenemedi", "Couldn't load files")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    if (!rawData.trim() || generating) return;
    setGenerating(true);
    try {
      const result = await generate(rawData.trim(), title.trim(), mode);
      setFiles((f) => [{ id: `tmp-${Date.now()}`, title: result.title, fileUrl: result.fileUrl, createdAt: new Date().toISOString() }, ...f]);
      setTitle("");
      setRawData("");
      toast.success(result.reply);
    } catch (e) {
      toast.error(t("Oluşturulamadı, tekrar dener misin?", "Couldn't generate that, try again?"));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (file) => {
    setDeletingId(file.id);
    try {
      await deleteFile(file.id);
      setFiles((f) => f.filter((x) => x.id !== file.id));
    } catch {
      toast.error(t("Silinemedi", "Couldn't delete"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid={`doc-gen-panel-${kind}`}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Icon size={17} className={accent} /> {panelTitle}
          </h2>
          <button onClick={onClose} data-testid="doc-gen-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Başlık (opsiyonel)", "Title (optional)")}
            data-testid="doc-gen-title-input"
            className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 border-b border-white/10 pb-2 mb-3"
          />
          <textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            placeholder={dataPlaceholder}
            rows={5}
            data-testid="doc-gen-data-input"
            className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 resize-none"
          />
          <button
            onClick={handleGenerate}
            disabled={!rawData.trim() || generating}
            data-testid="doc-gen-submit-button"
            className="w-full mt-3 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: gradient }}
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? t("Oluşturuluyor...", "Generating...") : generateLabel}
          </button>
        </div>

        {loading ? (
          <div className="flex-1 space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
            <Icon size={26} className={`${accent} opacity-40`} />
            <p className="text-sm text-white/50 max-w-xs">
              {t("Henüz bir şey üretmedin. Yukarıya veri yapıştırıp başlayabilirsin.", "You haven't generated anything yet. Paste some data above to get started.")}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {files.map((f) => (
              <div key={f.id} data-testid="doc-gen-file-row"
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={16} className={`${accent} shrink-0`} />
                  <span className="text-sm text-white/85 truncate">{f.title || t("İsimsiz", "Untitled")}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={f.fileUrl} download={`${(f.title || "luna-tablo").replace(/[^\p{L}\p{N}\s-]/gu, "")}.${fileExt}`}
                    data-testid="doc-gen-download-button"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5">
                    <Download size={15} />
                  </a>
                  <button onClick={() => handleDelete(f)} disabled={deletingId === f.id}
                    data-testid="doc-gen-delete-button"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-red-300 hover:bg-red-400/10 disabled:opacity-50">
                    {deletingId === f.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
