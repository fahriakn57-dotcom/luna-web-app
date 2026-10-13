/* global describe, test, expect, jest, afterEach */
// lib/agentActions.js — what Luna's agent tools did in a turn (backend
// services/agent_tools.py), cleaned for the reply's action cards, and what a
// fresh one changes on this device. Run with:
//   CI=true npx craco test --watchAll=false src/lib/agentActions
import { applyActions, formatDue, isFresh, normalizeActions, FRESH_MS } from "./agentActions";

const RID = "651f0c2b9d3e4a5b6c7d8e9f";
const reminder = (over = {}) => ({
  type: "reminder_created", id: RID, summary: "Annemi ara · 14.10.2026 09:00",
  text: "Annemi ara", due_at: "2026-10-14T06:00:00+00:00", timezone: "Europe/Istanbul", recurrence: "daily",
  at: new Date().toISOString(),
  calendar: {
    google_url: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Annemi%20ara&dates=20261014T060000Z/20261014T061500Z",
    ics_url: `/api/reminders/${RID}.ics`,
  },
  ...over,
});

afterEach(() => jest.restoreAllMocks());

describe("normalizeActions", () => {
  test("a reminder: its text, time, zone, repeat and both calendar links", () => {
    const [a] = normalizeActions([reminder()]);
    expect(a).toMatchObject({
      type: "reminder_created", id: RID, text: "Annemi ara", dueAt: "2026-10-14T06:00:00.000Z",
      timezone: "Europe/Istanbul", recurrence: "daily", icsId: RID,
    });
    expect(a.googleUrl.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
  });

  test("only Google Calendar's own page is ever linked, and the .ics only for a real id", () => {
    const [a] = normalizeActions([reminder({ calendar: { google_url: "https://evil.example/x", ics_url: "/x.ics" } })]);
    expect(a.googleUrl).toBe("");
    expect(a.icsId).toBe(RID);
    const [b] = normalizeActions([reminder({ id: "not-an-id" })]);
    expect(b.icsId).toBe("");
  });

  test("unknown types, junk and empty cards are dropped; at most 10", () => {
    const list = normalizeActions([null, "x", { type: "hack", summary: "x" }, { type: "note_created", summary: "" },
      { type: "note_created", id: "n1", summary: "Market listesi" }]);
    expect(list).toEqual([{ type: "note_created", id: "n1", summary: "Market listesi", at: "" }]);
    expect(normalizeActions(Array.from({ length: 15 }, (_, i) => ({ type: "goal_added", id: `g${i}`, summary: "Koşu" }))))
      .toHaveLength(10);
    expect(normalizeActions("nope")).toEqual([]);
  });

  test("a bad zone or time is left out, never thrown", () => {
    const [a] = normalizeActions([reminder({ timezone: "Mars/Olympus", due_at: "yarın" })]);
    expect(a.timezone).toBe("");
    expect(a.dueAt).toBe("");
    expect(formatDue(a, "tr")).toBe("");
  });

  test("an already cleaned list passes unchanged", () => {
    const once = normalizeActions([reminder()]);
    expect(normalizeActions(once)).toEqual(once);
  });
});

describe("formatDue", () => {
  test("the reminder's time in its own zone", () => {
    const [a] = normalizeActions([reminder()]);
    expect(formatDue(a, "en")).toMatch(/09:00/);
    expect(formatDue(a, "tr")).toMatch(/09:00/);
  });
});

describe("applyActions", () => {
  test("a fresh reminder tells the reminder alerts once; a reply language is adopted once", () => {
    const events = [];
    const onChange = () => events.push("changed");
    window.addEventListener("luna:reminders-changed", onChange);
    const setReplyLang = jest.fn();
    const pref = { type: "preference_set", id: "u1", summary: "reply language: English", language: "en",
      at: new Date().toISOString() };
    expect(applyActions([reminder(), pref], { setReplyLang })).toBe(2);
    expect(applyActions([reminder(), pref], { setReplyLang })).toBe(0); // a re-render applies nothing again
    window.removeEventListener("luna:reminders-changed", onChange);
    expect(events).toEqual(["changed"]);
    expect(setReplyLang).toHaveBeenCalledTimes(1);
    expect(setReplyLang).toHaveBeenCalledWith("en");
  });

  test("a reloaded history (old actions) changes nothing", () => {
    const setReplyLang = jest.fn();
    const old = new Date(Date.now() - FRESH_MS - 60000).toISOString();
    expect(applyActions([{ type: "preference_set", id: "u2", summary: "x", language: "de", at: old }],
      { setReplyLang })).toBe(0);
    expect(applyActions([{ type: "preference_set", id: "u3", summary: "x", language: "de" }], { setReplyLang })).toBe(0);
    expect(setReplyLang).not.toHaveBeenCalled();
    expect(isFresh({ at: new Date().toISOString() })).toBe(true);
  });
});
