// Luna's reply (already as spoken text — see spokenText.js) cut into the
// pieces her voice is synthesized in during a call (lib/voicePlayer.js).
//
// Why pieces: the server's TTS takes about as long per character as it
// takes to say it, minus a little — a whole 200-character reply meant 8-14 s
// of silence before her first word. Now the first piece is short (she starts
// talking ~3 s after the reply arrives) and every later one is synthesized
// while the ones before it play.
//
// Measured: synthesis ≈ 1.5 s + 0.043 s per character, speech ≈ 14
// characters per second. A piece is fetched while the pieces before it are
// being said, so it may only be as long as they give it time for: each one
// may be GROWTH × everything before it, up to PIECE_MAX.
//
// Pieces end at sentence ends where they can, otherwise after a , ; : or
// dash, otherwise between words — never inside a word.

const FIRST_MAX = 110; // a first sentence up to this long is the whole first piece
const FIRST_CUT = 90;  // a longer one is cut before here
const FIRST_MIN = 30;  // a shorter one takes the next sentence along (a lone "Evet."
                       // would leave a gap while the long second piece is made)
const PIECE_MIN = 80;
const PIECE_MAX = 220;
const GROWTH = 1.8;
const CLAUSE_MARKS = ",;:—–";

// Sentence ends need a space after them, so "3.5" and "lunai.tr" stay whole.
function splitSentences(text) {
  const out = [];
  const end = /[.!?…]+["'”’)\]]*\s+/g;
  let from = 0;
  let m;
  while ((m = end.exec(text)) !== null) {
    out.push(text.slice(from, m.index + m[0].length).trim());
    from = m.index + m[0].length;
  }
  out.push(text.slice(from).trim());
  return out.filter(Boolean);
}

// [head, rest] with head at most `limit` characters: after the last clause
// mark that leaves at least `minHead` characters, else at the last space.
function cutAt(s, limit, minHead) {
  if (s.length <= limit) return [s, ""];
  for (let i = limit - 1; i >= minHead - 1; i--) {
    if (CLAUSE_MARKS.includes(s[i]) && s[i + 1] === " ") return [s.slice(0, i + 1).trim(), s.slice(i + 2).trim()];
  }
  const space = s.lastIndexOf(" ", limit);
  if (space > 0) return [s.slice(0, space).trim(), s.slice(space + 1).trim()];
  // One enormous "word": cut after it rather than inside it.
  const after = s.indexOf(" ", limit);
  return after > 0 ? [s.slice(0, after), s.slice(after + 1).trim()] : [s, ""];
}

export function toSpeechPieces(text) {
  const sentences = splitSentences((text || "").replace(/\s+/g, " ").trim());
  if (!sentences.length) return [];

  let first = sentences.shift();
  while (first.length < FIRST_MIN && sentences.length && first.length + 1 + sentences[0].length <= FIRST_MAX) {
    first = `${first} ${sentences.shift()}`;
  }
  if (first.length > FIRST_MAX) {
    const [head, rest] = cutAt(first, FIRST_CUT, FIRST_MIN);
    first = head;
    if (rest) sentences.unshift(rest);
  }

  const pieces = [first];
  let said = first.length;
  while (sentences.length) {
    const limit = Math.min(PIECE_MAX, Math.max(PIECE_MIN, Math.round(said * GROWTH)));
    let piece = "";
    while (sentences.length) {
      const joined = piece ? `${piece} ${sentences[0]}` : sentences[0];
      if (joined.length <= limit) {
        piece = joined;
        sentences.shift();
        continue;
      }
      if (!piece) {
        // One sentence longer than the piece may be: its head now, the rest next.
        const [head, rest] = cutAt(sentences[0], limit, Math.floor(limit / 2));
        piece = head;
        if (rest) sentences[0] = rest;
        else sentences.shift();
      }
      break;
    }
    pieces.push(piece);
    said += piece.length;
  }
  return pieces;
}
