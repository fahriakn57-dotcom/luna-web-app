/* global describe, test, expect */
// lib/markdown.js — run with:  CI=true npx craco test --watchAll=false src/lib/markdown
import { parseInline, parseMarkdown } from "./markdown";

const text = (t) => ({ type: "text", text: t });
const strong = (...children) => ({ type: "strong", children });
const para = (...children) => ({ type: "paragraph", children });

// Every text node of a parsed reply (what the user reads as text, outside
// code), joined — to check that no raw syntax shows.
function visibleText(blocks) {
  let out = "";
  const inline = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === "text") out += n.text;
      else if (n.children) inline(n.children);
    }
  };
  const walk = (list) => {
    for (const b of list || []) {
      if (b.type === "paragraph" || b.type === "heading") inline(b.children);
      else if (b.type === "list") b.items.forEach((it) => walk(it.children));
      else if (b.type === "blockquote") walk(b.children);
      else if (b.type === "table") {
        b.header.forEach(inline);
        b.rows.forEach((row) => row.forEach(inline));
      }
      out += "\n";
    }
  };
  walk(blocks);
  return out;
}

describe("parseInline", () => {
  test("bold, italic, both, strike and inline code", () => {
    expect(parseInline("**kalın** ve *eğik* ve ***ikisi*** ~~yok~~ `kod`")).toEqual([
      strong(text("kalın")), text(" ve "),
      { type: "em", children: [text("eğik")] }, text(" ve "),
      strong({ type: "em", children: [text("ikisi")] }), text(" "),
      { type: "del", children: [text("yok")] }, text(" "),
      { type: "code", text: "kod" },
    ]);
  });

  test("arithmetic, snake_case and C++ stay as written", () => {
    const s = "5 * 3 = 15, 2**10, snake_case_name, C++ ve a*b";
    expect(parseInline(s)).toEqual([text(s)]);
  });

  test("a Turkish suffix right after bold", () => {
    expect(parseInline("**Ankara**'da")).toEqual([strong(text("Ankara")), text("'da")]);
  });

  test("a link opens its address without the tracking parameters", () => {
    expect(parseInline("[Hürriyet](https://www.hurriyet.com.tr/a?utm_source=openai)")).toEqual([
      { type: "link", href: "https://www.hurriyet.com.tr/a", children: [text("Hürriyet")] },
    ]);
  });

  test("an inline citation becomes a link inside its parentheses", () => {
    expect(parseInline("Hava güneşli ([mgm.gov.tr](https://www.mgm.gov.tr/tahmin?utm_source=openai)).")).toEqual([
      text("Hava güneşli ("),
      { type: "link", href: "https://www.mgm.gov.tr/tahmin", children: [text("mgm.gov.tr")] },
      text(")."),
    ]);
  });

  test("a javascript: or relative link is never a link — its text stays", () => {
    expect(parseInline("[tıkla](javascript:alert(1))")).toEqual([text("tıkla")]);
    expect(parseInline("[buraya](/api/account)")).toEqual([text("buraya")]);
  });

  test("bare URLs are links; the sentence's punctuation and an unopened ) are not part of them", () => {
    expect(parseInline("Bak: https://example.com/a_b?utm_source=openai.")).toEqual([
      text("Bak: "),
      { type: "link", href: "https://example.com/a_b", auto: true, children: [text("https://example.com/a_b")] },
      text("."),
    ]);
    expect(parseInline("(https://tr.wikipedia.org/wiki/Ankara_(il))")).toEqual([
      text("("),
      { type: "link", href: "https://tr.wikipedia.org/wiki/Ankara_(il)", auto: true,
        children: [text("https://tr.wikipedia.org/wiki/Ankara_(il)")] },
      text(")"),
    ]);
  });

  test("a link's own text never holds another link", () => {
    expect(parseInline("[https://a.com](https://a.com/x)")).toEqual([
      { type: "link", href: "https://a.com/x", children: [text("https://a.com")] },
    ]);
  });

  test("raw HTML stays text; <br> is a line break; escapes are literal", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([text('<img src=x onerror="alert(1)">')]);
    expect(parseInline("a<br>b")).toEqual([text("a"), { type: "br" }, text("b")]);
    expect(parseInline("\\*değil\\*")).toEqual([text("*değil*")]);
  });

  test("a newline is a line break", () => {
    expect(parseInline("bir\niki")).toEqual([text("bir"), { type: "br" }, text("iki")]);
  });

  describe("while the reply streams (tail)", () => {
    test("an unclosed bold runs to the end instead of showing **", () => {
      expect(parseInline("Bu **önem", true)).toEqual([text("Bu "), strong(text("önem"))]);
      expect(parseInline("Bu **önem*", true)).toEqual([text("Bu "), strong(text("önem"))]);
      expect(parseInline("Bu **", true)).toEqual([text("Bu ")]);
    });

    test("...but a finished reply shows an unclosed ** as written", () => {
      expect(parseInline("Bu **önem")).toEqual([text("Bu **önem")]);
    });

    test("a half-written link shows its text, not the half address", () => {
      expect(parseInline("Kaynak: [mgm.gov.tr](https://www.mg", true)).toEqual([text("Kaynak: "), text("mgm.gov.tr")]);
    });

    test("an unclosed code span runs to the end", () => {
      expect(parseInline("çalıştır: `npm i", true)).toEqual([text("çalıştır: "), { type: "code", text: "npm i" }]);
    });
  });
});

describe("parseMarkdown", () => {
  test("headings, paragraphs with line breaks, a rule", () => {
    expect(parseMarkdown("# Başlık\nMetin bir\nsatır iki\n\n---\n## Alt ##\n#etiket")).toEqual([
      { type: "heading", level: 1, children: [text("Başlık")] },
      para(text("Metin bir"), { type: "br" }, text("satır iki")),
      { type: "hr" },
      { type: "heading", level: 2, children: [text("Alt")] },
      para(text("#etiket")),
    ]);
  });

  test("a plain friendly reply stays one paragraph", () => {
    expect(parseMarkdown("Merhaba! 🌙\nBugün nasılsın?")).toEqual([
      para(text("Merhaba! 🌙"), { type: "br" }, text("Bugün nasılsın?")),
    ]);
  });

  test("fenced code keeps its text as is", () => {
    expect(parseMarkdown("```python\nprint('**x**')\n\n  y = 1\n```\nsonra")).toEqual([
      { type: "code", lang: "python", text: "print('**x**')\n\n  y = 1", open: false },
      para(text("sonra")),
    ]);
  });

  test("a code block still being written is already a code block", () => {
    expect(parseMarkdown("Kod:\n```js\nconst a = 1;", { streaming: true })).toEqual([
      para(text("Kod:")),
      { type: "code", lang: "js", text: "const a = 1;", open: true },
    ]);
  });

  test("ordered and nested lists, right after a paragraph", () => {
    expect(parseMarkdown("Adımlar:\n1. Kur\n2. **Çalıştır**\n   - alt madde\n3. Bitir")).toEqual([
      para(text("Adımlar:")),
      {
        type: "list", ordered: true, start: 1, items: [
          { checked: null, children: [para(text("Kur"))] },
          { checked: null, children: [
            para(strong(text("Çalıştır"))),
            { type: "list", ordered: false, start: null, items: [{ checked: null, children: [para(text("alt madde"))] }] },
          ] },
          { checked: null, children: [para(text("Bitir"))] },
        ],
      },
    ]);
  });

  test("an ordered list keeps its first number; '16. yüzyılda' inside a paragraph stays text", () => {
    expect(parseMarkdown("3. üç\n4. dört")[0]).toEqual(expect.objectContaining({ type: "list", ordered: true, start: 3 }));
    expect(parseMarkdown("Osmanlı\n16. yüzyılda güçlendi.")).toEqual([
      para(text("Osmanlı"), { type: "br" }, text("16. yüzyılda güçlendi.")),
    ]);
  });

  test("task items", () => {
    const [list] = parseMarkdown("- [x] bitti\n- [ ] yapılacak");
    expect(list.items.map((it) => it.checked)).toEqual([true, false]);
    expect(list.items[1].children).toEqual([para(text("yapılacak"))]);
  });

  test("a table with alignment, inline marks and a short row", () => {
    expect(parseMarkdown("| Ölçüt | A | B |\n|:---|:---:|---:|\n| Hız | **yüksek** | düşük |\n| Fiyat | 10 |")).toEqual([{
      type: "table",
      align: ["left", "center", "right"],
      header: [[text("Ölçüt")], [text("A")], [text("B")]],
      rows: [
        [[text("Hız")], [strong(text("yüksek"))], [text("düşük")]],
        [[text("Fiyat")], [text("10")], []],
      ],
    }]);
  });

  test("a table right after a paragraph; an escaped pipe inside code stays in its cell", () => {
    const blocks = parseMarkdown("Karşılaştırma:\n| Komut | Not |\n|---|---|\n| `a \\| b` | x |");
    expect(blocks[0]).toEqual(para(text("Karşılaştırma:")));
    expect(blocks[1].rows[0][0]).toEqual([{ type: "code", text: "a | b" }]);
    expect(blocks[1].rows[0][1]).toEqual([text("x")]);
  });

  test("a line with a pipe over a plain --- is not a table", () => {
    expect(parseMarkdown("a | b\n---").map((b) => b.type)).toEqual(["paragraph", "hr"]);
  });

  test("block quotes", () => {
    expect(parseMarkdown("> alıntı\n> devam")).toEqual([
      { type: "blockquote", children: [para(text("alıntı"), { type: "br" }, text("devam"))] },
    ]);
  });

  test("streaming: every prefix of a reply parses, never shows raw ** or ```, and ends as the final reply", () => {
    const reply = [
      "## Karşılaştırma",
      "",
      "**Python** ve *JavaScript* için kısa bir tablo:",
      "",
      "| Ölçüt | Python | JavaScript |",
      "|---|:---:|---:|",
      "| Hız | orta | **yüksek** |",
      "| Öğrenme | kolay | orta |",
      "",
      "1. Kur: `pip install x`",
      "2. Çalıştır:",
      "   ```bash",
      "   python app.py",
      "   ```",
      "",
      "Kaynak: ([python.org](https://www.python.org/?utm_source=openai))",
    ].join("\n");
    for (let n = 0; n <= reply.length; n++) {
      const shown = visibleText(parseMarkdown(reply.slice(0, n), { streaming: true }));
      expect(shown).not.toMatch(/\*\*|```|utm_source/);
    }
    expect(parseMarkdown(reply, { streaming: true })).toEqual(parseMarkdown(reply));
  });

  test("a very long reply still renders (the rest as plain text)", () => {
    const blocks = parseMarkdown(`${"a ".repeat(31000)}**son**`);
    expect(blocks.length).toBeGreaterThan(0);
    expect(visibleText(blocks)).toContain("**son**");
  });
});
