/* global describe, test, expect */
// lib/speechChunks.js — run with:  CI=true npx craco test --watchAll=false src/lib/speechChunks.test.js
import { createSpeechCutter } from "./speechChunks";

const FIRST_MIN = 20;
const FIRST_MAX = 45;
const TAIL_MIN = 20;
const PIECE_MIN = 80;
const PIECE_MAX = 160;
const GROWTH = 2.5;

const norm = (s) => s.replace(/\s+/g, " ").trim();

// The whole reply at once (it came by the non-streamed path).
function whole(text) {
  return createSpeechCutter().update(text, true);
}

// The reply as it streams in, `step` characters at a time. -> the pieces
// cut while streaming (with the length of text there when each was cut),
// and the ones the final update added.
function streamed(text, step = 1) {
  const c = createSpeechCutter();
  const early = [];
  for (let n = step; n < text.length; n += step) {
    c.update(text.slice(0, n), false).forEach((p) => early.push({ p, at: n }));
  }
  return { early, rest: c.update(text, true) };
}

// Nothing is lost or said twice, no piece is tiny, and each piece fits its
// limit — piece 0 FIRST_MAX, a later one GROWTH × what was said before it
// (PIECE_MIN..PIECE_MAX) — except the last one, which may have taken a
// shorter rest along (up to TAIL_MIN more). (The texts here have no word long
// enough to be cut around.)
function checkPieces(text, pieces) {
  expect(pieces.join(" ")).toBe(norm(text));
  pieces.forEach((p) => expect(p.length).toBeGreaterThan(0));
  if (pieces.length > 1) {
    expect(pieces[0].length).toBeGreaterThanOrEqual(FIRST_MIN);
    pieces.slice(1).forEach((p) => expect(p.length).toBeGreaterThanOrEqual(TAIL_MIN));
  }
  let said = 0;
  pieces.forEach((p, i) => {
    const limit = i === 0 ? FIRST_MAX : Math.min(PIECE_MAX, Math.max(PIECE_MIN, Math.round(said * GROWTH)));
    const last = i === pieces.length - 1;
    expect(p.length).toBeLessThanOrEqual(limit + (last ? TAIL_MIN : 0));
    said += p.length;
  });
}

describe("piece 0 (launch audit 2026-10-03: 20..45 characters)", () => {
  test("a first sentence of 20-45 characters is the whole first piece", () => {
    const text = "Merhaba Ahmet, seni duymak çok güzel! Bugün nasıl geçti, anlatmak ister misin? Ben buradayım, seni dinliyorum.";
    const pieces = whole(text);
    expect(pieces[0]).toBe("Merhaba Ahmet, seni duymak çok güzel!");
    checkPieces(text, pieces);
  });

  test("a sentence of 20+ characters no longer takes the next one along", () => {
    const pieces = whole("Harika, buna çok sevindim! Bugün neler yaptın, anlatır mısın bana biraz?");
    expect(pieces[0]).toBe("Harika, buna çok sevindim!");
  });

  test("a shorter first sentence still takes the next one along", () => {
    const pieces = whole("Evet. Bence de öyle, bugün harika geçti. Akşam ne yapmayı düşünüyorsun, bir planın var mı?");
    expect(pieces[0]).toBe("Evet. Bence de öyle, bugün harika geçti.");
  });

  test("a long first sentence is cut after a clause mark within 45", () => {
    const text = "Bugün hava gerçekten güzel, dışarı çıkıp biraz yürüyüş yapman sana çok iyi gelecektir bence. Ne dersin?";
    const pieces = whole(text);
    expect(pieces[0]).toBe("Bugün hava gerçekten güzel,");
    checkPieces(text, pieces);
  });

  test("a clause mark before 20 characters is not used: the cut goes between words", () => {
    const text = "Tabii, hemen bakayım ama önce şunu söylemeliyim ki bu konudaki bilgilerim biraz eski olabilir.";
    const pieces = whole(text);
    expect(pieces[0]).toBe("Tabii, hemen bakayım ama önce şunu");
    expect(pieces[0].length).toBeLessThanOrEqual(FIRST_MAX);
    checkPieces(text, pieces);
  });

  test("with no mark at all it is cut at the last space within 45", () => {
    const text = "Bu çok uzun bir cümle ve hiç noktalama işareti yok ama yine de bir yerden bölünmesi gerekiyor çünkü ilk parça kısa olmalı";
    const pieces = whole(text);
    expect(pieces[0]).toBe("Bu çok uzun bir cümle ve hiç noktalama");
    checkPieces(text, pieces);
  });

  test("numbers, addresses and ordinals are never sentence ends", () => {
    const text = "Kahve 3.5 lira oldu, lunai.tr yazıyor. 16. yüzyıl gibi fiyatlar değil ama yine de pahalı.";
    const pieces = whole(text);
    expect(pieces[0]).toBe("Kahve 3.5 lira oldu, lunai.tr yazıyor.");
    checkPieces(text, pieces);
  });

  test("a short reply is one piece", () => {
    expect(whole("Tamam.")).toEqual(["Tamam."]);
    expect(whole("Evet. Hayır. Belki.")).toEqual(["Evet. Hayır. Belki."]);
    expect(whole("")).toEqual([]);
  });
});

describe("later pieces", () => {
  test("grow with what was said before (whole sentences while they fit)", () => {
    const text = "Merhaba Ahmet, seni duymak çok güzel! " +
      "Bugün nasıl geçti, anlatmak ister misin? Ben buradayım ve seni dinliyorum, acelemiz yok. " +
      "Bir de şunu sormak istiyorum: hafta sonu için bir planın var mı, yoksa evde dinlenmeyi mi düşünüyorsun? " +
      "Ben olsam biraz yürüyüş yapardım, sonra güzel bir kahve içerdim. Sen ne dersin, sana da iyi gelir mi?";
    const pieces = whole(text);
    checkPieces(text, pieces);
    expect(pieces).toEqual([
      "Merhaba Ahmet, seni duymak çok güzel!",
      "Bugün nasıl geçti, anlatmak ister misin? Ben buradayım ve seni dinliyorum, acelemiz yok.",
      "Bir de şunu sormak istiyorum: hafta sonu için bir planın var mı, yoksa evde dinlenmeyi mi düşünüyorsun?",
      "Ben olsam biraz yürüyüş yapardım, sonra güzel bir kahve içerdim. Sen ne dersin, sana da iyi gelir mi?",
    ]);
  });
});

describe("while the reply streams in", () => {
  test("piece 0 is cut before the reply is complete, once 20 characters follow it", () => {
    const text = "Bugün hava gerçekten çok güzel görünüyor ve bence dışarı çıkıp biraz yürüyüş yapman sana iyi gelir. Akşam da bana anlatırsın.";
    const { early, rest } = streamed(text);
    expect(early.length).toBeGreaterThan(0);
    expect(early[0].p).toBe("Bugün hava gerçekten çok güzel görünüyor ve");
    expect(early[0].at).toBe(early[0].p.length + 1 + TAIL_MIN);
    checkPieces(text, [...early.map((e) => e.p), ...rest]);
  });

  test("nothing lost however the text arrives", () => {
    const text = "Ah, bunu duymak beni gerçekten çok üzdü. Keşke yanında olabilseydim ve sana sarılabilseydim ama buradayım. Konuşmak istersen dinlerim, ne zaman istersen.";
    for (const step of [1, 3, 7, 23]) {
      const { early, rest } = streamed(text, step);
      checkPieces(text, [...early.map((e) => e.p), ...rest]);
    }
  });

  test("random replies: nothing lost, nothing tiny, piece 0 short (streamed and whole)", () => {
    const words = ["evet", "hayır", "bugün", "çok", "güzel", "bir", "gün", "seni", "dinliyorum", "anlatmak", "ister",
      "misin", "3.5", "lunai.tr", "vs.", "(bence)", "\"tamam\"", "—", "süper", "olur", "harika", "peki", "nasıl",
      "hissediyorsun", "merhaba", "biliyor", "musun", "16.", "yüzyıl"];
    const ends = [".", "!", "?", "…", "?!", ",", ";", ":", "", "", ""];
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let t = 0; t < 1500; t++) {
      const sentences = [];
      for (let k = 1 + rnd(6); k > 0; k--) {
        const w = [];
        for (let j = 1 + rnd(rnd(3) === 0 ? 30 : 8); j > 0; j--) w.push(words[rnd(words.length)]);
        sentences.push(w.join(" ") + ends[rnd(ends.length)]);
      }
      const text = sentences.join(" ");
      checkPieces(text, whole(text));
      const { early, rest } = streamed(text, 1 + rnd(9));
      checkPieces(text, [...early.map((e) => e.p), ...rest]);
    }
  });
});
