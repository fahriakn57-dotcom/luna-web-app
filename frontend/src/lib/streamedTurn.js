// A chat turn whose reply streams in (lib/api.js streamChat), for
// pages/Luna.jsx — kept here so it can be tested on its own
// (streamedTurn.test.js).
import { sendChat, streamChat } from "./api";

export function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// How long the /api/chat fallback below keeps asking while it gets 409 (the
// streamed request is still being answered). A spoken turn: ~9 s — the call
// is waiting in silence. A typed turn: past the server's own 90 s bound on a
// turn (backend chat_stream.py _WORKER_TIMEOUT_SECONDS), so a slow,
// thoughtful reply is still fetched instead of ending in an error toast
// while the server has it.
const FALLBACK_409 = {
  spoken: { retries: 6, waitMs: 1500 },
  typed: { retries: 32, waitMs: 3000 },
};

// If the stream never got going — before any of the reply arrived: a
// network error, a server or proxy that can't stream — the turn is asked
// once the normal way, under the same idempotency key, so the server never
// answers it twice (a 409 means the streamed request is still being
// answered: its reply is replayed once it is done). A typed turn
// (recover: true) is asked that way too when the stream broke off on this
// side after part of the reply (the connection went, or it went quiet): the
// server carries on and keeps the reply under that key — the bubble then
// gets all of it instead of vanishing. (If the server had failed the turn
// itself, the key was let go and this asks it once more, like a retry.)
// Otherwise, after part of the reply arrived, a broken stream is a failed
// turn (the caller's catch). signal: the turn is let go — whatever is on its
// way then stops.
export async function sendStreamedTurn(args, { voice, idempotencyKey, signal = null, onDelta, recover = false }) {
  let started = false;
  try {
    return await streamChat({
      ...args,
      voice,
      idempotencyKey,
      signal,
      onDelta: (text) => {
        started = true;
        onDelta(text);
      },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (!((!started && e?.canFallBack) || (recover && e?.resumable))) throw e;
  }
  const { retries, waitMs } = recover ? FALLBACK_409.typed : FALLBACK_409.spoken;
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendChat({ ...args, voice, idempotencyKey, signal });
    } catch (e) {
      if (signal?.aborted || e?.response?.status !== 409 || attempt >= retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (signal?.aborted) throw e;
    }
  }
}

// A typed turn's reply as it streams in (launch audit 2026-10-03: the chat
// showed nothing for 2-4 s, until the whole reply was written). The first
// bit opens Luna's bubble with streaming: true (FriendPanel then says
// "Yazıyor..." instead of showing the typing dots); later bits are added at
// most once per animation frame, so a fast stream doesn't re-render the list
// for every few characters.
export function streamingReply(setMessages, mode) {
  const id = "l-" + Date.now();
  let shown = false;
  let pending = "";
  let frame = null;
  const flush = () => {
    frame = null;
    if (!pending) return;
    const piece = pending;
    pending = "";
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: x.text + piece } : x)));
  };
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = "";
  };
  return {
    id,
    onDelta(text) {
      if (!shown) {
        shown = true;
        setMessages((m) => [...m, { id, role: "luna", text, streaming: true, mode }]);
        return;
      }
      pending += text;
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    // The whole reply as the server stored it (and its help card) takes the
    // streamed text's place — or arrives in one go when nothing streamed
    // (the /api/chat fallback).
    finish(msg) {
      stop();
      setMessages((m) => (shown ? m.map((x) => (x.id === id ? msg : x)) : [...m, msg]));
    },
    // The turn failed after part of the reply showed (the server stopped
    // it, or it broke off and couldn't be fetched): the partial text goes —
    // it was never the whole answer.
    drop() {
      stop();
      if (shown) setMessages((m) => m.filter((x) => x.id !== id));
    },
  };
}
