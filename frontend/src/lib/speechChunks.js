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
// Never a tiny piece: Gemini's TTS refuses some very short texts outright
// ("Merhaba!" -> 400, "Olur." -> no audio at all) while sentences of 16+
// characters were always fine. So a short first sentence takes the next one
// along, and a short later piece joins its neighbour. Only a reply that is
// itself that short is sent as it is (the server retries it, and the device's
// own voice covers it if that fails too — lib/browserVoice.js).
//
// Pieces end at sentence ends where they can, otherwise after a , ; : or
// dash, otherwise between words — never inside a word.

const FIRST_MAX = 110; // a first sentence up to this long is the whole first piece
const FIRST_CUT = 90;  // a longer one is cut before here
const FIRST_MIN = 30;  // a shorter one takes the next sentence along
const LATER_MIN = 25;  // a later piece shorter than this joins a neighbour
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
  if (space >= minHead) return [s.slice(0, space).trim(), s.slice(space + 1).trim()];
  // One enormous "word" (with less than minHead before it): cut after it,
  // never inside it nor before it (that would leave a tiny head).
  const after = s.indexOf(" ", limit);
  return after > 0 ? [s.slice(0, after).trim(), s.slice(after + 1).trim()] : [s, ""];
}

export function toSpeechPieces(text) {
  const sentences = splitSentences((text || "").replace(/\s+/g, " ").trim());
  if (!sentences.length) return [];

  // The first piece: short, for a fast start, but never a tiny one. A short
  // first sentence takes the next along even when the two together are over
  // FIRST_MAX — they are then cut again below, past FIRST_MIN characters.
  let first = sentences.shift();
  while (first.length < FIRST_MIN && sentences.length) first = `${first} ${sentences.shift()}`;
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
      if (piece.length < LATER_MIN) {
        // Nothing yet (one sentence longer than the piece may be), or too
        // little to stand alone ("Evet."): fill the piece up with the next
        // sentence's head; its rest comes next.
        const room = piece ? limit - piece.length - 1 : limit;
        const [head, rest] = cutAt(sentences[0], room, Math.floor(room / 2));
        piece = piece ? `${piece} ${head}` : head;
        if (rest) sentences[0] = rest;
        else sentences.shift();
      }
      break;
    }
    pieces.push(piece);
    said += piece.length;
  }

  // What is still tiny (a short last sentence that didn't fit the piece
  // before it, the tail of a cut) joins a neighbour: the next piece, or the
  // one before when it is the last.
  for (let i = pieces.length - 1; i >= 1; i--) {
    if (pieces[i].length >= LATER_MIN) continue;
    if (i < pieces.length - 1) pieces[i + 1] = `${pieces[i]} ${pieces[i + 1]}`;
    else pieces[i - 1] = `${pieces[i - 1]} ${pieces[i]}`;
    pieces.splice(i, 1);
  }
  return pieces;
}
