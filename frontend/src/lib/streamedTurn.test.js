/* global describe, test, expect, jest, beforeEach, afterEach */
// lib/streamedTurn.js — run with:  CI=true npx craco test --watchAll=false src/lib/streamedTurn
import { sendStreamedTurn, streamingReply } from "./streamedTurn";
import { sendChat, streamChat } from "./api";

jest.mock("./api", () => ({ sendChat: jest.fn(), streamChat: jest.fn() }));

const ARGS = { message: "selam", mode: "friend", lang: "tr", conversationId: null, mood: null };
const fail = (props) => Object.assign(new Error("failed"), props);
const conflict = () => fail({ response: { status: 409 } });

// streamChat that hands out `pieces` and then fails with `error`.
const streamsThenFails = (pieces, error) => async ({ onDelta }) => {
  pieces.forEach((p) => onDelta(p));
  throw error;
};

// Runs `promise` to its end under fake timers (the 409 waits).
async function settle(promise) {
  let done = false;
  let value;
  let error;
  promise.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  for (let i = 0; i < 2000 && !done; i++) {
    for (let j = 0; j < 10; j++) await Promise.resolve();
    if (!done) jest.advanceTimersByTime(250);
  }
  return { done, value, error };
}

describe("sendStreamedTurn", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendChat.mockReset();
    streamChat.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a typed turn streams under its key, without asking /api/chat", async () => {
    streamChat.mockImplementation(async ({ onDelta }) => {
      onDelta("Mer");
      onDelta("haba");
      return "Merhaba";
    });
    const deltas = [];
    const reply = await sendStreamedTurn(ARGS, { voice: false, idempotencyKey: "text-k1", recover: true,
      onDelta: (t) => deltas.push(t) });
    expect(reply).toBe("Merhaba");
    expect(deltas).toEqual(["Mer", "haba"]);
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ ...ARGS, voice: false, idempotencyKey: "text-k1" }));
    expect(sendChat).not.toHaveBeenCalled();
  });

  test.each([[false], [true]])("a stream that never got going asks /api/chat under the same key and waits out its 409s (voice: %s)", async (voice) => {
    streamChat.mockRejectedValue(fail({ canFallBack: true }));
    sendChat.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict()).mockResolvedValueOnce("Selam!");
    const out = await settle(sendStreamedTurn(ARGS, { voice, idempotencyKey: "k1", recover: !voice, onDelta: () => {} }));
    expect(out.value).toBe("Selam!");
    expect(sendChat).toHaveBeenCalledTimes(3);
    sendChat.mock.calls.forEach(([a]) => expect(a).toEqual(expect.objectContaining({ ...ARGS, voice, idempotencyKey: "k1" })));
  });

  test("a typed reply broken off on this side after some of it showed is fetched whole under the same key", async () => {
    streamChat.mockImplementation(streamsThenFails(["Yarım"], fail({ resumable: true, canFallBack: false })));
    sendChat.mockRejectedValueOnce(conflict()).mockResolvedValueOnce("Yarım değil, bütün cevap.");
    const deltas = [];
    const out = await settle(sendStreamedTurn(ARGS, { voice: false, idempotencyKey: "text-k1", recover: true,
      onDelta: (t) => deltas.push(t) }));
    expect(out.value).toBe("Yarım değil, bütün cevap.");
    expect(deltas).toEqual(["Yarım"]);
    expect(sendChat).toHaveBeenCalledTimes(2);
    expect(sendChat.mock.calls[0][0]).toEqual(expect.objectContaining({ voice: false, idempotencyKey: "text-k1" }));
  });

  test("a timed-out stream: a typed turn fetches the reply, a spoken one gives up (unchanged)", async () => {
    const timeout = () => Object.assign(fail({ resumable: true, canFallBack: false }), { name: "TimeoutError" });
    streamChat.mockRejectedValue(timeout());
    sendChat.mockResolvedValue("Geç ama tam.");
    expect((await settle(sendStreamedTurn(ARGS, { voice: false, idempotencyKey: "k", recover: true,
      onDelta: () => {} }))).value).toBe("Geç ama tam.");
    sendChat.mockClear();
    const spoken = await settle(sendStreamedTurn(ARGS, { voice: true, idempotencyKey: "k", onDelta: () => {} }));
    expect(spoken.error.name).toBe("TimeoutError");
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("a spoken reply broken off after some of it was said is a failed turn (unchanged)", async () => {
    const error = fail({ resumable: true, canFallBack: false });
    streamChat.mockImplementation(streamsThenFails(["Merhaba,"], error));
    const out = await settle(sendStreamedTurn(ARGS, { voice: true, idempotencyKey: "voice-1", onDelta: () => {} }));
    expect(out.error).toBe(error);
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("a turn the server itself failed is never asked again", async () => {
    // task_failed: stream_interrupted, here a flagged turn with its kept reply
    const error = fail({ response: { status: 502 }, canFallBack: false, reply: "Buradayım." });
    streamChat.mockImplementation(streamsThenFails(["Seni duyuyorum,"], error));
    const out = await settle(sendStreamedTurn(ARGS, { voice: false, idempotencyKey: "text-k1", recover: true,
      onDelta: () => {} }));
    expect(out.error).toBe(error);
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("a turn that was let go is never asked again", async () => {
    const ctl = new window.AbortController();
    ctl.abort();
    streamChat.mockRejectedValue(fail({ canFallBack: true, resumable: true }));
    const out = await settle(sendStreamedTurn(ARGS, { voice: true, idempotencyKey: "voice-1", signal: ctl.signal,
      onDelta: () => {} }));
    expect(out.error).toBeTruthy();
    expect(sendChat).not.toHaveBeenCalled();
  });

  test("the 409 wait: ~9 s for a spoken turn, past the server's 90 s for a typed one", async () => {
    streamChat.mockRejectedValue(fail({ canFallBack: true }));
    sendChat.mockImplementation(async () => { throw conflict(); });
    const waited = async (voice) => {
      sendChat.mockClear();
      const start = Date.now();
      const out = await settle(sendStreamedTurn(ARGS, { voice, idempotencyKey: "k", recover: !voice, onDelta: () => {} }));
      expect(out.error.response.status).toBe(409);
      return { ms: Date.now() - start, calls: sendChat.mock.calls.length };
    };
    const spoken = await waited(true);
    expect(spoken.calls).toBe(7);
    expect(spoken.ms).toBeGreaterThanOrEqual(9000);
    expect(spoken.ms).toBeLessThan(12000);
    const typed = await waited(false);
    expect(typed.calls).toBe(33);
    expect(typed.ms).toBeGreaterThanOrEqual(90000);
  });
});

describe("streamingReply", () => {
  let frames;
  let state;
  let updates;
  const setMessages = (u) => {
    updates += 1;
    state = typeof u === "function" ? u(state) : u;
  };
  const runFrames = () => {
    const due = frames;
    frames = [];
    due.forEach((f) => f && f.cb());
  };

  beforeEach(() => {
    frames = [];
    state = [{ id: "u-1", role: "user", text: "selam", mode: "friend" }];
    updates = 0;
    window.requestAnimationFrame = (cb) => {
      frames.push({ cb });
      return frames.length;
    };
    window.cancelAnimationFrame = (id) => {
      frames[id - 1] = null;
    };
  });

  test("the first bit opens Luna's streaming bubble; later bits land once per frame", () => {
    const r = streamingReply(setMessages, "friend");
    r.onDelta("Mer");
    expect(state[1]).toEqual({ id: r.id, role: "luna", text: "Mer", streaming: true, mode: "friend" });
    r.onDelta("ha");
    r.onDelta("ba");
    expect(updates).toBe(1);
    expect(frames).toHaveLength(1);
    runFrames();
    expect(updates).toBe(2);
    expect(state[1].text).toBe("Merhaba");
    runFrames(); // nothing pending: no extra render
    expect(updates).toBe(2);
  });

  test("finish puts the whole reply (and its help card) in the bubble's place; a pending bit never lands after it", () => {
    const r = streamingReply(setMessages, "friend");
    r.onDelta("Mer");
    r.onDelta("ha");
    const safety = { kind: "self_harm", resources: [] };
    const final = { id: r.id, role: "luna", text: "Merhaba!", mode: "friend", safety };
    r.finish(final);
    runFrames();
    expect(state).toEqual([state[0], final]);
  });

  test("finish with nothing streamed appends the reply (the /api/chat fallback)", () => {
    const r = streamingReply(setMessages, "friend");
    const final = { id: r.id, role: "luna", text: "Selam!", mode: "friend" };
    r.finish(final);
    expect(state).toEqual([state[0], final]);
  });

  test("drop takes the partial bubble away, and is a no-op when nothing showed", () => {
    const r = streamingReply(setMessages, "friend");
    r.drop();
    expect(updates).toBe(0);
    r.onDelta("Yarım");
    r.onDelta(" kaldı");
    r.drop();
    runFrames();
    expect(state).toEqual([{ id: "u-1", role: "user", text: "selam", mode: "friend" }]);
  });
});
