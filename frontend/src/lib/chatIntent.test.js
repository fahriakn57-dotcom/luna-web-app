/* global describe, test, expect */
// lib/chatIntent.js — the waiting bubble's hint while a typed turn makes a
// file or a picture in chat. Run with:
//   CI=true npx craco test --watchAll=false src/lib/chatIntent
import { fold, pendingKind } from "./chatIntent";

const ON = { chat_files: true, chat_images: true };

describe("fold", () => {
  test("lowercase, Turkish letters and accents folded; Cyrillic kept", () => {
    expect(fold("SUNUM HAZIRLA")).toBe("sunum hazirla");
    expect(fold("Bir kedi ÇİZ")).toBe("bir kedi ciz");
    expect(fold("Erstelle eine Präsentation")).toBe("erstelle eine prasentation");
    expect(fold("Сделай презентацию")).toBe("сделай презентацию");
    expect(fold("  çok   boşluk  ")).toBe("cok bosluk");
  });
});

describe("pendingKind", () => {
  test.each([
    "Yapay zeka hakkında bir PDF rapor hazırla",
    "bunu PDF yap",
    "Bunu Word'e çevir",
    "Aylık bütçem için bir Excel tablosu oluştur",
    "Yenilenebilir enerji hakkında bir sunum hazırla",
    "10 slaytlık bir sunum yapar mısın",
    "Make a PDF report on the history of AI",
    "Create a presentation about climate change",
    "convert this to an excel spreadsheet",
    "Erstelle eine Präsentation über Berlin",
    "Crea una presentación sobre el café",
    "Prepara una presentazione sulla pizza",
    "Сделай презентацию про космос",
  ])("a document: %s", (text) => {
    expect(pendingKind(text, ON)).toBe("doc");
  });

  test.each([
    "bir kedi çiz",
    "Bana mor bir logo tasarla",
    "Draw a cat in space",
    "draw me a cat",
    "Can you draw a cat for me?",
    "Could you paint a sunset over Istanbul?",
    "generate an image of a sunset",
    "create an image of a dog",
    "make a logo for my bakery",
    "design a logo for my coffee shop",
  ])("a picture: %s", (text) => {
    expect(pendingKind(text, ON)).toBe("image");
  });

  // The server draws from chat in Turkish and English only
  // (services/chat_actions.py): elsewhere the model answers in text, so
  // the waiting bubble must not promise a picture.
  test.each([
    "Zeichne einen Hund",
    "Dibuja un gato",
    "Disegna un gatto",
    "Нарисуй кота",
    "how to draw a cat",
    "draw a conclusion",
    "Draw the line somewhere",
    "draw a chart of sales",
    "Bu cümlenin altını çiz",
    "kendime bir sınır çiz",
  ])("no picture promised: %s", (text) => {
    expect(pendingKind(text, ON)).toBeNull();
  });

  test.each([
    "PDF nedir?",
    "What is a pptx file?",
    "How do I make a PDF in Word?",
    "Write me a 500-word essay about friendship",
    "Bugün çok yoruldum",
    "Yapay zeka hakkında ne düşünüyorsun?",
    "word oyunu oynayalım mı",
    "",
  ])("nothing to make: %s", (text) => {
    expect(pendingKind(text, ON)).toBeNull();
  });

  test("only what the server can make right now (GET /api/features)", () => {
    expect(pendingKind("bunu PDF yap", {})).toBeNull();
    expect(pendingKind("bunu PDF yap", { chat_files: true })).toBe("doc");
    expect(pendingKind("bir kedi çiz", { chat_files: true })).toBeNull();
    expect(pendingKind("bir kedi çiz", { chat_images: true })).toBe("image");
    expect(pendingKind("bir kedi çiz")).toBeNull();
  });

  test.each([
    "remind me tomorrow at 9 to make a presentation",
    "Remind me to write the PDF report on Friday",
    "yarın saat 9'da sunum hazırlamayı hatırlat",
    "set a reminder to draw a cat for my daughter",
    "Erinnere mich morgen, eine Präsentation zu erstellen",
    "Напомни мне завтра сделать презентацию",
  ])("a reminder is no file or picture: %s", (text) => {
    expect(pendingKind(text, ON)).toBeNull();
  });

  test("the noun 'hatırlatma kartı' is still a picture request", () => {
    expect(pendingKind("bana bir hatırlatma kartı çiz", ON)).toBe("image");
  });

  test("a very long paste is not a command", () => {
    expect(pendingKind(`${"metin ".repeat(400)} bunu PDF yap`, ON)).toBeNull();
  });
});
