// What a typed message most likely asks Luna to MAKE, so the chat can say
// what she is doing while she does it: "bunu PDF yap", "yapay zeka hakkında
// bir sunum hazırla", "bir kedi çiz" are answered with the real file or
// picture (backend services/chat_actions.py) — a researched deck can take a
// minute or more, and three bouncing dots for that long read as stuck.
//
// Only a hint for the waiting bubble (pages/Luna.jsx -> FriendPanel's
// "Oluşturuluyor... 📄" / "Görsel çiziliyor... 🎨"): the server alone decides
// what the turn is, and a wrong guess shows for a moment at most — the
// reply's first streamed words replace it. Questions about a format ("PDF
// nedir?", "how do I open a pptx?") are not requests.

// Lowercase, accents and Turkish letters folded: "SUNUM HAZIRLA" ->
// "sunum hazirla", "Präsentation" -> "prasentation", "çiz" -> "ciz". Only
// Latin letters lose their marks — Cyrillic "й" stays "й".
export function fold(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/([a-z])\p{Mn}+/gu, "$1")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// A file format or kind of document, in Luna's languages.
const DOC_NOUN = new RegExp([
  "\\bpdf\\b", "\\bword\\b", "\\bdocx\\b", "\\bexcel\\b", "\\bxlsx\\b", "\\bpptx?\\b", "\\bpowerpoint\\b",
  "\\bsunum", "\\bslayt", "\\bslides?\\b", "\\bslide deck\\b", "\\bpresentation\\b", "\\bspreadsheet\\b",
  "\\bpresentacion\\b", "\\bprasentation\\b", "\\bpresentazione\\b", "презентац", "таблиц[ауы] excel",
].join("|"));

// Asking for it to be made ("hazırla", "yap", "make", "erstelle", ...).
const MAKE = new RegExp([
  "\\bhazirla", "\\bolustur", "\\buret", "\\byap(?!ay)", "\\bcikar", "\\bdonustur", "\\bcevir", "\\bdok\\b",
  "\\bmake\\b", "\\bcreate\\b", "\\bgenerate\\b", "\\bprepare\\b", "\\bbuild\\b", "\\bwrite\\b", "\\bturn (this|it|that)\\b",
  "\\bconvert\\b", "\\bexport\\b", "\\bput (this|it|that)\\b",
  "\\bhaz\\b", "\\bhazme\\b", "\\bcrea\\b", "\\bcrear\\b", "\\bgenera\\b", "\\bprepara\\b", "\\bconvierte\\b",
  "\\berstell", "\\bmach\\b", "\\bmache\\b", "\\bgeneriere\\b", "\\bschreib",
  "\\bfai\\b", "\\bfammi\\b", "\\bcreami\\b", "\\bpreparami\\b",
  "сделай", "создай", "подготов", "сгенерир", "составь",
].join("|"));

// Asking for a picture to be drawn — only in the languages the server draws
// in from chat: Turkish and English (services/chat_actions.py _DRAW_RES and
// _EN_DRAW_RES). "Zeichne einen Hund" or "Dibuja un gato" get the model's
// text answer, so promising a picture there would show "Drawing your
// image..." for a reply that has none.
const DRAW = new RegExp([
  "\\bciz\\b", "\\bcizer misin", "\\bcizsene\\b", "\\bcizin\\b", "\\bresmini (yap|ciz)", "\\bresim (yap|ciz|olustur)",
  "\\bgorsel(ini|i)? (olustur|uret|yap|hazirla|ciz)", "\\blogo (tasarla|yap|ciz|olustur)",
  "^(hey )?(luna )?(please )?((can|could|would|will) you )?(please )?(draw|paint|sketch|illustrate)( me| us)? (a|an|the|my|our|some|two|three|\\d+)\\b",
  "\\b(create|generate|make|design|produce|render|paint|draw)( me| us)? (a|an|one|some|\\d+)\\b( \\w+){0,4} "
    + "(image|picture|pic|drawing|illustration|painting|artwork|logo|poster|wallpaper|sticker|avatar|icon|banner|portrait|cartoon)s?\\b",
].join("|"));

// The server's guards (chat_actions._DRAW_IDIOMS / _EN_DRAW_NOT): a how-to,
// a chart or a diagram, a figurative "draw" or "çiz" — never a picture.
const NOT_A_PICTURE = new RegExp([
  "\\b(how|why|tips|tutorial|learn|teach|step by step|ideas?)\\b",
  "\\b(charts?|graphs?|diagrams?|flowcharts?|plots?|table|spreadsheets?|code|svg|ascii|html)\\b",
  "\\b(conclusions?|line|lines|attention|parallels?|comparisons?|distinction|breath|blood|lots|straws?|curtains?|inspiration)\\b",
  "\\b(grafik\\w*|cizelge\\w*|diyagram\\w*|sema|semasi\\w*|semayi|tablo\\w*|altini|ustunu|sinir\\w*|yol harita\\w*|"
    + "strateji\\w*|plan|plani\\w*|rota|rotasi\\w*|cerceve\\w*)\\b",
  "\\b(nasil|fikir\\w*|oneri\\w*|tavsiye\\w*)\\b",
].join("|"));

// "PDF nedir?", "what is a pptx?" — about the format, not asking for one.
const ABOUT = /\b(nedir|ne demek|nasil (acilir|yapilir|olusturulur)|what is|what's|how (do|can) i|how to)\b/;

// A reminder asked for in the same words ("remind me tomorrow to make a
// presentation", "yarın sunum hazırlamayı hatırlat") is a reminder Luna
// sets, never a file or a picture (the server's chat_actions._REMINDER_ASK);
// the nouns "hatırlatma (kartı)" / "hatırlatıcı" are no such request.
const REMINDER = new RegExp([
  "\\bhatirlat(?!ma\\b|ici)", "\\bremind (me|us)\\b", "\\b(set|add|create|make) (a |an )?(reminder|alarm)\\b",
  "\\berinner\\w* (mich|uns)\\b", "\\brecuerd[ae](me|nos)\\b", "\\bricorda(mi|ci)\\b", "напомн",
].join("|"));

// "doc" | "image" | null. features (GET /api/features, lib/features.js):
// a hint only for what the server can make right now.
export function pendingKind(text, features = {}) {
  const s = fold(text);
  if (!s || s.length > 2000) return null;
  if (ABOUT.test(s) || REMINDER.test(s)) return null;
  if (features.chat_images && DRAW.test(s) && !NOT_A_PICTURE.test(s)) return "image";
  // ("a 500-word essay" is no Word file)
  const doc = s.replace(/\d+\s*-?\s*words?\b/g, " ");
  if (features.chat_files && DOC_NOUN.test(doc) && MAKE.test(doc)) return "doc";
  return null;
}
