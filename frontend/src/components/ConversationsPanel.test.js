/* global test, expect, jest, beforeEach, afterEach, require */
// components/ConversationsPanel.jsx — the "Sohbetlerim" drawer: chats grouped
// by day with pinned ones on top and a preview line, search, pin, rename
// (saved once), delete only after the confirm, Escape closes. Run with:
//   CI=true npx craco test --watchAll=false src/components/ConversationsPanel
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockApi = {
  fetchConversations: jest.fn(),
  createConversation: jest.fn(),
  deleteConversation: jest.fn(),
  updateConversation: jest.fn(),
};
jest.mock("@/lib/api", () => mockApi, { virtual: true });
jest.mock("@/lib/conversationGroups", () => jest.requireActual("../lib/conversationGroups"), { virtual: true });
jest.mock("@/components/icons/LunaIcon", () => ({ IconTile: () => null, LunaIcon: () => null }), { virtual: true });
jest.mock("@/components/panel/Panel", () => jest.requireActual("./panel/Panel"), { virtual: true });
jest.mock("@/components/ConfirmDialog", () => jest.requireActual("./ConfirmDialog"), { virtual: true });
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const ConversationsPanel = require("./ConversationsPanel").default;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const LIST = () => [
  { id: "c1", title: "Tatil planı", preview: "Antalya için otel önerdim", last_sender: "assistant", updated_at: iso(5), pinned: false },
  { id: "c2", title: "Spor programı", preview: "haftada kaç gün?", last_sender: "user", updated_at: iso(60 * 24 * 40), pinned: true },
  { id: "c3", title: null, preview: "", updated_at: iso(60 * 24 * 3), pinned: false },
];

let host;
let root;
let props;
beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchConversations.mockResolvedValue(LIST());
  mockApi.updateConversation.mockResolvedValue({ ok: true });
  mockApi.deleteConversation.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = { lang: "tr", mode: "friend", activeConversationId: "c1", onSelect: jest.fn(), onClose: jest.fn() };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => { root.render(<ConversationsPanel {...props} />); });
}
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const groupLabels = () => $$("[data-testid='conversations-list'] section h3").map((h) => h.textContent);
const rowTitles = () => $$("[data-testid='conversation-item']").map((b) => b.querySelector("p").textContent);
const menuOf = (i) => $$("[data-testid='conversation-menu-button']")[i];

test("pinned chats come first, then by day; each row shows a preview line", async () => {
  await render();
  expect(groupLabels()).toEqual(["Sabitlenenler", "Bugün", "Son 7 gün"]);
  expect(rowTitles()).toEqual(["Spor programı", "Tatil planı", "Yeni sohbet"]);
  const previews = $$("[data-testid='conversation-preview']").map((p) => p.textContent);
  expect(previews[0]).toBe("Sen: haftada kaç gün?");
  expect(previews[1]).toBe("Antalya için otel önerdim");
  expect(previews[2]).toBe("Henüz mesaj yok");
  expect($("[data-testid='conversations-count']").textContent).toBe("3 sohbet");
  expect($$("[data-testid='conversation-item']")[1].getAttribute("aria-current")).toBe("true");
});

test("search filters by title or preview, ignoring Turkish letters", async () => {
  await render();
  type($("[data-testid='conversations-search']"), "otel");
  expect(rowTitles()).toEqual(["Tatil planı"]);
  type($("[data-testid='conversations-search']"), "spor programi");
  expect(rowTitles()).toEqual(["Spor programı"]);
  type($("[data-testid='conversations-search']"), "bulunmaz");
  expect($("[data-testid='conversations-no-results']")).not.toBeNull();
});

test("picking a chat selects it and closes the drawer", async () => {
  await render();
  click($$("[data-testid='conversation-item']")[1]);
  expect(props.onSelect).toHaveBeenCalledWith("c1");
  expect(props.onClose).toHaveBeenCalled();
});

test("pin moves a chat into Sabitlenenler and saves it", async () => {
  await render();
  click(menuOf(1)); // Tatil planı
  click($("[data-testid='conversation-pin-button']"));
  expect(mockApi.updateConversation).toHaveBeenCalledWith("c1", { pinned: true });
  expect(groupLabels()[0]).toBe("Sabitlenenler");
  expect(rowTitles().slice(0, 2).sort()).toEqual(["Spor programı", "Tatil planı"]);
});

test("rename saves once (Enter then blur) with the trimmed title", async () => {
  await render();
  click(menuOf(1));
  click($("[data-testid='conversation-rename-button']"));
  const input = $("[data-testid='conversation-rename-input']");
  expect(input.value).toBe("Tatil planı");
  type(input, "  Antalya   tatili ");
  await act(async () => { input.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(mockApi.updateConversation).toHaveBeenCalledTimes(1);
  expect(mockApi.updateConversation).toHaveBeenCalledWith("c1", { title: "Antalya tatili" });
  expect(rowTitles()).toContain("Antalya tatili");
});

test("delete asks first; confirming deletes and clears the active chat", async () => {
  await render();
  click(menuOf(1));
  click($("[data-testid='conversation-delete-button']"));
  expect(mockApi.deleteConversation).not.toHaveBeenCalled();
  expect($("[data-testid='confirm-dialog']").textContent).toContain("Tatil planı");
  await act(async () => { $("[data-testid='confirm-dialog-confirm']").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(mockApi.deleteConversation).toHaveBeenCalledWith("c1");
  expect(props.onSelect).toHaveBeenCalledWith(null);
  expect(rowTitles()).not.toContain("Tatil planı");
  expect($("[data-testid='confirm-dialog']")).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
});

test("Escape closes an open menu first, then the drawer", async () => {
  await render();
  click(menuOf(0));
  expect($("[role='menu']")).not.toBeNull();
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect($("[role='menu']")).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(props.onClose).toHaveBeenCalled();
});

test("an empty list shows the empty state; a failed load offers a retry", async () => {
  mockApi.fetchConversations.mockResolvedValueOnce([]);
  await render();
  expect($("[data-testid='conversations-empty']")).not.toBeNull();
  expect($("[data-testid='conversations-search']")).toBeNull();
  act(() => root.unmount());
  root = createRoot(host);
  mockApi.fetchConversations.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(host.textContent).toContain("Sohbetler yüklenemedi.");
});
