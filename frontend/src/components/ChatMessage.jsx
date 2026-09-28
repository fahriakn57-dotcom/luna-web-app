import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, FileText } from "lucide-react";
import lunaAvatar from "@/assets/luna-avatar.png";

export default function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const userBubble = "bg-gradient-to-br from-fuchsia-500/22 to-indigo-500/18 border-fuchsia-400/30 text-fuchsia-50";
  const lunaBubble = "bg-[#140b28]/90 border-purple-400/20 text-purple-50";

  return (
    <div className={`flex items-end gap-2 fade-up ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={isUser ? "user-chat-bubble" : "luna-chat-bubble"}>
      {!isUser && (
        <img src={lunaAvatar} alt="Luna" data-testid="luna-avatar"
          className="shrink-0 w-7 h-7 rounded-full object-cover mb-0.5"
          style={{ boxShadow: "0 0 12px rgba(192,132,252,0.5)" }} />
      )}
      <div className={`max-w-[80%] border px-4 py-2.5 text-sm leading-relaxed backdrop-blur-md rounded-2xl rounded-bl-md ${
        isUser ? userBubble + " rounded-br-md" : lunaBubble
      }`}>
        {!isUser && (
          <div className="mb-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-purple-300/80">
              Luna
            </span>
          </div>
        )}
        {msg.imageUrl && (
          <button onClick={() => setLightboxOpen(true)} data-testid="chat-image-attachment"
            className="block w-full mb-2 group relative">
            <img src={msg.imageUrl} alt=""
              className="max-w-full max-h-64 rounded-xl object-cover transition-opacity group-hover:opacity-80" />
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/25 transition-colors opacity-0 group-hover:opacity-100">
              <Download size={22} className="text-white drop-shadow" />
            </span>
          </button>
        )}
        {msg.fileUrl && (
          <a href={msg.fileUrl} download={msg.fileName} data-testid="chat-file-attachment"
            className="flex items-center gap-2.5 mb-2 rounded-xl border border-purple-400/25 bg-black/20 px-3.5 py-2.5 hover:bg-black/30 transition-colors">
            <FileText size={17} className="text-purple-300 shrink-0" />
            <span className="text-xs font-medium text-purple-100 truncate flex-1">{msg.fileName}</span>
            <Download size={15} className="text-purple-300 shrink-0" />
          </a>
        )}
        {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
      </div>

      {lightboxOpen && msg.imageUrl && createPortal(
        // Portaled straight to <body> — this bubble's own parent row has a
        // `fade-up` CSS animation on it, and per spec any ancestor with an
        // active/filled transform-affecting animation becomes the containing
        // block for `position: fixed` descendants (the classic "fixed inside
        // a transformed/animated element isn't really fixed" trap). Without
        // the portal this lightbox rendered pinned to that bubble's own box
        // instead of the viewport — never actually covering the screen.
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-4"
          onClick={() => setLightboxOpen(false)} data-testid="chat-image-lightbox">
          <div onClick={(e) => e.stopPropagation()} className="max-w-lg w-full flex flex-col items-center gap-3">
            <img src={msg.imageUrl} alt="" className="w-full rounded-2xl border border-white/10"
              style={{ maxHeight: "70vh", objectFit: "contain" }} />
            <div className="flex items-center gap-3">
              <a href={msg.imageUrl} download={`luna-${msg.id}.png`} data-testid="chat-image-download-button"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-purple-400/30 text-purple-200 hover:bg-purple-400/15">
                <Download size={13} /> İndir
              </a>
              <button onClick={() => setLightboxOpen(false)}
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-white/15 text-white/60 hover:text-white hover:bg-white/5">
                <X size={13} /> Kapat
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
