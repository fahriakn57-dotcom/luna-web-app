// Luna's replies as they are heard in a voice call: shared by the TTS request
// (so markdown symbols and emoji are never read aloud) and the call captions
// (so what you read matches what you hear).

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u{FE0F}\u{200D}\u{20E3}]/gu;

// Only markdown SYNTAX goes — "5*3", "snake_case", "C#" and "2**10" stay as
// written. Span patterns are length-capped (no runaway backtracking) and
// avoid regex lookbehind (older iOS Safari can't parse it).
export function toSpoken(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]\n]{0,300})\]\([^)\s]{0,2000}\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells) => cells.split("|").map((c) => c.trim()).join(", "))
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^([ \t]*)[-*+•][ \t]+/gm, "$1")
    .replace(/(^|[^\w*])(\*\*|__)(?=\S)([^\n]{1,300}?\S)\2(?![\w*])/g, "$1$3")
    .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]{0,300}?\S)\2(?![\w*])/g, "$1$3")
    .replace(/~~(?=\S)([^~\n]{1,300}?)~~/g, "$1")
    .replace(/`+([^`\n]*)`+/g, "$1")
    .replace(/(^|\s)\*{2,}|\*{2,}(?=\s|$)/g, "$1")
    .replace(EMOJI, "")
    .replace(/\s+([,.!?…;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Caption-sized pieces (about two lines on a phone): sentences, long ones
// split at , ; : and then at word boundaries. Each piece carries a timing
// weight — its length plus a little for the pause a sentence end or comma
// adds in speech — so the captions keep pace with the voice.
const MAX_CHUNK = 88;

function splitLong(sentence) {
  const out = [];
  // (no regex lookbehind — older iOS Safari can't parse it)
  const clauses = sentence.replace(/([,;:])\s+/g, "$1\u0000").split("\u0000");
  let cur = "";
  const push = () => { if (cur) out.push(cur); cur = ""; };
  for (const clause of clauses) {
    if ((cur ? cur.length + 1 : 0) + clause.length <= MAX_CHUNK) {
      cur = cur ? `${cur} ${clause}` : clause;
      continue;
    }
    push();
    if (clause.length <= MAX_CHUNK) {
      cur = clause;
      continue;
    }
    for (const w of clause.split(" ")) {
      if (cur && cur.length + 1 + w.length > MAX_CHUNK) push();
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  push();
  return out;
}

export function toChunks(text) {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) || [text];
  const chunks = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    for (const piece of s.length <= MAX_CHUNK ? [s] : splitLong(s)) {
      const pauses = (/[.!?…]["'”’)]*$/.test(piece) ? 10 : 0) + (piece.match(/[,;:]/g) || []).length * 4;
      chunks.push({ text: piece, weight: piece.length + 1 + pauses });
    }
  }
  return chunks.length ? chunks : [{ text, weight: text.length + 1 }];
}
