/* global describe, test, expect */
// lib/spokenText.js — what the voice call says and captions. Run with:
//   CI=true npx craco test --watchAll=false src/lib/spokenText
import { toSpoken } from "./spokenText";

describe("toSpoken", () => {
  test("a searched reply's inline citation is never read aloud", () => {
    expect(toSpoken("Bugün İstanbul'da hava 18 derece ([mgm.gov.tr](https://www.mgm.gov.tr/?utm_source=openai)).")).toBe(
      "Bugün İstanbul'da hava 18 derece.");
    expect(toSpoken("Maç 2-1 bitti ([a](https://a.com), [b](https://b.com)) diye yazıyor.")).toBe("Maç 2-1 bitti diye yazıyor.");
  });

  test("plain-text citations in parentheses go too", () => {
    expect(toSpoken("Dolar 41,2 lira (bloomberght.com, aa.com.tr) civarında.")).toBe("Dolar 41,2 lira civarında.");
    expect(toSpoken("Hava güneşli (mgm.gov.tr).")).toBe("Hava güneşli.");
  });

  test("a link keeps its words, unless they are just an address", () => {
    expect(toSpoken("Detaylar [Meteoroloji sayfasında](https://mgm.gov.tr) var.")).toBe("Detaylar Meteoroloji sayfasında var.");
    expect(toSpoken("Kaynak: [aa.com.tr](https://aa.com.tr/x) haberi.")).toBe("Kaynak: haberi.");
  });

  test("bare URLs, URLs in parentheses and www addresses go", () => {
    expect(toSpoken("Şuraya bak: https://lunai.tr/app?utm_source=openai lütfen")).toBe("Şuraya bak: lütfen");
    expect(toSpoken("Bilgi burada (https://x.com/a).")).toBe("Bilgi burada.");
    expect(toSpoken("www.lunai.tr adresinden gir.")).toBe("adresinden gir.");
  });

  test("a link still being written at the end is not read out half-way", () => {
    expect(toSpoken("Hava güzel ([mgm.gov.tr](https://www.mg")).toBe("Hava güzel");
  });

  test("names that only look like domains stay", () => {
    const s = "Vue (Node.js) ve ASP.NET ile 3.5 kat hızlı; snake_case ve 5*3 aynen.";
    expect(toSpoken(s)).toBe(s);
  });

  test("markdown syntax still goes (unchanged)", () => {
    expect(toSpoken("## Başlık\n- **bir**\n- iki")).toBe("Başlık bir iki");
    expect(toSpoken("Önce `npm i` yaz.\n```bash\nnpm i\n```")).toBe("Önce npm i yaz.");
  });
});
