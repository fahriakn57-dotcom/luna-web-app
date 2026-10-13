import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, FileText, Maximize2 } from "lucide-react";
import lunaAvatar from "@/assets/luna-avatar.webp";
import Markdown from "@/components/Markdown";
import { AttachmentList, SourceChips } from "@/components/MessageExtras";

// memo: a streaming reply updates the message list many times a second, but
// only its own bubble gets a new msg object (lib/streamedTurn.js) — the
// rest of the chat skips re-rendering.
//
// Luna's text is Markdown (components/Markdown.jsx: headings, lists, tables,
// code with a copy button, links that open in a new tab), also while it
// streams in; what you typed stays plain text. Under her reply: the
// pictures / files made in chat (msg.attachments) and the web pages a
// searched reply used (msg.sources).
function ChatMessage({ msg, lang = "tr" }) {
  const isUser = msg.role === "user";
  // The picture open full screen: { src, name } | null.
  const [lightbox, setLightbox] = useState(null);
  const t = (tr, en) => (lang === "en" ? en : tr);

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
      <div className={`min-w-0 border px-4 py-2.5 text-sm leading-relaxed backdrop-blur-md rounded-2xl rounded-bl-md ${
        isUser ? `max-w-[80%] ${userBubble} rounded-br-md` : `max-w-[88%] sm:max-w-[80%] ${lunaBubble}`
      }`}>
        {!isUser && (
          <div className="mb-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-purple-300/80">
              Luna
            </span>
          </div>
        )}
        {msg.imageUrl && (
          <button onClick={() => setLightbox({ src: msg.imageUrl, name: `luna-${msg.id}.png` })} data-testid="chat-image-attachment"
            className="block w-full mb-2 group relative">
            <img src={msg.imageUrl} alt=""
              className="max-w-full max-h-64 rounded-xl object-cover transition-opacity group-hover:opacity-80" />
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/25 transition-colors opacity-0 group-hover:opacity-100">
              <Maximize2 size={22} className="text-white drop-shadow" />
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
        {msg.text && (isUser
          ? <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          : <Markdown text={msg.text} streaming={Boolean(msg.streaming)} lang={lang} />)}
        {!isUser && <AttachmentList attachments={msg.attachments} lang={lang} onOpenImage={setLightbox} />}
        {!isUser && !msg.streaming && <SourceChips sources={msg.sources} lang={lang} />}
      </div>

      {lightbox && createPortal(
        // Portaled straight to <body> — this bubble's own parent row has a
        // `fade-up` CSS animation on it, and per spec any ancestor with an
        // active/filled transform-affecting animation becomes the containing
        // block for `position: fixed` descendants (the classic "fixed inside
        // a transformed/animated element isn't really fixed" trap). Without
        // the portal this lightbox rendered pinned to that bubble's own box
        // instead of the viewport — never actually covering the screen.
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-4"
          onClick={() => setLightbox(null)} data-testid="chat-image-lightbox">
          <div onClick={(e) => e.stopPropagation()} className="max-w-lg w-full flex flex-col items-center gap-3">
            <img src={lightbox.src} alt="" className="w-full rounded-2xl border border-white/10"
              style={{ maxHeight: "70vh", objectFit: "contain" }} />
            <div className="flex items-center gap-3">
              <a href={lightbox.src} download={lightbox.name} data-testid="chat-image-download-button"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-purple-400/30 text-purple-200 hover:bg-purple-400/15">
                <Download size={13} /> {t("İndir", "Download")}
              </a>
              <button onClick={() => setLightbox(null)}
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-white/15 text-white/60 hover:text-white hover:bg-white/5">
                <X size={13} /> {t("Kapat", "Close")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default memo(ChatMessage);
