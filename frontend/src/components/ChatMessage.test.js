/* global describe, test, expect, jest, beforeEach, afterEach, require */
// components/ChatMessage.jsx — Luna's reply as Markdown with its sources
// and the pictures / files made in chat; your own message stays plain. Run with:
//   CI=true npx craco test --watchAll=false src/components/ChatMessage
import { act } from "react";
import { createRoot } from "react-dom/client";

// The app's "@/" alias is webpack's (craco.config.js), not Jest's: the
// modules ChatMessage imports through it are registered here.
jest.mock("@/assets/luna-avatar.webp", () => "luna-avatar.webp", { virtual: true });
jest.mock("@/components/Markdown", () => jest.requireActual("./Markdown"), { virtual: true });
jest.mock("@/components/MessageExtras", () => jest.requireActual("./MessageExtras"), { virtual: true });
jest.mock("../lib/api", () => ({ fetchMessageFile: jest.fn() }));

const api = require("../lib/api");
const ChatMessage = require("./ChatMessage").default;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  URL.createObjectURL = jest.fn(() => "blob:luna-1");
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (msg) => {
  await act(async () => {
    root.render(<ChatMessage msg={msg} lang="tr" />);
  });
};

describe("ChatMessage", () => {
  test("what you typed stays plain text", async () => {
    await render({ id: "u1", role: "user", text: "**selam** [x](https://a.com)" });
    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("**selam** [x](https://a.com)");
  });

  test("Luna's reply: Markdown, the pages it used, a picture and a file made in chat", async () => {
    await render({
      id: "l1", role: "luna", text: "**Dolar** 41,2 TL ([aa.com.tr](https://aa.com.tr/x)).",
      sources: [{ title: "AA", url: "https://aa.com.tr/x", domain: "aa.com.tr" }],
      attachments: [
        { type: "image", messageId: "m1", mimeType: "image/png", name: "gorsel.png", sizeBytes: 3,
          dataUrl: "data:image/png;base64,AAAA", source: "chat_image" },
        { type: "file", messageId: "m2", mimeType: "application/pdf", name: "rapor.pdf", sizeBytes: 2048,
          dataUrl: "data:application/pdf;base64,BBBB", source: "chat_file" },
      ],
    });
    expect(host.querySelector("strong").textContent).toBe("Dolar");
    const chip = host.querySelector('[data-testid="chat-source-chip"]');
    expect(chip.textContent).toBe("aa.com.tr");
    expect(chip.getAttribute("href")).toBe("https://aa.com.tr/x");
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(host.querySelector('[data-testid="chat-attachment-image"] img').getAttribute("src")).toBe("data:image/png;base64,AAAA");
    const file = host.querySelector('[data-testid="chat-attachment-file"]');
    expect(file.tagName).toBe("A");
    expect(file.getAttribute("download")).toBe("rapor.pdf");
    expect(file.textContent).toContain("2 KB");
    expect(api.fetchMessageFile).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector('[data-testid="chat-attachment-image"]').click();
    });
    const lightbox = document.body.querySelector('[data-testid="chat-image-lightbox"]');
    expect(lightbox).not.toBeNull();
    expect(lightbox.querySelector('[data-testid="chat-image-download-button"]').getAttribute("download")).toBe("gorsel.png");
  });

  test("a big picture or file without inline bytes is fetched from the server with the device's auth", async () => {
    api.fetchMessageFile.mockResolvedValue(new Blob(["x"]));
    const click = jest.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render({
      id: "l2", role: "luna", text: "İşte dosyan 📎",
      attachments: [
        { type: "image", messageId: "m3", mimeType: "image/png", name: "buyuk.png", sizeBytes: 4000000, dataUrl: "" },
        { type: "file", messageId: "m4", mimeType: "application/pdf", name: "buyuk.pdf", sizeBytes: 5000000, dataUrl: "" },
      ],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.fetchMessageFile).toHaveBeenCalledWith("m3", expect.anything());
    expect(host.querySelector('[data-testid="chat-attachment-image"] img').getAttribute("src")).toBe("blob:luna-1");

    const fileButton = host.querySelector('[data-testid="chat-attachment-file"]');
    expect(fileButton.tagName).toBe("BUTTON");
    expect(fileButton.textContent).toContain("4,8 MB");
    await act(async () => {
      fileButton.click();
    });
    expect(api.fetchMessageFile).toHaveBeenCalledWith("m4");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  test("while the reply streams, its sources wait for the end", async () => {
    await render({
      id: "l3", role: "luna", text: "Yazı **devam", streaming: true,
      sources: [{ title: "AA", url: "https://aa.com.tr/x", domain: "aa.com.tr" }],
    });
    expect(host.querySelector('[data-testid="chat-sources"]')).toBeNull();
    expect(host.querySelector("strong").textContent).toBe("devam");
  });
});
