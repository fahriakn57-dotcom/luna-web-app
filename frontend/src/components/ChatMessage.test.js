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
jest.mock("../lib/api", () => ({ fetchMessageFile: jest.fn(), fetchReminderIcs: jest.fn(), setReplyLang: jest.fn() }));

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

const render = async (msg, lang = "tr") => {
  await act(async () => {
    root.render(<ChatMessage msg={msg} lang={lang} />);
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

  test("a German or Spanish screen reads English labels, never Turkish ones (global launch)", async () => {
    const msg = {
      id: "l4", role: "luna", text: "Hallo!",
      sources: [{ title: "DW", url: "https://dw.com/x", domain: "dw.com" }],
      attachments: [{ type: "file", messageId: "m5", mimeType: "application/pdf", name: "bericht.pdf", sizeBytes: 1536,
        dataUrl: "data:application/pdf;base64,BBBB", source: "chat_file" }],
    };
    for (const lang of ["de", "es", "en"]) {
      await render(msg, lang);
      expect(host.querySelector('[data-testid="chat-sources"]').textContent).toContain("Sources");
      expect(host.querySelector('[data-testid="chat-attachment-file"]').getAttribute("aria-label")).toBe("Download: bericht.pdf");
      expect(host.querySelector('[data-testid="chat-attachment-file"]').textContent).toContain("2 KB");
    }
    await render(msg, "tr");
    expect(host.querySelector('[data-testid="chat-sources"]').textContent).toContain("Kaynaklar");
    expect(host.querySelector('[data-testid="chat-attachment-file"]').getAttribute("aria-label")).toBe("İndir: bericht.pdf");
  });

  test("a document asked for straight away in chat shows as a download card under the reply", async () => {
    await render({
      id: "l5", role: "luna", text: "Sunumun hazır 📎",
      attachments: [{ type: "file", messageId: "m6", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        name: "Yenilenebilir Enerji.pptx", sizeBytes: 2 * 1024 * 1024, dataUrl: "", source: "chat_deck" }],
    });
    const card = host.querySelector('[data-testid="chat-attachment-file"]');
    expect(card.tagName).toBe("BUTTON");
    expect(card.textContent).toContain("Yenilenebilir Enerji.pptx");
    expect(card.textContent).toContain("2,0 MB");
  });

  test("what Luna did in the account shows as cards under the reply: a reminder with its calendar links", async () => {
    const rid = "65f0a1b2c3d4e5f6a7b8c9d0";
    const msg = {
      id: "l6", role: "luna", text: "Tamam, yarın 09:00'da hatırlatacağım.",
      actions: [
        { type: "reminder_created", id: rid, summary: "Yarın 09:00 — Annemi ara", text: "Annemi ara",
          due_at: "2026-10-14T06:00:00Z", timezone: "Europe/Istanbul", recurrence: "none",
          calendar: { google_url: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Annemi+ara",
            ics_url: `/api/reminders/${rid}.ics` } },
        { type: "note_created", id: "n1", summary: "Market listesi" },
      ],
    };
    await render(msg);
    const cards = host.querySelectorAll('[data-testid="chat-action-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("Annemi ara");
    expect(cards[0].textContent).toContain("Hatırlatıcı kuruldu");
    const google = host.querySelector('[data-testid="chat-action-google-calendar"]');
    expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    expect(google.getAttribute("target")).toBe("_blank");
    expect(host.querySelector('[data-testid="chat-action-ics"]')).not.toBeNull();
    expect(cards[1].textContent).toContain("Market listesi");

    // an English screen (and a German one) reads English card labels
    await render(msg, "de");
    expect(host.querySelector('[data-testid="chat-action-card"]').textContent).toContain("Reminder set");
    expect(host.querySelector('[data-testid="chat-action-google-calendar"]').textContent).toContain("Add to calendar");
  });

  test("no cards while the reply still streams, nor for a reply without actions", async () => {
    await render({ id: "l7", role: "luna", text: "Yazıyor", streaming: true,
      actions: [{ type: "note_created", id: "n2", summary: "Not" }] });
    expect(host.querySelector('[data-testid="chat-actions"]')).toBeNull();
    await render({ id: "l8", role: "luna", text: "Selam" });
    expect(host.querySelector('[data-testid="chat-actions"]')).toBeNull();
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
