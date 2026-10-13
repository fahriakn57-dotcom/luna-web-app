// What a turn brought besides its text, for the reply bubble
// (components/ChatMessage.jsx), from a shaped turn (lib/api.js turnResult):
// - attachments: the pictures / files made in chat — also a PDF, Word,
//   Excel or deck asked for straight away ("X hakkında sunum hazırla");
// - sources: the web pages a searched reply used;
// - actions: what Luna did in your account (a reminder set, a note saved...,
//   backend services/agent_tools.py) — shown by components/MessageExtras.jsx.
// Only the ones the turn has: a plain reply's bubble gets none of the keys.
export function replyExtras(result) {
  const r = result && typeof result === "object" ? result : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const attachments = list(r.attachments);
  const sources = list(r.sources);
  const actions = list(r.actions);
  return {
    ...(attachments.length ? { attachments } : {}),
    ...(sources.length ? { sources } : {}),
    ...(actions.length ? { actions } : {}),
  };
}
