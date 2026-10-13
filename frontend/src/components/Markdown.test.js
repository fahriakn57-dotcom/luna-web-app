/* global describe, test, expect, jest, beforeEach, afterEach */
// components/Markdown.jsx — Luna's reply rendered safely. Run with:
//   CI=true npx craco test --watchAll=false src/components/Markdown
import { act } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "./Markdown";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (props) => {
  await act(async () => {
    root.render(<Markdown {...props} />);
  });
};

describe("Markdown", () => {
  test("headings, lists, a table that scrolls sideways, links that open in a new tab", async () => {
    await render({
      text: "## Başlık\n\n- bir\n- **iki**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[Site](https://a.com/x?utm_source=openai) ve https://b.com",
    });
    expect(host.querySelector("h4").textContent).toBe("Başlık");
    expect(host.querySelectorAll("ul > li")).toHaveLength(2);
    expect(host.querySelector("li strong").textContent).toBe("iki");
    const table = host.querySelector('[data-testid="md-table"]');
    expect(table.className).toContain("overflow-x-auto");
    expect(table.querySelectorAll("th")).toHaveLength(2);
    expect(table.querySelectorAll("td")).toHaveLength(2);
    const links = host.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://a.com/x");
    expect(links[0].textContent).toBe("Site");
    expect(links[1].getAttribute("href")).toBe("https://b.com");
    links.forEach((a) => {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    });
  });

  test("nothing in a reply becomes HTML or a script link", async () => {
    window.__pwned = undefined;
    await render({ text: '<img src=x onerror="window.__pwned=1"> [x](javascript:alert(1))' });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    expect(window.__pwned).toBeUndefined();
  });

  test("a code block scrolls sideways and copies its code", async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    await render({ text: "```js\nconst a = 1;\n```" });
    expect(host.querySelector("pre").className).toContain("overflow-x-auto");
    expect(host.querySelector("pre code").textContent).toBe("const a = 1;");
    const button = host.querySelector('[data-testid="md-copy-button"]');
    expect(button.textContent).toContain("Kopyala");
    await act(async () => {
      button.click();
    });
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
    expect(button.textContent).toContain("Kopyalandı");
  });

  test("a streaming reply renders as it grows, never showing raw **", async () => {
    await render({ text: "Bu **önem", streaming: true });
    expect(host.querySelector("strong").textContent).toBe("önem");
    expect(host.textContent).not.toContain("**");
    await render({ text: "Bu **önemli** bir", streaming: false });
    expect(host.querySelector("strong").textContent).toBe("önemli");
    expect(host.textContent).toBe("Bu önemli bir");
  });
});
