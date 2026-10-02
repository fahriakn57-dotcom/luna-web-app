import { useEffect, useState } from "react";
import { X, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { IconTile } from "@/components/icons/LunaIcon";
import { fetchGeneratedImages, deleteGeneratedImage } from "@/lib/api";

export default function ImageGalleryPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchGeneratedImages()
      .then(setImages)
      .catch(() => toast.error(t("Görseller yüklenemedi", "Couldn't load images")))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (img) => {
    setDeletingId(img.id);
    try {
      await deleteGeneratedImage(img.id);
      setImages((imgs) => imgs.filter((i) => i.id !== img.id));
      if (selected?.id === img.id) setSelected(null);
    } catch {
      toast.error(t("Görsel silinemedi", "Couldn't delete image"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose} data-testid="image-gallery-panel">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl border border-purple-400/20 p-6 max-h-[85vh] flex flex-col"
        style={{ backgroundColor: "#0c0818", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-3 text-base font-bold text-white">
            <IconTile name="images" size={40} /> {t("Ürettiklerim: Görsel", "My Generated Images")}
          </h2>
          <button onClick={onClose} data-testid="gallery-close-button"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 grid grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-square rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-10">
            <IconTile name="images" size={56} className="mb-1" />
            <p className="text-sm text-white/50 max-w-xs">
              {t(
                "Henüz bir görsel üretmedin. LunaWorks Modu'nda sohbet çubuğundaki ✨ butonuna basıp ne çizmemi istediğini yaz.",
                "You haven't generated an image yet. In LunaWorks Modu, tap the ✨ button in the chat bar and tell me what to draw."
              )}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
            {images.map((img) => (
              <button key={img.id} onClick={() => setSelected(img)} data-testid="gallery-image-thumb"
                className="group relative aspect-square rounded-xl overflow-hidden border border-white/10 hover:border-purple-400/50 transition-colors">
                <img src={img.imageUrl} alt={img.prompt} className="w-full h-full object-cover" />
                {img.prompt && (
                  <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white/90 line-clamp-2 text-left">{img.prompt}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 px-4"
          onClick={() => setSelected(null)} data-testid="gallery-image-lightbox">
          <div onClick={(e) => e.stopPropagation()} className="max-w-lg w-full flex flex-col items-center gap-3">
            <img src={selected.imageUrl} alt={selected.prompt}
              className="w-full rounded-2xl border border-white/10" style={{ maxHeight: "65vh", objectFit: "contain" }} />
            {selected.prompt && <p className="text-sm text-white/70 text-center px-2">{selected.prompt}</p>}
            <div className="flex items-center gap-3">
              <a href={selected.imageUrl} download={`luna-${selected.id}.png`} data-testid="gallery-download-button"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-purple-400/30 text-purple-200 hover:bg-purple-400/15">
                <Download size={13} /> {t("İndir", "Download")}
              </a>
              <button onClick={() => handleDelete(selected)} disabled={deletingId === selected.id}
                data-testid="gallery-delete-button"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-red-400/30 text-red-300 hover:bg-red-400/10 disabled:opacity-50">
                {deletingId === selected.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {t("Sil", "Delete")}
              </button>
              <button onClick={() => setSelected(null)} className="text-xs text-white/50 hover:text-white px-2">
                {t("Kapat", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
