// Luna's replies as Markdown — a small parser for what the model actually
// writes (LunaWorks answers with tables, headings, ```code``` and **bold**;
// searched replies with inline [site](url) citations), turned into a tree
// that components/Markdown.jsx renders with plain React elements. No HTML
// string is ever produced or injected: raw HTML in a reply stays text.
//
// Supported: ATX headings (#..######), paragraphs (a single newline is a
// line break, as replies were always shown), **bold** / __bold__, *italic* /
// _italic_, ***both***, ~~strike~~, `inline code`, fenced code blocks
// (``` or ~~~, with a language), ordered / unordered lists (nested by
// indentation, "- [ ]" task items), GFM tables (with alignment), block
// quotes, horizontal rules, [text](url) links, <url> autolinks and bare
// http(s) URLs, "\" escapes and <br> inside table cells.
//
// streaming: the reply is still being written. Its unfinished tail then
// renders as what it is becoming instead of as raw syntax — an unclosed
// **bold or `code runs to the end, a code fence without its closing ```
// is already a code block, and a half-written [link](https://... shows its
// text without the half address. Everything before the tail is parsed as
// usual, so the text only ever grows into its final shape.
//
// Node shapes:
//   block:  {type:"heading", level, children} | {type:"paragraph", children}
//           | {type:"code", lang, text, open} | {type:"hr"}
//           | {type:"list", ordered, start, items:[{checked, children:block[]}]}
//           | {type:"table", align:[null|"left"|"center"|"right"], header:inline[][], rows:inline[][][]}
//           | {type:"blockquote", children:block[]}
//   inline: {type:"text", text} | {type:"br"} | {type:"code", text}
//           | {type:"strong"|"em"|"del", children} | {type:"link", href, children, auto?}

import { safeHref } from "./links";

// ---------------------------------------------------------------- inline --

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!|~<>\"'".split(""));
const SPACE = /\s/;
const PUNCT = /[\p{P}\p{S}]/u;
const ALNUM = /[\p{L}\p{N}]/u;

const isSpace = (c) => c === undefined || c === "" || SPACE.test(c);
const isPunct = (c) => c !== undefined && c !== "" && PUNCT.test(c);
const isAlnum = (c) => c !== undefined && c !== "" && ALNUM.test(c);

function runLength(src, i, ch) {
  let k = i;
  while (src[k] === ch) k++;
  return k - i;
}

// The start of the next run of exactly `len` `ch`s after `from`, or -1.
function findRun(src, from, ch, len) {
  for (let k = from; k < src.length; k++) {
    if (src[k] !== ch) continue;
    const r = runLength(src, k, ch);
    if (r === len) return k;
    k += r - 1;
  }
  return -1;
}

// Where an emphasis opened at `from` with `len` × `ch` closes on the same
// line: a run of the same length that ends the span (not after a space; an
// underscore not inside a word). Code spans and escapes are skipped. -1: no
// closer on this line.
function findCloser(src, from, ch, len) {
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (c === "\n") return -1;
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "`") {
      const r = runLength(src, k, "`");
      const close = findRun(src, k + r, "`", r);
      if (close >= 0 && !src.slice(k, close).includes("\n")) k = close + r - 1;
      else k += r - 1;
      continue;
    }
    if (c !== ch) continue;
    const r = runLength(src, k, ch);
    if (r === len && k > from) {
      const before = src[k - 1];
      const after = src[k + r];
      const rightFlanking = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      if (rightFlanking && (ch !== "_" || !isAlnum(after))) return k;
    }
    k += r - 1;
  }
  return -1;
}

// A URL's end: trailing punctuation is the sentence's, not the address's,
// and so is a ")" the URL never opened.
function trimUrl(url) {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (".,;:!?*_~'\"]".includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ")" && (u.match(/\)/g) || []).length > (u.match(/\(/g) || []).length) {
      u = u.slice(0, -1);
      continue;
    }
    return u;
  }
}

// [text](url "title") at `at` (src[at] === "["): {text, url, end}, or
// {partial: true, text} when the text runs out inside the address (a link
// still being written), or null.
function matchLink(src, at) {
  let depth = 0;
  let k = at;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (ch === "\\") {
      k++;
      continue;
    }
    if (ch === "\n") return null;
    if (ch === "`") {
      const r = runLength(src, k, "`");
      const close = findRun(src, k + r, "`", r);
      k = (close >= 0 ? close + r : k + r) - 1;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (k >= src.length) return null;
  const text = src.slice(at + 1, k);
  if (k + 1 >= src.length) return { partial: true, text }; // "(" may be on its way
  if (src[k + 1] !== "(") return null;
  let p = k + 2;
  while (src[p] === " ") p++;
  let url;
  if (src[p] === "<") {
    const close = src.indexOf(">", p);
    if (close < 0) return src.indexOf("\n", p) < 0 ? { partial: true, text } : null;
    url = src.slice(p + 1, close);
    if (url.includes("\n")) return null;
    p = close + 1;
  } else {
    const start = p;
    let parens = 0;
    for (; p < src.length; p++) {
      const ch = src[p];
      if (ch === "\\") {
        p++;
        continue;
      }
      if (ch === "\n") return null;
      if (ch === " ") break;
      if (ch === "(") parens++;
      else if (ch === ")") {
        if (parens === 0) break;
        parens--;
      }
    }
    url = src.slice(start, p);
  }
  while (src[p] === " ") p++;
  if (src[p] === '"' || src[p] === "'") {
    const q = src.indexOf(src[p], p + 1);
    if (q < 0) return src.indexOf("\n", p) < 0 ? { partial: true, text } : null;
    p = q + 1;
    while (src[p] === " ") p++;
  }
  if (p >= src.length) return { partial: true, text };
  if (src[p] !== ")") return null;
  return { text, url, end: p + 1 };
}

function linkText(href) {
  if (href.startsWith("mailto:")) return href.slice(7);
  return href;
}

// opts.noLinks: inside a link's own text (an <a> never holds another).
export function parseInline(src, tail = false, opts = {}) {
  const text = String(src || "");
  const out = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    buf.split("\n").forEach((part, k) => {
      if (k) out.push({ type: "br" });
      if (part) out.push({ type: "text", text: part });
    });
    buf = "";
  };
  const push = (...nodes) => {
    flush();
    out.push(...nodes);
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === "\\" && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const run = runLength(text, i, "`");
      const close = findRun(text, i + run, "`", run);
      if (close >= 0) {
        let code = text.slice(i + run, close).replace(/\n/g, " ");
        if (code.length > 2 && code[0] === " " && code[code.length - 1] === " " && code.trim()) code = code.slice(1, -1);
        push({ type: "code", text: code });
        i = close + run;
        continue;
      }
      if (tail && !text.slice(i).includes("\n")) {
        // (a backtick just typed at the very end shows nothing yet)
        if (i + run < text.length) push({ type: "code", text: text.slice(i + run) });
        i = text.length;
        continue;
      }
      buf += text.slice(i, i + run);
      i += run;
      continue;
    }

    if (c === "<") {
      const head = text.slice(i, i + 4100);
      const br = /^<br\s*\/?>/i.exec(head);
      if (br) {
        push({ type: "br" });
        i += br[0].length;
        continue;
      }
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(head);
      const href = auto && !opts.noLinks ? safeHref(auto[1]) : null;
      if (href) {
        push({ type: "link", href, auto: true, children: [{ type: "text", text: linkText(href) }] });
        i += auto[0].length;
        continue;
      }
    }

    if (c === "[" || (c === "!" && text[i + 1] === "[")) {
      const at = c === "!" ? i + 1 : i;
      const link = matchLink(text, at);
      if (link && link.partial && tail) {
        // "[hurriyet.com.tr](https://www.hurr" while it streams: the text
        // shows, the half-written address doesn't.
        push(...parseInline(link.text, false, { noLinks: true }));
        i = text.length;
        continue;
      }
      if (link && !link.partial) {
        const children = parseInline(link.text, false, { noLinks: true });
        const href = opts.noLinks ? null : safeHref(link.url);
        if (href) push({ type: "link", href, children: children.length ? children : [{ type: "text", text: linkText(href) }] });
        else push(...children); // not a link Luna may open: its text only
        i = link.end;
        continue;
      }
    }

    if ((c === "h" || c === "H") && !opts.noLinks && !isAlnum(text[i - 1]) && /^https?:\/\//i.test(text.slice(i, i + 8))) {
      const m = /^https?:\/\/[^\s<>"'`]+/i.exec(text.slice(i, i + 4100));
      const url = m ? trimUrl(m[0]) : "";
      const href = url && /^https?:\/\/[^\s/?#]+/i.test(url) ? safeHref(url) : null;
      if (href) {
        push({ type: "link", href, auto: true, children: [{ type: "text", text: href }] });
        i += url.length;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      const em = matchEmphasis(text, i, tail, opts);
      if (em) {
        push(em.node);
        i = em.end;
        continue;
      }
      const run = runLength(text, i, c);
      // ("**" just typed at the very end of a streaming reply: the span it
      // opens hasn't started yet — nothing to show)
      if (!(tail && i + run === text.length)) buf += text.slice(i, i + run);
      i += run;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

function wrap(ch, run, children) {
  if (ch === "~") return { type: "del", children };
  if (run === 1) return { type: "em", children };
  if (run === 2) return { type: "strong", children };
  return { type: "strong", children: [{ type: "em", children }] };
}

function matchEmphasis(src, i, tail, opts) {
  const ch = src[i];
  const run = runLength(src, i, ch);
  if (ch === "~" ? run !== 2 : run > 3) return null;
  const before = src[i - 1];
  const after = src[i + run];
  // Opens only where a span can start ("5 * 3", "2**10", snake_case and
  // "C++" stay as written).
  if (isSpace(after)) return null;
  if (isPunct(after) && !(isSpace(before) || isPunct(before))) return null;
  if (ch === "_" && isAlnum(before)) return null;
  const close = findCloser(src, i + run, ch, run);
  if (close >= 0) {
    return { node: wrap(ch, run, parseInline(src.slice(i + run, close), false, opts)), end: close + run };
  }
  // A span still being written at the very end of a streaming reply.
  const rest = src.slice(i + run);
  if (tail && rest && !rest.includes("\n")) {
    const inner = rest.replace(new RegExp(`\\${ch}+$`), "");
    if (!inner) return null;
    return { node: wrap(ch, run, parseInline(inner, true, opts)), end: src.length };
  }
  return null;
}

// ----------------------------------------------------------------- blocks --

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^([ \t]*)([-*+•]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const isBlank = (line) => !line || !line.trim();

// Leading whitespace in columns (a tab counts 4).
function columns(ws) {
  let n = 0;
  for (const ch of ws) n += ch === "\t" ? 4 : 1;
  return n;
}
function indentOf(line) {
  return columns(/^[ \t]*/.exec(line)[0]);
}
// The line without up to `n` columns of leading whitespace.
function stripIndent(line, n) {
  let col = 0;
  let k = 0;
  while (k < line.length && col < n && (line[k] === " " || line[k] === "\t")) {
    col += line[k] === "\t" ? 4 : 1;
    k++;
  }
  return line.slice(k);
}

function matchFence(line) {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  if (m[2][0] === "`" && m[3].includes("`")) return null;
  const word = m[3].trim().split(/\s+/)[0] || "";
  const lang = /^[\w+#.-]{1,30}$/.test(word) ? word : "";
  return { indent: m[1].length, fence: m[2], lang };
}

function matchItem(line) {
  const m = ITEM.exec(line);
  if (!m) return null;
  const marker = m[2];
  const ordered = /\d/.test(marker[0]);
  const spaces = m[3] ? Math.min(columns(m[3]), 4) : 1;
  let text = m[4] || "";
  let checked = null;
  const task = /^\[([ xX])\][ \t]+/.exec(text);
  if (task) {
    checked = task[1] !== " ";
    text = text.slice(task[0].length);
  }
  return {
    indent: columns(m[1]),
    ordered,
    start: ordered ? parseInt(marker, 10) : null,
    text,
    empty: !m[4],
    checked,
    contentIndent: columns(m[1]) + marker.length + spaces,
  };
}

// The row's cells: outer pipes dropped, split at pipes outside code spans,
// "\|" a literal pipe.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
      continue;
    }
    if (ch === "`") {
      const r = runLength(s, k, "`");
      const close = findRun(s, k + r, "`", r);
      if (close >= 0) {
        cur += s.slice(k, close + r).replace(/\\\|/g, "|");
        k = close + r - 1;
        continue;
      }
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  const head = lines[i];
  const delim = lines[i + 1];
  if (delim === undefined || !head.includes("|") || !TABLE_DELIM.test(delim)) return false;
  return delim.includes("|") || head.trim().startsWith("|");
}

// Does line j start a block that ends the paragraph (or list item) before
// it? A list only interrupts a paragraph with an item that has text, and
// an ordered one only from 1 ("16. yüzyılda" inside a paragraph stays text).
function interrupts(lines, j) {
  const line = lines[j];
  if (matchFence(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || isTableStart(lines, j)) return true;
  const item = matchItem(line);
  return Boolean(item && !item.empty && (!item.ordered || item.start === 1));
}

function alignOf(cell) {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function parseTable(lines, i, tail) {
  const header = splitRow(lines[i]);
  const width = header.length;
  const align = splitRow(lines[i + 1]).map(alignOf);
  while (align.length < width) align.push(null);
  align.length = width;
  const rawRows = [];
  let j = i + 2;
  while (j < lines.length && !isBlank(lines[j]) && lines[j].includes("|") && !matchFence(lines[j]) && !HEADING.test(lines[j])) {
    rawRows.push(splitRow(lines[j]));
    j++;
  }
  const atEnd = tail && j >= lines.length;
  const fit = (cells) => {
    const row = cells.slice(0, width);
    while (row.length < width) row.push("");
    return row;
  };
  const rows = rawRows.map((cells, r) => fit(cells).map((cell) => parseInline(cell, atEnd && r === rawRows.length - 1)));
  return {
    block: { type: "table", align, header: header.map((cell) => parseInline(cell)), rows },
    next: j,
  };
}

function parseList(lines, startAt, tail) {
  const first = matchItem(lines[startAt]);
  const { ordered } = first;
  const base = first.indent;
  const items = [];
  let i = startAt;
  while (i < lines.length) {
    const it = matchItem(lines[i]);
    if (!it || HR.test(lines[i]) || it.ordered !== ordered || it.indent > base + 1) break;
    const content = [it.text];
    let j = i + 1;
    let afterBlank = false;
    while (j < lines.length) {
      const line = lines[j];
      if (isBlank(line)) {
        let k = j + 1;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k < lines.length && indentOf(lines[k]) >= base + 2) {
          for (let b = j; b < k; b++) content.push("");
          j = k;
          afterBlank = true;
          continue;
        }
        j = k;
        break;
      }
      const ind = indentOf(line);
      if (ind >= base + 2) {
        content.push(stripIndent(line, Math.min(ind, it.contentIndent)));
        j++;
        continue;
      }
      if (HR.test(line) || matchItem(line) || interrupts(lines, j)) break;
      if (afterBlank) break;
      content.push(line.trim()); // a lazy continuation of the item's text
      j++;
    }
    items.push({ checked: it.checked, children: parseBlocks(content, tail && j >= lines.length) });
    i = j;
  }
  return {
    block: { type: "list", ordered, start: ordered ? first.start : null, items },
    next: i,
  };
}

function parseBlocks(lines, tail) {
  const blocks = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const body = [];
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = FENCE_CLOSE.exec(lines[j]);
        if (c && c[1][0] === fence.fence[0] && c[1].length >= fence.fence.length) {
          closed = true;
          break;
        }
        body.push(stripIndent(lines[j], fence.indent));
        j++;
      }
      blocks.push({ type: "code", lang: fence.lang, text: body.join("\n"), open: !closed });
      i = closed ? j + 1 : j;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const content = (heading[2] || "").replace(/(^|[ \t]+)#+$/, "").trim();
      if (content) blocks.push({ type: "heading", level: heading[1].length, children: parseInline(content, tail && i === n - 1) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { block, next } = parseTable(lines, i, tail);
      blocks.push(block);
      i = next;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      let j = i;
      let m;
      while (j < n && (m = QUOTE.exec(lines[j]))) {
        inner.push(m[1]);
        j++;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(inner, tail && j >= n) });
      i = j;
      continue;
    }

    if (matchItem(line)) {
      const { block, next } = parseList(lines, i, tail);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [line.trim()];
    let j = i + 1;
    while (j < n && !isBlank(lines[j]) && !interrupts(lines, j)) {
      para.push(lines[j].trim());
      j++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n"), tail && j >= n) });
    i = j;
  }
  return blocks;
}

// A reply longer than this is shown as it is parsed up to here, the rest as
// plain text (a runaway reply must not freeze the chat).
const MAX_PARSE_CHARS = 60000;

export function parseMarkdown(text, { streaming = false } = {}) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  if (src.length > MAX_PARSE_CHARS) {
    const rest = [];
    src.slice(MAX_PARSE_CHARS).split("\n").forEach((part, k) => {
      if (k) rest.push({ type: "br" });
      if (part) rest.push({ type: "text", text: part });
    });
    return [...parseBlocks(src.slice(0, MAX_PARSE_CHARS).split("\n"), false), { type: "paragraph", children: rest }];
  }
  return parseBlocks(src.split("\n"), Boolean(streaming));
}

// The reply as plain text (copying a reply, accessibility labels).
export function plainText(nodes) {
  let out = "";
  for (const node of nodes || []) {
    if (node.type === "text") out += node.text;
    else if (node.type === "br") out += "\n";
    else if (node.type === "code" && typeof node.text === "string" && !node.children) out += node.text;
    else if (node.children) out += plainText(node.children);
  }
  return out;
}
