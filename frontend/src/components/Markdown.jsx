import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown } from "../lib/markdown";

// Luna's reply rendered from Markdown (lib/markdown.js parses it): every
// node becomes a plain React element, so text is always escaped by React —
// no HTML string, no dangerouslySetInnerHTML. Links open in a new tab
// (rel="noopener noreferrer"); only http(s)/mailto addresses ever become
// links (lib/links.js safeHref). Tables and code scroll sideways inside the
// bubble on a phone instead of stretching the page.
//
// streaming: the reply is still arriving (lib/streamedTurn.js) — its
// unfinished tail renders as what it is becoming, never as raw ** or ```.

const COPY = {
  tr: { copy: "Kopyala", copied: "Kopyalandı", code: "kod", label: "Kodu kopyala" },
  en: { copy: "Copy", copied: "Copied", code: "code", label: "Copy code" },
};

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // (falls back below — e.g. a page not allowed the clipboard API)
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch (_) {
    return false;
  }
}

function CodeBlock({ lang, text, ui }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="my-2 first:mt-0 last:mb-0 overflow-hidden rounded-xl border border-purple-400/20 bg-black/40"
      data-testid="md-code-block">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-purple-200/70">{lang || ui.code}</span>
        <button type="button" onClick={onCopy} aria-label={ui.label} data-testid="md-copy-button"
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-purple-200/80 hover:bg-white/5 hover:text-white">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? ui.copied : ui.copy}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="whitespace-pre font-mono text-purple-50">{text}</code>
      </pre>
    </div>
  );
}

function Inline({ nodes }) {
  return (nodes || []).map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className="rounded bg-black/35 px-1 py-0.5 font-mono text-[0.86em] text-fuchsia-100 [overflow-wrap:anywhere]">
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={i} className="font-semibold text-white"><Inline nodes={node.children} /></strong>;
      case "em":
        return <em key={i}><Inline nodes={node.children} /></em>;
      case "del":
        return <del key={i} className="opacity-70"><Inline nodes={node.children} /></del>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" data-testid="md-link"
            className={`text-fuchsia-200 underline decoration-fuchsia-300/40 underline-offset-2 hover:text-white hover:decoration-white/70${
              node.auto ? " break-all" : ""}`}>
            <Inline nodes={node.children} />
          </a>
        );
      default:
        return null;
    }
  });
}

const HEADING_CLASS = {
  1: "text-[17px] font-bold",
  2: "text-base font-bold",
  3: "text-[15px] font-semibold",
  4: "text-sm font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-semibold text-purple-100/90",
};

const ALIGN_CLASS = { left: "text-left", center: "text-center", right: "text-right" };

function Blocks({ blocks, ui, tight = false }) {
  return (blocks || []).map((block, i) => {
    switch (block.type) {
      case "heading": {
        // h1 of the reply -> h3 on the page (the page has its own h1/h2).
        const Tag = `h${Math.min(block.level + 2, 6)}`;
        return (
          <Tag key={i} className={`mt-3 mb-1.5 first:mt-0 last:mb-0 text-white ${HEADING_CLASS[block.level] || HEADING_CLASS[6]}`}>
            <Inline nodes={block.children} />
          </Tag>
        );
      }
      case "paragraph":
        // (a list item's only paragraph sits right after its bullet)
        return tight
          ? <span key={i}><Inline nodes={block.children} /></span>
          : <p key={i} className="my-2 first:mt-0 last:mb-0"><Inline nodes={block.children} /></p>;
      case "code":
        return <CodeBlock key={i} lang={block.lang} text={block.text} ui={ui} />;
      case "hr":
        return <hr key={i} className="my-3 border-0 border-t border-purple-300/20" />;
      case "blockquote":
        return (
          <blockquote key={i} className="my-2 first:mt-0 last:mb-0 border-l-2 border-purple-300/40 pl-3 text-purple-100/85">
            <Blocks blocks={block.children} ui={ui} />
          </blockquote>
        );
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        const startProps = block.ordered && block.start != null && block.start !== 1 ? { start: block.start } : {};
        return (
          <ListTag key={i} {...startProps}
            className={`my-2 first:mt-0 last:mb-0 space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-purple-300/80`}>
            {block.items.map((item, k) => (
              <li key={k} className="pl-0.5">
                {item.checked != null && (
                  <span aria-hidden="true" className="mr-1.5">{item.checked ? "☑" : "☐"}</span>
                )}
                <Blocks blocks={item.children} ui={ui} tight={item.children.length === 1 && item.children[0].type === "paragraph"} />
              </li>
            ))}
          </ListTag>
        );
      }
      case "table":
        return (
          <div key={i} className="my-2 first:mt-0 last:mb-0 max-w-full overflow-x-auto rounded-xl border border-purple-400/20"
            data-testid="md-table">
            <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="bg-white/[0.06]">
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c} scope="col"
                      className={`border-b border-purple-400/20 px-3 py-2 align-bottom font-semibold text-white ${ALIGN_CLASS[block.align[c]] || ""}`}>
                      <Inline nodes={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-white/5 first:border-t-0">
                    {row.map((cell, c) => (
                      <td key={c} className={`px-3 py-1.5 align-top ${ALIGN_CLASS[block.align[c]] || ""}`}>
                        <Inline nodes={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

function Markdown({ text, streaming = false, lang = "tr", className = "" }) {
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  const ui = COPY[lang === "en" ? "en" : "tr"];
  return (
    <div className={`luna-md break-words text-left ${className}`} data-testid="md-root">
      <Blocks blocks={blocks} ui={ui} />
    </div>
  );
}

export default memo(Markdown);
