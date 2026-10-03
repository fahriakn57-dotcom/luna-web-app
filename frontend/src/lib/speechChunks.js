// Luna's reply (already as spoken text — see spokenText.js) cut into the
// pieces her voice is synthesized in during a call (lib/voicePlayer.js) —
// WHILE the reply is still being written: it streams in (api.js
// streamVoiceChat), and her first piece goes to the voice the moment it is
// safe to cut, not after the whole reply.
//
// Why pieces: the server's TTS takes ≈ 1.6 s + 0.035 s per character
// (measured: 31 characters 2.4-2.7 s, 100 characters 4.5-5.1 s), and
// nothing is heard before a piece is done. Speech is ≈ 14 characters per
// second, so synthesis runs about twice as fast as she talks: a short first
// piece gets her talking soon, and each later piece is synthesized while the
// ones before it play — it may be up to GROWTH × everything before it, up to
// PIECE_MAX (a few bigger pieces: the server's voice allows only a few
// requests a minute, shared by everyone).
//
// The rules (lengths in characters of spoken text):
// - Piece 0: the first complete sentence(s) reaching FIRST_MIN. A longer
//   first sentence is cut after a , ; : or dash (else between words) so the
//   piece is at most FIRST_MAX — as soon as that much of it is there; the
//   sentence doesn't have to end first.
// - Later pieces: whole sentences, as many as fit the limit; a sentence
//   longer than the limit is cut like a long first one.
// - Never a tiny piece: Gemini's TTS refuses some very short texts outright
//   ("Merhaba!" -> 400, "Olur." -> no audio at all) while sentences of 16+
//   characters were always fine. So while the reply is still coming, a piece
//   is only cut once at least TAIL_MIN characters follow it; when the reply
//   is complete, a shorter rest joins the last piece. Only a reply that is
//   itself that short is sent as it is (the server retries it, and the
//   device's own voice covers it if that fails too — lib/browserVoice.js).
// - A sentence ends at . ! ? … followed by a space and a word that doesn't
//   start lowercase, so "3.5", "lunai.tr" and "16. yüzyıl" stay whole;
//   pieces never end inside a word.

const FIRST_MIN = 30;  // a shorter first sentence takes the next one along
const FIRST_MAX = 70;  // ...and the first piece is cut before here
const TAIL_MIN = 20;   // at least this much must follow a piece (see above)
const PIECE_MIN = 80;
const PIECE_MAX = 160;
const GROWTH = 2.5;
const CLAUSE_MARKS = ",;:—–";

// The ends of the sentences in text after `from` (the index just past the
// last mark). final: the text is complete, so its end is one too. A mark
// followed by a lowercase word ends no sentence: "16. yüzyıl" is a Turkish
// ordinal (cut after "16." her voice would say "on altı", not "on altıncı"),
// and "vb. şeyler" or "Hmm… bilmiyorum" go on too. (text has single spaces,
// so the next word starts right after the one that follows the mark.)
const LOWERCASE = /\p{Ll}/u;
function sentenceEnds(text, from, final) {
  const ends = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s)/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (!LOWERCASE.test(text[end + 1] || "")) ends.push(end);
  }
  if (final && text.length > from && ends[ends.length - 1] !== text.length) ends.push(text.length);
  return ends;
}

// Where to cut text[from…] (longer than `limit`) so the piece is at most
// `limit` long: after the last clause mark that leaves at least `minHead`
// characters, else at the last space, else after the one enormous "word"
// (never inside it). -1: that word hasn't ended yet.
function cutWithin(text, from, limit, minHead, final) {
  for (let i = from + limit - 1; i >= from + minHead - 1; i--) {
    if (CLAUSE_MARKS.includes(text[i]) && text[i + 1] === " ") return i + 1;
  }
  const space = text.lastIndexOf(" ", from + limit);
  if (space >= from + minHead) return space;
  const after = text.indexOf(" ", from + limit);
  if (after > from) return after;
  return final ? text.length : -1;
}

// The end of the next piece, which starts at `from` (piece number `index`,
// `said` characters in the pieces before it) — or -1: not safe to cut yet.
function nextCut(text, from, index, said, final) {
  const rest = text.length - from;
  if (rest <= 0) return -1;
  const ends = sentenceEnds(text, from, final);
  let end = -1;
  if (index === 0) {
    const first = ends.find((e) => e - from >= FIRST_MIN);
    if (first !== undefined && first - from <= FIRST_MAX) end = first;
    // (one char past FIRST_MAX: the word at the limit is known to be whole)
    else if (rest > FIRST_MAX + 1 || (final && rest > FIRST_MAX)) end = cutWithin(text, from, FIRST_MAX, FIRST_MIN, final);
    else if (final) end = text.length; // the whole reply is that short
  } else {
    const limit = Math.min(PIECE_MAX, Math.max(PIECE_MIN, Math.round(said * GROWTH)));
    // Which sentences fit is only known once the text runs past the limit.
    if (!final && rest <= limit + 1) return -1;
    let fit = -1;
    for (const e of ends) if (e - from <= limit) fit = e;
    if (fit - from >= TAIL_MIN) end = fit;
    else if (rest > limit) end = cutWithin(text, from, limit, Math.max(TAIL_MIN, Math.floor(limit / 2)), final);
    else end = text.length; // (final) all of the rest fits
  }
  if (end < 0) return -1;
  const tail = text.length - (end + 1);
  if (tail > 0 && tail < TAIL_MIN) return final ? text.length : -1;
  return end;
}

// Where the words already cut into pieces (`done`) end in `text`, words
// compared bare (no case, marks or symbols): the reply's final text may
// differ a little from what streamed in, or come all at once by another
// path. Looks for the last few of those words nearest to where they should
// be; at worst it goes by their number — words already said are never said
// again.
function resumeIndex(text, done) {
  const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const doneWords = done.split(" ").map(bare).filter(Boolean);
  if (!doneWords.length) return 0;
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const w = bare(m[0]);
    if (w) words.push({ w, end: m.index + m[0].length });
  }
  const expected = doneWords.length - 1; // the index the last one should have
  for (let n = Math.min(4, doneWords.length); n >= 1; n--) {
    const tail = doneWords.slice(-n);
    let best = -1;
    for (let i = n - 1; i < words.length; i++) {
      let same = true;
      for (let k = 0; k < n && same; k++) same = words[i - n + 1 + k].w === tail[k];
      if (!same) continue;
      // (a single common word only counts close to where it should be)
      if (n === 1 && Math.abs(i - expected) > 2) continue;
      if (best < 0 || Math.abs(i - expected) <= Math.abs(best - expected)) best = i;
    }
    if (best >= 0) return words[best].end;
  }
  return doneWords.length <= words.length ? words[expected].end : text.length;
}

// One reply's cutter. update(text, final) with the reply so far (spoken
// text) returns the pieces that can be cut from it now, in order — call it
// again as more arrives, and once with final = true when it is complete
// (everything left is cut then). The text may change a little between calls
// (see resumeIndex); what was cut stays cut.
export function createSpeechCutter() {
  let base = "";  // the text of the last update
  let pos = 0;    // where the next piece starts in it
  let count = 0;  // pieces cut so far
  let said = 0;   // ...and their characters
  return {
    update(text, final = false) {
      const t = (text || "").replace(/\s+/g, " ").trim();
      const done = base.slice(0, pos);
      if (pos > 0 && !t.startsWith(done)) pos = resumeIndex(t, done.trim());
      base = t;
      const out = [];
      for (;;) {
        while (t[pos] === " ") pos += 1;
        const end = nextCut(t, pos, count, said, final);
        if (end <= pos) break;
        const piece = t.slice(pos, end).trim();
        pos = end;
        if (!piece) continue;
        out.push(piece);
        count += 1;
        said += piece.length;
      }
      return out;
    },
  };
}
