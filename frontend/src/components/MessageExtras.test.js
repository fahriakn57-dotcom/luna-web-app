/* global describe, test, expect, jest, beforeEach, afterEach, require */
// components/MessageExtras.jsx ActionCards — what Luna did in the account
// that turn (backend services/agent_tools.py): a reminder card with "Takvime
// ekle" (Google Calendar) and ".ics indir", and the other actions' cards. Run with:
//   CI=true npx craco test --watchAll=false src/components/MessageExtras
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ fetchMessageFile: jest.fn(), fetchReminderIcs: jest.fn(), setReplyLang: jest.fn() }));

const api = require("../lib/api");
const { ActionCards, ActionList } = require("./MessageExtras");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RID = "651f0c2b9d3e4a5b6c7d8e9f";
const GOOGLE = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Annemi%20ara"
  + "&dates=20261014T060000Z/20261014T061500Z&ctz=Europe%2FIstanbul";
const reminder = {
  type: "reminder_created", id: RID, summary: "Annemi ara · 14.10.2026 09:00 · her gün", text: "Annemi ara",
  due_at: "2026-10-14T06:00:00+00:00", timezone: "Europe/Istanbul", recurrence: "daily",
  calendar: { google_url: GOOGLE, ics_url: `/api/reminders/${RID}.ics` },
};

let host;
let root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  URL.createObjectURL = jest.fn(() => "blob:luna-ics");
  URL.revokeObjectURL = jest.fn();
  api.fetchReminderIcs.mockReset();
  api.setReplyLang.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (actions, lang = "tr") => {
  await act(async () => {
    root.render(<ActionCards actions={actions} lang={lang} />);
  });
};

describe("ActionCards", () => {
  test("a reminder: what, when (its own zone), how often, and both calendar buttons", async () => {
    await render([reminder]);
    const card = host.querySelector('[data-testid="chat-action-card"]');
    expect(card.getAttribute("data-action-type")).toBe("reminder_created");
    expect(card.textContent).toContain("Hatırlatıcı kuruldu");
    expect(card.textContent).toContain("Annemi ara");
    expect(host.querySelector('[data-testid="chat-action-when"]').textContent).toMatch(/09:00.*her gün/);
    const google = host.querySelector('[data-testid="chat-action-google-calendar"]');
    expect(google.getAttribute("href")).toBe(GOOGLE);
    expect(google.getAttribute("target")).toBe("_blank");
    expect(google.getAttribute("rel")).toContain("noopener");
    expect(google.textContent).toContain("Takvime ekle");
    expect(host.querySelector('[data-testid="chat-action-ics"]').textContent).toContain(".ics indir");
  });

  test(".ics indir fetches the file with the device's auth and saves it", async () => {
    api.fetchReminderIcs.mockResolvedValue(new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" }));
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render([reminder]);
    await act(async () => {
      host.querySelector('[data-testid="chat-action-ics"]').click();
    });
    expect(api.fetchReminderIcs).toHaveBeenCalledWith(RID);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  test("a failed download says so and can be tried again", async () => {
    api.fetchReminderIcs.mockRejectedValue(new Error("x"));
    await render([reminder], "en");
    await act(async () => {
      host.querySelector('[data-testid="chat-action-ics"]').click();
    });
    expect(host.querySelector('[role="alert"]').textContent).toContain("Couldn't download");
    expect(host.querySelector('[data-testid="chat-action-ics"]').disabled).toBe(false);
  });

  test("a link to anywhere but Google Calendar is never shown", async () => {
    await render([{ ...reminder, calendar: { google_url: "https://evil.example/", ics_url: "" } }]);
    expect(host.querySelector('[data-testid="chat-action-google-calendar"]')).toBeNull();
    expect(host.querySelector('[data-testid="chat-action-ics"]')).toBeNull();
  });

  test("the other actions in English, and nothing for junk", async () => {
    await render([
      { type: "note_created", id: "n1", summary: "Market listesi" },
      { type: "goal_completed", id: "g1", summary: "10 km koş" },
      { type: "memory_saved", id: "m1", summary: "Kızının adı Defne" },
      { type: "hack", summary: "x" },
    ], "en");
    const cards = [...host.querySelectorAll('[data-testid="chat-action-card"]')];
    expect(cards.map((c) => c.getAttribute("data-action-type"))).toEqual(["note_created", "goal_completed", "memory_saved"]);
    expect(host.textContent).toContain("Note saved");
    expect(host.textContent).toContain("Goal completed");
    expect(host.textContent).toContain("Saved to memory");
    expect(host.querySelector('[data-testid="chat-action-google-calendar"]')).toBeNull();
  });

  test("no actions, no box; ActionList is the same component", async () => {
    await render([]);
    expect(host.querySelector('[data-testid="chat-actions"]')).toBeNull();
    await render(undefined);
    expect(host.querySelector('[data-testid="chat-actions"]')).toBeNull();
    expect(ActionList).toBe(ActionCards);
  });

  test("a fresh reply-language change is adopted on this device", async () => {
    await render([{ type: "preference_set", id: "u9", summary: "reply language: Deutsch", language: "de",
      at: new Date().toISOString() }], "en");
    expect(api.setReplyLang).toHaveBeenCalledWith("de");
    expect(host.textContent).toContain("Preference updated");
  });
});
