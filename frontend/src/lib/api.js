import axios from "axios";
import { normalizeSources } from "./links";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error(
    "REACT_APP_BACKEND_URL is not set. Define it in frontend/.env (see .env.example)."
  );
}
export const API = `${BACKEND_URL}/api`;

const DEVICE_ID_KEY = "luna_device_id";
const DEVICE_SECRET_KEY = "luna_device_secret";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let registering = null;

// Mirrors the mobile app's identity model (frontend/src/api/client.ts in
// luna-main): a random device_id claimed via /api/auth/register, proven on
// every later request with the device_secret returned exactly once. This is
// what lets a "pairing code" from the phone (see pairWithCode below) swap in
// the SAME device_id/secret here, so the browser starts seeing that
// account's own chat history and memories instead of a fresh empty one.
async function registerDevice() {
  const id = localStorage.getItem(DEVICE_ID_KEY) || uuid();
  localStorage.setItem(DEVICE_ID_KEY, id);
  const res = await axios.post(`${API}/auth/register`, null, {
    headers: { "X-Device-Id": id },
  });
  localStorage.setItem(DEVICE_SECRET_KEY, res.data.device_secret);
  return { id, secret: res.data.device_secret };
}

async function getCredentials() {
  const id = localStorage.getItem(DEVICE_ID_KEY);
  const secret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (id && secret) return { id, secret };
  if (!registering) {
    registering = registerDevice().finally(() => {
      registering = null;
    });
  }
  return registering;
}

// This client renders Markdown (components/Markdown.jsx): every API request
// says so, so the server may answer with tables, headings, code blocks and
// [title](url) links. A client that doesn't send it (an older web build, the
// mobile app) gets plain text with "(site.com)" citations instead. Voice
// turns are always plain on the server's side. Chat bodies also carry
// render: "markdown" (chatBody below).
export const RENDER_HEADER = "X-Luna-Render";
export const RENDER_MODE = "markdown";

// Where this browser is (backend services/user_locale.py): its IANA time
// zone ("Europe/Berlin") and its language ("de-DE") go with every request,
// so Luna's clock, web search location, reminders and crisis help numbers
// follow the user instead of assuming Türkiye. The server stores them in
// the profile once (and follows a new zone when the device moves); a value
// the user set themselves is never overwritten.
export const TIMEZONE_HEADER = "X-Luna-Timezone";
export const LOCALE_HEADER = "X-Luna-Locale";

const TIMEZONE_SHAPE = new RegExp("^[A-Za-z0-9_+/-]+$");
const LOCALE_SHAPE = new RegExp("^[A-Za-z0-9-]+$");

export function localeHeaders() {
  const out = {};
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz && tz.length <= 64 && TIMEZONE_SHAPE.test(tz)) out[TIMEZONE_HEADER] = tz;
  } catch (_) {
    // no Intl time zone: the server keeps what it knows
  }
  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const lang = nav && (nav.language || (Array.isArray(nav.languages) ? nav.languages[0] : ""));
    if (typeof lang === "string" && lang && lang.length <= 35 && LOCALE_SHAPE.test(lang)) out[LOCALE_HEADER] = lang;
  } catch (_) {
    // no browser language: nothing to send
  }
  return out;
}

async function authHeaders() {
  const { id, secret } = await getCredentials();
  return { ...localeHeaders(), "X-Device-Id": id, "X-Device-Secret": secret, [RENDER_HEADER]: RENDER_MODE };
}

// ...and the requests made without the device's auth (registration, login,
// pairing, features): every axios call to this API gets the headers too.
axios.interceptors?.request?.use?.((config) => {
  if (!config || !String(config.url || "").startsWith(API)) return config;
  if (!config.headers) config.headers = {};
  const extra = { [RENDER_HEADER]: RENDER_MODE, ...localeHeaders() };
  for (const [name, value] of Object.entries(extra)) {
    if (typeof config.headers.set === "function") config.headers.set(name, value);
    else config.headers[name] = value;
  }
  return config;
});

// Redeems a 5-minute pairing code generated on the phone (Profil → Web'e
// Bağla) and adopts that device's identity here, replacing whatever
// anonymous identity this browser had registered on first load.
export async function pairWithCode(code) {
  const res = await axios.post(`${API}/pairing/redeem`, { code: (code || "").trim() });
  localStorage.setItem(DEVICE_ID_KEY, res.data.device_id);
  localStorage.setItem(DEVICE_SECRET_KEY, res.data.device_secret);
  markAuthed(); // pairing from an already-logged-in phone counts as a real login here too
}

export function isPaired() {
  return Boolean(localStorage.getItem(DEVICE_ID_KEY) && localStorage.getItem(DEVICE_SECRET_KEY));
}

const AUTHED_KEY = "luna_authed";

// True once this browser has actually been through the account gate
// (Login/Signup/Google/pairing from an already-authed phone). Deliberately
// does NOT fall back to "has any device identity" (isPaired() alone) —
// registerDevice() mints one anonymously the moment ANY API call is made,
// so that would let a plain anonymous guest session pass as "authed" and
// skip the gate entirely, which defeats the point of requiring an account
// before landing in the app.
export function isAuthed() {
  return localStorage.getItem(AUTHED_KEY) === "1";
}

function markAuthed() {
  localStorage.setItem(AUTHED_KEY, "1");
}

// Must clear AUTHED_KEY along with the device identity — otherwise the next
// visit skips the account gate (isAuthed() still true) and registerDevice()
// silently mints a brand-new empty anonymous account.
export function signOut() {
  localStorage.removeItem(DEVICE_ID_KEY);
  localStorage.removeItem(DEVICE_SECRET_KEY);
  localStorage.removeItem(AUTHED_KEY);
}

// An account holds one device at a time: logging in somewhere else gives
// that device a new secret, and this one's requests start failing with 401.
// Before (launch audit 2026-10-03) every send then ended in "küçük bir
// sorun" forever with no way back to the login screen. Now the first 401 on
// a request that carried this device's secret signs this browser out and
// reloads to the account gate, which says why (consumeSessionLost).
const SESSION_LOST_KEY = "luna_session_lost";
let sessionLostHandled = false;

function sessionLost() {
  if (sessionLostHandled || !isAuthed()) return;
  sessionLostHandled = true;
  signOut();
  try {
    sessionStorage.setItem(SESSION_LOST_KEY, "1");
  } catch {
    // the gate just won't say why
  }
  window.location.assign(`${process.env.PUBLIC_URL || ""}/`);
}

// True once, right after sessionLost() sent this browser to the gate.
export function consumeSessionLost() {
  try {
    const lost = sessionStorage.getItem(SESSION_LOST_KEY) === "1";
    sessionStorage.removeItem(SESSION_LOST_KEY);
    return lost;
  } catch {
    return false;
  }
}

function sentDeviceSecret(headers) {
  if (!headers) return false;
  const get = typeof headers.get === "function" ? (k) => headers.get(k) : (k) => headers[k];
  return Boolean(get("X-Device-Secret") || get("x-device-secret"));
}

axios.interceptors.response.use(undefined, (error) => {
  const cfg = error?.config || {};
  // /auth/* answers 401 for a wrong password or Google token — not a lost session.
  if (error?.response?.status === 401 && !String(cfg.url || "").includes("/auth/") && sentDeviceSecret(cfg.headers)) {
    sessionLost();
  }
  return Promise.reject(error);
});

// Creates a brand-new account: registers this browser as a fresh device
// (if it isn't one already), then attaches email+password to it so it can
// be recovered from other devices later via loginWithEmail().
export async function signupWithEmail(email, password) {
  await getCredentials(); // ensures a device identity exists first
  const headers = await authHeaders();
  const res = await axios.post(`${API}/auth/link-email`, { email, password }, { headers });
  markAuthed();
  return res.data; // { ok, email, verification_email_sent }
}

// Logs into an EXISTING account (created via signupWithEmail, here or on
// another device) — rebinds this browser's device_id to that account,
// replacing whatever anonymous identity it had.
export async function loginWithEmail(email, password) {
  const id = localStorage.getItem(DEVICE_ID_KEY) || uuid();
  const res = await axios.post(`${API}/auth/recover`, { email, password }, {
    headers: { "X-Device-Id": id },
  });
  localStorage.setItem(DEVICE_ID_KEY, res.data.device_id);
  localStorage.setItem(DEVICE_SECRET_KEY, res.data.device_secret);
  markAuthed();
  return res.data;
}

// Requests a password-reset email for an existing email+password account.
// Always resolves the same way regardless of whether the email actually
// has an account — the backend deliberately never reveals that (see
// backend/luna/security.py::request_password_reset), so the caller always
// shows the same "check your inbox" message either way.
export async function forgotPassword(email, lang = "tr") {
  const res = await axios.post(`${API}/auth/forgot-password`, { email, lang });
  return res.data;
}

// Confirms a forgot-password email link and sets a new password — does NOT
// log this browser in (no device rebinding here); the user still logs in
// normally afterward via loginWithEmail() with their new password.
export async function resetPassword(token, password) {
  const res = await axios.post(`${API}/auth/reset-password`, { token, password });
  return res.data;
}

export async function loginWithGoogle(idToken) {
  const id = localStorage.getItem(DEVICE_ID_KEY) || uuid();
  const secret = localStorage.getItem(DEVICE_SECRET_KEY);
  // X-Device-Secret proves we actually own this device's existing account
  // before the backend will attach the Google identity to it (an anonymous
  // guest upgrading to Google sign-in) — without it, device_id alone isn't
  // enough (device_id isn't a secret), so the backend rejects the merge.
  // A brand-new device has no secret yet; that's fine, it just creates one.
  const headers = { "X-Device-Id": id };
  if (secret) headers["X-Device-Secret"] = secret;
  const res = await axios.post(`${API}/auth/google`, { id_token: idToken }, { headers });
  localStorage.setItem(DEVICE_ID_KEY, res.data.device_id);
  localStorage.setItem(DEVICE_SECRET_KEY, res.data.device_secret);
  markAuthed();
  return res.data;
}

// Skips straight to the anonymous device flow (no email attached yet) —
// used by "misafir olarak devam et"-style entry points, if any.
export async function continueAsGuest() {
  await getCredentials();
  markAuthed();
}

// Confirms the link sent by /api/auth/link-email (see security.py::verify_email
// on the backend) — the landing page at /verify-email calls this with the
// token from the URL's query string. No device auth needed: the token
// itself (a 256-bit random value, single-use, 24h TTL) is the credential.
export async function verifyEmailToken(token) {
  await axios.post(`${API}/auth/verify-email`, { token });
}

// Every generated-file kind LunaWorks can produce, keyed the same way the
// backend's message meta stores them (see media.py's _FILE_KIND_META) —
// mirrors DOC_KINDS below, plus image which has always used its own
// image_base64/image_mime pair (predates the others).
const GENERATED_FILE_META = [
  { base64Key: "pdf_base64", mimeKey: "pdf_mime", ext: "pdf" },
  { base64Key: "xlsx_base64", mimeKey: "xlsx_mime", ext: "xlsx" },
  { base64Key: "docx_base64", mimeKey: "docx_mime", ext: "docx" },
  { base64Key: "pptx_base64", mimeKey: "pptx_mime", ext: "pptx" },
  { base64Key: "tableimg_base64", mimeKey: "tableimg_mime", ext: "png" },
  { base64Key: "chart_base64", mimeKey: "chart_mime", ext: "png" },
];

// The help card of a reloaded flagged reply: { kind, resources?, country? }
// (meta.safety is the kind string; an object with its own kind is read too),
// or undefined for every other message.
export function historySafety(meta) {
  const raw = meta && meta.safety;
  const kind = typeof raw === "string" ? raw : raw && typeof raw === "object" ? raw.kind : "";
  if (!kind || typeof kind !== "string") return undefined;
  const resources = Array.isArray(meta.safety_resources) ? meta.safety_resources
    : raw && typeof raw === "object" && Array.isArray(raw.resources) ? raw.resources : null;
  const country = typeof meta.safety_country === "string" ? meta.safety_country : null;
  return { kind, ...(resources ? { resources } : {}), ...(country ? { country } : {}) };
}

function toWebMessage(m) {
  const meta = m.meta || {};
  const generated = GENERATED_FILE_META.find((k) => meta[k.base64Key]);
  return {
    id: m.id,
    role: m.sender === "assistant" || m.sender === "xsf" ? "luna" : "user",
    text: m.content,
    timestamp: m.created_at,
    imageUrl: meta.image_base64 ? `data:${meta.image_mime || "image/png"};base64,${meta.image_base64}` : undefined,
    // A generated PDF/Excel/Word/PPT/table-image/chart message — chat had
    // no way to open/download these before (only the dedicated
    // "Ürettiklerim: X" gallery panel could), even though the reply text
    // ("İşte Word belgen hazır!") implies you can just grab it right there.
    fileUrl: generated ? `data:${meta[generated.mimeKey]};base64,${meta[generated.base64Key]}` : undefined,
    // \w is ASCII-only — \p{L}\p{N} (Unicode property escapes) keeps
    // Turkish letters (ç/ğ/ı/ö/ş/ü) instead of stripping them from the name.
    fileName: generated ? `${(meta.title || "luna-dosya").replace(/[^\p{L}\p{N}\s-]/gu, "").trim() || "luna-dosya"}.${generated.ext}` : undefined,
    // A reply to a message the server flagged (backend services/safety.py):
    // the help card with the emergency numbers stays under it after a reload
    // — the user's own country's lines (GET /api/messages adds
    // meta.safety_resources / meta.safety_country, the live turn's shape).
    safety: historySafety(meta),
    // The web pages a searched reply cited (meta.web_sources; a researched
    // deck keeps meta.sources): the "Kaynaklar" chips stay under it after a
    // reload too.
    sources: (() => {
      const list = normalizeSources(Array.isArray(meta.web_sources) ? meta.web_sources : meta.sources);
      return list.length ? list : undefined;
    })(),
    // What Luna did in the account that turn (meta.agent_actions — a
    // reminder with its calendar links...): the cards stay after a reload.
    actions: (() => {
      const list = turnActions(meta.agent_actions);
      return list.length ? list : undefined;
    })(),
  };
}

// ---- What a turn gives back ----
// The attachments of a reply (a picture or a file made in chat, or by the
// code tool — backend services/chat_actions.py attachment contract: {type:
// "image"|"file", message_id, mime_type, name, size_bytes, url:
// "/api/messages/{id}/file", data_base64 (only up to 3 MB), source}),
// cleaned for components/MessageExtras.jsx. dataUrl: the bytes inline, when
// they came along; otherwise they are fetched with fetchMessageFile.
export function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const mimeType = typeof a.mime_type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(a.mime_type)
      ? a.mime_type : "application/octet-stream";
    const type = a.type === "image" && mimeType.startsWith("image/") ? "image" : "file";
    const messageId = typeof a.message_id === "string" || typeof a.message_id === "number" ? String(a.message_id) : "";
    const dataBase64 = typeof a.data_base64 === "string" && a.data_base64 ? a.data_base64 : "";
    if (!messageId && !dataBase64) continue; // nothing to show or fetch
    const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 160) : "luna-dosya";
    out.push({
      type,
      messageId,
      mimeType,
      name,
      sizeBytes: Number.isFinite(a.size_bytes) ? a.size_bytes : null,
      dataUrl: dataBase64 ? `data:${mimeType};base64,${dataBase64}` : "",
      source: typeof a.source === "string" ? a.source : "",
    });
  }
  return out;
}

// What Luna did in the user's account during a turn (backend services/
// agent_tools.py: result["actions"], kept on the reply as meta.agent_actions):
// [{type: "reminder_created" | "reminder_cancelled" | "note_created" |
// "goal_added" | "goal_completed" | "memory_saved" | "memory_forgotten" |
// "preference_set", id, summary, ...a reminder's text, due_at, timezone,
// recurrence, calendar: {google_url, ics_url}}]. Only objects with a type
// pass, at most 10, each a copy, still in the server's shape:
// components/MessageExtras.jsx ActionCards cleans them for display
// (lib/agentActions.js normalizeActions — known types, safe links only).
const MAX_ACTIONS = 10;

export function turnActions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (out.length >= MAX_ACTIONS) break;
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    if (typeof a.type !== "string" || !/^[a-z][a-z_]{1,39}$/.test(a.type)) continue;
    out.push({ ...a });
  }
  return out;
}

// /api/chat's JSON, the stream's assistant_completed, /chat/media's answer
// (or, from an older caller or server, just the reply text) as one shape:
// { reply, messageId, sources, attachments, actions, safety, degraded }. A
// picture action answered without `attachments` (an older server) still
// shows its picture from image_base64. Shaping a result that already is one
// returns it as it is (streamChat({ full }) hands one to callers that shape
// again).
const TURN_RESULT = Symbol("luna.turnResult");

function shaped(result) {
  Object.defineProperty(result, TURN_RESULT, { value: true });
  return result;
}

export function turnResult(data) {
  if (data && data[TURN_RESULT]) return data;
  if (typeof data === "string") {
    return shaped({ reply: data, messageId: null, sources: [], attachments: [], actions: [], safety: null, degraded: false });
  }
  const d = data && typeof data === "object" ? data : {};
  let attachments = normalizeAttachments(d.attachments);
  if (!attachments.length && typeof d.image_base64 === "string" && d.image_base64) {
    attachments = normalizeAttachments([{
      type: "image", message_id: d.message_id, mime_type: d.mime_type || "image/png",
      data_base64: d.image_base64, name: "luna-gorsel",
    }]);
  }
  return shaped({
    reply: typeof d.reply === "string" ? d.reply : "",
    messageId: d.message_id != null ? String(d.message_id) : null,
    sources: normalizeSources(d.sources),
    attachments,
    actions: turnActions(d.actions),
    safety: d.safety || null,
    degraded: Boolean(d.degraded),
  });
}

function toWebMemory(m) {
  return {
    id: m.id,
    title: m.title || "",
    content: m.content,
    displayContent: m.title ? `${m.title}: ${m.content}` : m.content,
    category: m.category || m.type || "other",
    tags: m.tags || [],
    event_date: (m.created_at || "").slice(0, 10),
    created_at: m.created_at,
  };
}

// Luna's reply language — chosen in Settings, may differ from the TR/EN
// interface (e.g. English UI, German replies). null = follow the interface.
const REPLY_LANG_KEY = "luna_reply_lang";
export function getReplyLang() {
  try { return localStorage.getItem(REPLY_LANG_KEY) || null; } catch { return null; }
}
export function setReplyLang(code) {
  try {
    if (code) localStorage.setItem(REPLY_LANG_KEY, code);
    else localStorage.removeItem(REPLY_LANG_KEY);
  } catch {}
}

// The body of a chat turn (/api/chat and /api/chat/stream). mood: the mood
// the user picked TODAY in Ruh Halim ("great" | "good" | "neutral" | "tired"
// | "bad"), or null — Luna takes it into account. voice: this turn is spoken
// in the call — the backend asks for a short, speakable reply (no markdown,
// lists or emoji). language: the reply language travels with every message
// (it used to be a separate POST /api/profile before each one — a quarter
// second per turn); an explicit reply-language choice wins over the
// interface language. render: this client shows Markdown (see RENDER_HEADER;
// the server keeps a spoken turn plain regardless).
function chatBody({ message, mode, lang, conversationId, voice, mood }) {
  return {
    text: message,
    mode: mode === "work" ? "work" : "friend",
    conversation_id: conversationId || null,
    voice: !!voice,
    language: getReplyLang() || lang,
    render: RENDER_MODE,
    ...(mood ? { mood } : {}),
  };
}

// idempotencyKey: sent as X-Idempotency-Key — a turn asked again under the
// same key is answered once (a repeat gets that answer replayed, or 409
// while it is still being written). See streamChat. signal: cancels it
// (the voice call was hung up).
// Which optional services work right now (GET /api/features, no account
// needed) — e.g. email: false while verification/reset emails can't be sent.
// null when the server can't be asked; callers then keep their defaults.
export async function fetchFeatures() {
  try {
    const res = await axios.get(`${API}/features`, { timeout: 8000 });
    return res.data || null;
  } catch {
    return null;
  }
}

// onSafety(safety): called when the server flagged the message (self-harm
// or abuse — backend services/safety.py), so the app can show the help card.
// Resolves with the reply text; with full: true, with the whole turn
// (turnResult: reply, sources, attachments, ...).
export async function sendChat({ message, mode, lang, conversationId, voice = false, mood = null, idempotencyKey = null, signal = null, onSafety = null, full = false }) {
  const headers = await authHeaders();
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await axios.post(
    `${API}/chat`,
    chatBody({ message, mode, lang, conversationId, voice, mood }),
    // A spoken turn must never leave the call waiting forever: replies take
    // 2-4 s, so 45 s means something is stuck (the call then says so).
    { headers, ...(signal ? { signal } : {}), ...(voice ? { timeout: 45000 } : {}) }
  );
  if (res.data?.safety) {
    try {
      onSafety?.(res.data.safety);
    } catch (_) {}
  }
  return full ? turnResult(res.data) : res.data.reply;
}

// ---- A turn, streamed ----
// Luna's reply as it is being written: the voice call starts talking at her
// first sentence, and a typed reply shows up word by word instead of after
// the whole thing (launch audit 2026-10-03: 2-4 s of nothing). POST
// /api/chat/stream answers with Server-Sent Events — "data: {json}" frames:
// {"type":"assistant_delta","text"} (the next bit of the reply, zero or more
// of them), then {"type":"assistant_completed","reply"} (all of it) or
// {"type":"task_failed","status","detail"}.
//
// onDelta(text) gets each bit as it arrives; resolves with the whole reply.
// Errors look like axios's where the callers read them (e.response.status,
// .headers["retry-after"], .data.detail), so the quota and rate-limit
// messages keep working. e.canFallBack: the stream never got going — a
// network error, a server or proxy that can't stream (404/405/5xx), or it
// closed without a word — so asking /api/chat instead (same idempotency
// key) is safe. e.resumable: it broke off on this side — the connection
// went, or nothing came for the idle time — not the server failing the
// turn, so the server may still finish it and keep the reply under the
// idempotency key (/api/chat with that key: the reply, or 409 while it is
// still being written). e.reply: what the server kept for a turn that broke
// off mid-reply — the caring reply of a flagged turn (onSafety called, show
// it with the help card) or the calm "can't help with that" when the model's
// safety filter stopped the reply — to show in place of the partial text.
// Gives up when nothing at all arrives for the idle time — any bytes count
// (a ": keep-alive" comment as much as a reply delta), and the server sends
// such a comment every 5 s while it has nothing else to send (a web search
// before the first word, a slow first token), so only a dead connection — or
// an older server without keep-alives — runs it out:
// - a spoken turn (voice): STREAM_IDLE_MS — the call is waiting in silence
//   meanwhile, so a stalled stream is called off soon;
// - a typed turn: TYPED_STREAM_IDLE_MS. It also asks for stream: true (the
//   deltas, and the keep-alives from an older server that only sent them
//   when asked).
// Resolves with the reply text; with full: true, with the whole turn
// (turnResult: reply, sources, attachments, ...).
const STREAM_IDLE_MS = 15000;
const TYPED_STREAM_IDLE_MS = 45000;

function httpLikeError(status, detail, { retryAfter = null, canFallBack = false } = {}) {
  const e = new Error(`Request failed with status code ${status}`);
  e.response = { status, headers: retryAfter ? { "retry-after": retryAfter } : {}, data: { detail } };
  e.canFallBack = canFallBack;
  return e;
}

// task_failed's status, or one from its error code (an older server sends
// only that).
function failedStatus(event) {
  if (Number.isInteger(event.status)) return event.status;
  return { quota_exceeded: 429, empty_message: 400, timeout: 504 }[event.error] || 500;
}

// A minimal Server-Sent Events reader: lines end with \r\n, \n or \r (a
// \r at the very end of a chunk may be half of a \r\n — kept for the next
// one), "data:" lines gather until a blank line ends the frame, comments
// (":" keep-alives) and other fields are skipped.
function sseReader(onData) {
  let buf = "";
  let data = [];
  const line = (l) => {
    if (l === "") {
      if (data.length) onData(data.join("\n"));
      data = [];
      return;
    }
    if (l[0] === ":") return;
    const colon = l.indexOf(":");
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? "" : l.slice(colon + 1);
    if (value[0] === " ") value = value.slice(1);
    if (field === "data") data.push(value);
  };
  return (text, end = false) => {
    buf += text;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c !== "\n" && c !== "\r") continue;
      if (c === "\r" && i === buf.length - 1 && !end) break;
      line(buf.slice(start, i));
      if (c === "\r" && buf[i + 1] === "\n") i += 1;
      start = i + 1;
    }
    buf = buf.slice(start);
    if (end) {
      if (buf) line(buf);
      buf = "";
      line("");
    }
  };
}

// voice: a turn spoken in the call (short, speakable reply — see chatBody);
// otherwise a typed turn. onSafety as in sendChat.
export async function streamChat({ message, mode, lang, conversationId, voice = false, mood = null, signal = null, onDelta, idempotencyKey = null, onSafety = null, full = false }) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json", Accept: "text/event-stream" };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const idleMs = voice ? STREAM_IDLE_MS : TYPED_STREAM_IDLE_MS;
  const ctl = new window.AbortController();
  let idleTimer = null;
  let timedOut = false;
  const stillThere = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, idleMs);
  };
  const cancel = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener("abort", cancel);
  stillThere();

  let written = "";     // the reply so far, from its deltas
  let deltas = 0;
  let reply = null;     // the whole reply, once it is complete
  let completed = null; // ...and its assistant_completed event (sources, attachments)
  let failure = null;
  const read = sseReader((data) => {
    if (reply !== null || failure) return;
    let event;
    try {
      event = JSON.parse(data);
    } catch (_) {
      return; // not one of ours
    }
    if (event?.type === "assistant_delta" && typeof event.text === "string" && event.text) {
      written += event.text;
      deltas += 1;
      try {
        onDelta?.(event.text);
      } catch (_) {} // (the caller's trouble must not lose the reply)
    } else if (event?.type === "assistant_completed") {
      reply = typeof event.reply === "string" ? event.reply : written;
      completed = event;
      if (event.safety) {
        try {
          onSafety?.(event.safety);
        } catch (_) {}
      }
    } else if (event?.type === "task_failed") {
      failure = httpLikeError(failedStatus(event), typeof event.detail === "string" ? event.detail : "");
      if (typeof event.reply === "string" && event.reply) failure.reply = event.reply;
      if (event.safety) {
        try {
          onSafety?.(event.safety);
        } catch (_) {}
      }
    }
  });

  // Why a stream ended without its reply: our own abort, a timeout, or the
  // connection dropping (e: the network error, if any).
  const brokenOff = (e) => {
    if (signal?.aborted) return e || Object.assign(new Error("canceled"), { name: "AbortError" });
    const err = timedOut ? Object.assign(new Error("timeout"), { name: "TimeoutError" }) : e || new Error("stream ended early");
    // (Never after a timeout: the server may still be writing that reply.)
    err.canFallBack = !timedOut && deltas === 0;
    err.resumable = true;
    return err;
  };

  try {
    let res;
    try {
      res = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers,
        // A spoken turn gets its deltas from voice: true alone (unchanged);
        // a typed one asks for them (and the keep-alives) with stream: true.
        body: JSON.stringify({
          ...chatBody({ message, mode, lang, conversationId, voice, mood }),
          ...(voice ? {} : { stream: true }),
        }),
        signal: ctl.signal,
      });
    } catch (e) {
      throw brokenOff(e);
    }
    stillThere(); // (the answer's head counts as hearing from the server)
    if (!res.ok) {
      if (res.status === 401) sessionLost();
      let detail = "";
      try {
        const body = await res.json();
        detail = typeof body?.detail === "string" ? body.detail : "";
      } catch (_) {}
      throw httpLikeError(res.status, detail, {
        retryAfter: res.headers.get("Retry-After"),
        canFallBack: res.status === 404 || res.status === 405 || res.status >= 500,
      });
    }
    const reader = res.body?.getReader?.();
    try {
      if (!reader) {
        // No readable body here: the frames all at once, at the end.
        read(await res.text(), true);
      } else {
        const decoder = new window.TextDecoder();
        while (reply === null && !failure) {
          const { value, done } = await reader.read();
          if (done) {
            read(decoder.decode(), true);
            break;
          }
          // Any bytes at all — a ": keep-alive" comment (which the reader
          // skips) as much as a piece of the reply — mean the server is
          // still there: the silence timer starts over.
          stillThere();
          if (value) read(decoder.decode(value, { stream: true }));
        }
        if (reply !== null || failure) reader.cancel().catch(() => {});
      }
    } catch (e) {
      // (The reply may have been complete before the connection went.)
      if (reply === null && !failure) throw brokenOff(e);
    }
    if (failure) throw failure;
    if (reply === null) throw brokenOff(null);
    return full ? turnResult({ ...(completed || {}), reply }) : reply;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", cancel);
  }
}

// A turn spoken in the voice call, streamed (see streamChat).
export function streamVoiceChat(args) {
  return streamChat({ ...args, voice: true });
}

// Sohbetler — named conversation threads within a mode (Arkadaş Modu and
// LunaWorks Modu each have their own separate list), letting someone keep
// several distinct chats around instead of one single ever-growing thread.
// See backend/luna/routers/conversations.py.
export async function fetchConversations(mode) {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/conversations`, { headers, params: { mode: mode === "work" ? "work" : "friend" } });
  return res.data.conversations || [];
}

export async function createConversation(mode) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/conversations`, { mode: mode === "work" ? "work" : "friend" }, { headers });
  return res.data;
}

export async function deleteConversation(conversationId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/conversations/${conversationId}`, { headers });
}

// Sends an image (png/jpg/webp/gif) or document (pdf/txt) to Luna for real
// vision/document understanding — same backend endpoint
// (backend/luna/routers/media.py::chat_media) the mobile app already uses,
// mode-agnostic (works the same in Arkadaş/LunaWorks — anywhere that passes
// through conversation_engine.handle_turn). `text` is an optional caption/
// question alongside the file; the backend fills in a sensible default
// ("bu görsele bak..." / "bu belgeyi özetle...") when omitted.
// Resolves with the reply text; with { full: true }, with the whole turn
// (turnResult) — a photo + "bunu anime yap" answers with the transformed
// picture in `attachments`.
export async function sendMedia(file, text, mode, { full = false } = {}) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("text", text || "");
  form.append("mode", mode === "work" ? "work" : "friend");
  form.append("file", file);
  const res = await axios.post(`${API}/chat/media`, form, { headers });
  return full ? turnResult(res.data) : res.data.reply;
}

// Same idea as sendMedia, for up to 10 files in ONE turn (web only — the
// mobile client still uses the single-file /chat/media above, so that route
// is left untouched; see backend/luna/routers/media.py::chat_media_batch).
export async function sendMediaBatch(files, text, mode, { full = false } = {}) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("text", text || "");
  form.append("mode", mode === "work" ? "work" : "friend");
  files.forEach((f) => form.append("files", f));
  const res = await axios.post(`${API}/chat/media-batch`, form, { headers });
  return full ? turnResult(res.data) : res.data.reply;
}

// Where the bytes of a picture / file one of Luna's messages carries are
// (GET /api/messages/{id}/file — an attachment's url). Only ever this
// API's own route: the device's auth headers never go anywhere else.
export function messageFileUrl(messageId) {
  const id = String(messageId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return `${API}/messages/${id}/file`;
}

// Those bytes, as a Blob (the attachment's data came without its base64:
// over 3 MB, or a replayed answer). Errors look like axios's (e.response).
export async function fetchMessageFile(messageId, { signal } = {}) {
  const url = messageFileUrl(messageId);
  if (!url) throw httpLikeError(404, "");
  const headers = await authHeaders();
  const res = await fetch(url, { headers, ...(signal ? { signal } : {}) });
  if (!res.ok) {
    if (res.status === 401) sessionLost();
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch (_) {}
    throw httpLikeError(res.status, detail);
  }
  return res.blob();
}

// Asks Luna to GENERATE a new image from a text prompt (LunaWorks Modu) —
// distinct from sendMedia above, which sends an EXISTING file for Luna to
// look at. Backend: routers/media.py::generate_image (the image model).
export async function generateImage(prompt, mode) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("mode", mode === "work" ? "work" : "friend");
  const res = await axios.post(`${API}/media/generate-image`, form, { headers });
  return {
    reply: res.data.reply,
    imageUrl: `data:${res.data.mime_type || "image/png"};base64,${res.data.image_base64}`,
  };
}

// LunaWorks Modu's "Ürettiklerim: Görsel" gallery — every image this user
// has had Luna draw (see generateImage above, and pictures made in chat),
// newest first. The server pages it (by count and by bytes — a few big
// pictures fill a page): { images, hasMore, nextBefore }, and nextBefore
// passed back as `before` fetches the next page.
export async function fetchGeneratedImagesPage({ before = null } = {}) {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/media/generated-images`, { headers, ...(before ? { params: { before } } : {}) });
  const data = res.data || {};
  return {
    images: (data.images || []).map((im) => ({
      id: im.id,
      prompt: im.prompt || "",
      imageUrl: `data:${im.mime_type || "image/png"};base64,${im.image_base64}`,
      createdAt: im.created_at,
    })),
    hasMore: Boolean(data.has_more && data.next_before),
    nextBefore: data.next_before || null,
  };
}

// The gallery's first page only (unchanged, for older callers).
export async function fetchGeneratedImages() {
  return (await fetchGeneratedImagesPage()).images;
}

export async function deleteGeneratedImage(imageId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/media/generated-images/${imageId}`, { headers });
}

// Turns whatever raw text the user pastes (a messy list, CSV-ish text, a
// paragraph of notes) into a real office file — see backend's doc_service.py
// for the structuring step per format. `kind` is one of DOC_KINDS' keys.
const DOC_KINDS = {
  pdf: { genPath: "generate-pdf", listPath: "generated-pdfs", metaKey: "pdf_base64" },
  excel: { genPath: "generate-excel", listPath: "generated-excels", metaKey: "xlsx_base64" },
  word: { genPath: "generate-word", listPath: "generated-words", metaKey: "docx_base64" },
  ppt: { genPath: "generate-ppt", listPath: "generated-ppts", metaKey: "pptx_base64" },
  table: { genPath: "generate-table-image", listPath: "generated-table-images", metaKey: "tableimg_base64" },
  chart: { genPath: "generate-chart", listPath: "generated-charts", metaKey: "chart_base64" },
};

async function generateDoc(kind, rawData, title, mode) {
  const { genPath, metaKey } = DOC_KINDS[kind];
  const headers = await authHeaders();
  const form = new FormData();
  form.append("raw_data", rawData);
  form.append("title", title || "");
  form.append("mode", mode === "work" ? "work" : "friend");
  const res = await axios.post(`${API}/media/${genPath}`, form, { headers });
  return {
    reply: res.data.reply,
    title: res.data.title,
    fileUrl: `data:${res.data.mime_type};base64,${res.data[metaKey]}`,
  };
}

export const generatePdf = (rawData, title, mode) => generateDoc("pdf", rawData, title, mode);
export const generateExcel = (rawData, title, mode) => generateDoc("excel", rawData, title, mode);
export const generateWord = (rawData, title, mode) => generateDoc("word", rawData, title, mode);
export const generatePpt = (rawData, title, mode) => generateDoc("ppt", rawData, title, mode);
export const generateTableImage = (rawData, title, mode) => generateDoc("table", rawData, title, mode);
export const generateChart = (rawData, title, mode) => generateDoc("chart", rawData, title, mode);

async function fetchGeneratedFiles(kind) {
  const { listPath } = DOC_KINDS[kind];
  const headers = await authHeaders();
  const res = await axios.get(`${API}/media/${listPath}`, { headers });
  return (res.data.files || []).map((f) => ({
    id: f.id,
    title: f.title || "",
    fileUrl: `data:${f.mime_type};base64,${f.file_base64}`,
    createdAt: f.created_at,
  }));
}

export const fetchGeneratedPdfs = () => fetchGeneratedFiles("pdf");
export const fetchGeneratedExcels = () => fetchGeneratedFiles("excel");
export const fetchGeneratedWords = () => fetchGeneratedFiles("word");
export const fetchGeneratedPpts = () => fetchGeneratedFiles("ppt");
export const fetchGeneratedTableImages = () => fetchGeneratedFiles("table");
export const fetchGeneratedCharts = () => fetchGeneratedFiles("chart");

async function deleteGeneratedFile(kind, id) {
  const { listPath } = DOC_KINDS[kind];
  const headers = await authHeaders();
  await axios.delete(`${API}/media/${listPath}/${id}`, { headers });
}

export const deleteGeneratedPdf = (id) => deleteGeneratedFile("pdf", id);
export const deleteGeneratedExcel = (id) => deleteGeneratedFile("excel", id);
export const deleteGeneratedWord = (id) => deleteGeneratedFile("word", id);
export const deleteGeneratedPpt = (id) => deleteGeneratedFile("ppt", id);
export const deleteGeneratedTableImage = (id) => deleteGeneratedFile("table", id);
export const deleteGeneratedChart = (id) => deleteGeneratedFile("chart", id);

// `mode` scopes this to that mode's own thread (Arkadaş Modu and LunaWorks
// Modu no longer share one merged conversation) — see backend's
// conversation_engine.history for how "friend" also reclaims pre-split
// legacy history.
export async function fetchMessages(mode, conversationId) {
  const headers = await authHeaders();
  const params = conversationId ? { conversation_id: conversationId } : mode ? { mode } : undefined;
  const res = await axios.get(`${API}/messages`, { headers, params });
  return (res.data.messages || []).map(toWebMessage);
}

// conversationId: the open Sohbetlerim thread, if any — that thread is
// cleared instead of the mode's main one.
export async function clearMessages(mode, conversationId = null) {
  const headers = await authHeaders();
  const params = conversationId ? { conversation_id: conversationId } : mode ? { mode } : undefined;
  await axios.delete(`${API}/messages`, { headers, params });
}

// Luna's voice for (a piece of) a reply, as a blob URL of MP3 audio. The
// voice call asks for a reply sentence by sentence: `turnId` ties the pieces
// (and the turn's speech recognition) together so the server counts ONE
// voice use per turn; `part` is the piece's index. `signal` cancels it. No
// voice is named: the server speaks with Luna's one voice for this account
// (its saved choice, else the default) — the voice of her filler clips and
// her HD calls too (it used to send a hard-coded "coral").
export async function fetchTTS({ text, turnId, part = 0, signal } = {}) {
  const headers = await authHeaders();
  const body = { text, ...(turnId ? { turn_id: turnId, part } : {}) };
  const res = await axios.post(`${API}/tts`, body, { headers, signal });
  const bytes = atob(res.data.audio_base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

// A streamed piece whose audio stops coming for this long is broken: the
// server makes it several times faster than she says it, so a gap this long
// is a stuck stream, never a slow one — and the call must not wait on it.
const TTS_STREAM_IDLE_MS = 8000;

// fetchTTSStream's answer that isn't audio, shaped like the axios error
// fetchTTS gets for the same answer (lib/voicePlayer.js reads its status,
// Retry-After and JSON detail). canFallBack: a server without the streaming
// route — fetchTTS can still get the piece.
async function ttsStreamError(res) {
  let data = "";
  try {
    data = await res.text();
    data = JSON.parse(data);
  } catch (_) {} // (not JSON: the text, as axios gives it)
  const e = new Error(`Request failed with status code ${res.status}`);
  const retryAfter = res.headers.get("Retry-After");
  e.response = { status: res.status, headers: retryAfter ? { "retry-after": retryAfter } : {}, data };
  e.canFallBack = res.status === 404 || res.status === 405;
  return e;
}

// Luna's voice for (a piece of) a reply, streamed: POST /api/tts/stream with
// fetchTTS's body and auth, and its errors (everything the server checks
// happens before any audio). Resolves as soon as the server has the piece's
// first audio, with { reader, rate }: reader.read() gives raw 16-bit
// little-endian mono PCM at `rate` as it is made (lib/voiceAudio.js plays
// it); its clean end is the whole clip, an error a broken one — also when no
// audio came for TTS_STREAM_IDLE_MS (a TimeoutError). Or, when the server
// had the whole clip already (its cache), with { url }: a blob URL of the MP3,
// as fetchTTS's. `signal` cancels it, body included.
export async function fetchTTSStream({ text, turnId, part = 0, signal } = {}) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const body = { text, ...(turnId ? { turn_id: turnId, part } : {}) }; // (as fetchTTS: the server picks her voice)
  const ctl = new window.AbortController();
  let idleTimer = null;
  let timedOut = false;
  const cancel = () => ctl.abort();
  const over = () => {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", cancel);
  };
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener("abort", cancel);

  let reader;
  let type;
  try {
    const res = await fetch(`${API}/tts/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      if (res.status === 401) sessionLost();
      throw await ttsStreamError(res);
    }
    type = (res.headers.get("Content-Type") || "").toLowerCase();
    if (type.startsWith("audio/mpeg")) {
      const blob = new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
      over();
      return { url: URL.createObjectURL(blob) };
    }
    reader = type.startsWith("audio/l16") ? res.body?.getReader?.() : null;
    if (!reader) throw Object.assign(new Error(`tts stream: unexpected answer (${type || "no type"})`), { canFallBack: true });
  } catch (e) {
    over();
    ctl.abort(); // (a body nobody will read)
    throw e;
  }

  const stillThere = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, TTS_STREAM_IDLE_MS);
  };
  stillThere();
  return {
    rate: Number(/rate=(\d+)/.exec(type)?.[1]) || 24000,
    reader: {
      async read() {
        try {
          const got = await reader.read();
          if (got.done) over();
          else stillThere();
          return got;
        } catch (e) {
          over();
          throw timedOut ? Object.assign(new Error("timeout"), { name: "TimeoutError" }) : e;
        }
      },
      cancel() {
        over();
        ctl.abort();
        return Promise.resolve().then(() => reader.cancel?.()).catch(() => {});
      },
    },
  };
}

// Server-side speech recognition for one recorded utterance (the voice
// call's fallback when the browser has no speech recognition of its own, or
// it fails). Returns the text ("" when nothing was said). `turnId` as in
// fetchTTS.
export async function transcribeAudio(blob, { turnId, signal } = {}) {
  const headers = await authHeaders();
  const type = (blob.type || "").split(";")[0];
  const ext = { "audio/mp4": "m4a", "audio/aac": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" }[type] || "webm";
  const form = new FormData();
  form.append("audio", blob, `speech.${ext}`);
  if (turnId) form.append("turn_id", turnId);
  const res = await axios.post(`${API}/stt`, form, { headers, signal });
  return (res.data?.text || "").trim();
}

// ---- HD voice calls (backend routers/realtime_voice.py, lib/realtimeCall.js)

// Whether this account can start an HD call now, and the voice Luna speaks
// with: { available, reason, voice, model, minutes_left, ... }. null when
// the server can't be asked (the call then uses the classic voice).
export async function fetchRealtimeStatus() {
  try {
    const headers = await authHeaders();
    const res = await axios.get(`${API}/voice/realtime/status`, { headers, timeout: 8000 });
    return res.data && typeof res.data === "object" ? res.data : null;
  } catch {
    return null;
  }
}

// Mints the call's short-lived client secret: { session_id, client_secret,
// calls_url, max_seconds, heartbeat_seconds, greet, session_update, voice }.
// Rejects with the axios error (403 plan, 429 minutes, 503 busy — its
// X-Luna-Realtime header says which).
export async function startRealtimeVoice({ mode, conversationId, lang, signal } = {}) {
  const headers = await authHeaders();
  const body = {
    mode: mode === "work" ? "work" : "friend",
    conversation_id: conversationId || null,
    language: getReplyLang() || lang || null,
  };
  const res = await axios.post(`${API}/voice/realtime/session`, body, { headers, signal, timeout: 15000 });
  return res.data;
}

// The call's SDP offer, relayed to OpenAI by the server (it keeps the
// client secret and the call id) -> the SDP answer (a string). Rejects with
// the axios error (409: the session is gone or was used, 502: OpenAI
// refused).
export async function connectRealtimeVoice({ sessionId, sdp, signal } = {}) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/voice/realtime/connect`, { session_id: sessionId, sdp },
    { headers, signal, timeout: 20000 });
  return typeof res.data?.sdp === "string" ? res.data.sdp : "";
}

// One of Luna's tools in an HD call (a reminder, a note), run by the server
// (backend routers/agent_actions.py) -> { output: the JSON text she reads,
// actions: the chat's cards }.
export async function runAgentToolCall({ name, arguments: args = "{}", conversationId = null } = {}) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/agent/tool-call`,
    { name, arguments: typeof args === "string" ? args : JSON.stringify(args || {}), conversation_id: conversationId || null },
    { headers, timeout: 20000 });
  const data = res.data && typeof res.data === "object" ? res.data : {};
  return { output: typeof data.output === "string" ? data.output : "", actions: Array.isArray(data.actions) ? data.actions : [] };
}

// The call's finished turns ([{role, text, item_id}]) — also its heartbeat
// (no turns). Answers { safety?, instructions_update?, tools_off?,
// seconds_left?, stop?, stop_reason? }.
export async function sendRealtimeTranscript({ sessionId, turns = [] } = {}) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/voice/realtime/transcript`, { session_id: sessionId, turns },
    { headers, timeout: 15000 });
  return res.data || {};
}

// The end of the call, with its last turns — keepalive: it still goes when
// the page is closing (closing the tab ends the call).
export async function endRealtimeVoice({ sessionId, turns = [], reason = "user", usage = null } = {}) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(`${API}/voice/realtime/end`, {
    method: "POST",
    headers,
    keepalive: true,
    body: JSON.stringify({ session_id: sessionId, turns, reason, ...(usage ? { usage } : {}) }),
  });
  if (!res.ok) throw new Error(`realtime end failed: ${res.status}`);
  return res.json().catch(() => ({}));
}

export async function fetchMemories() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/memories`, { headers });
  return { memories: (res.data.memories || []).map(toWebMemory), categories: res.data.categories || [] };
}

export async function addMemory({ title, content, category, tags }) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/memories`, { title, content, category, tags }, { headers });
  return res.data;
}

export async function editMemory(memoryId, fields) {
  const headers = await authHeaders();
  await axios.patch(`${API}/memories/${memoryId}`, fields, { headers });
}

export async function deleteMemory(_sessionId, memoryId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/memories/${memoryId}`, { headers });
}

export async function clearMemories() {
  const headers = await authHeaders();
  await axios.post(`${API}/memories/clear`, null, { headers });
}

// ---- Notlarım ----
export async function fetchNotes(q) {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/notes`, { headers, params: q ? { q } : {} });
  return { notes: res.data.notes || [], categories: res.data.categories || [] };
}
export async function createNote({ title, content, category }) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/notes`, { title, content, category }, { headers });
  return res.data;
}
export async function editNote(noteId, fields) {
  const headers = await authHeaders();
  const res = await axios.patch(`${API}/notes/${noteId}`, fields, { headers });
  return res.data;
}
export async function deleteNote(noteId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/notes/${noteId}`, { headers });
}

// ---- Hedeflerim ----
export async function fetchGoals() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/goals`, { headers });
  return { goals: res.data.goals || [], categories: res.data.categories || [] };
}
// kind: "goal" (long-term, progress) | "plan" (dated, step by step).
// steps: [{ id, text, done }] — progress follows the steps when there are any.
export async function createGoal({ title, category, description, deadline, kind = "goal", steps = [] }) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/goals`, { title, category, description, deadline, kind, steps }, { headers });
  return res.data;
}
export async function editGoal(goalId, fields) {
  const headers = await authHeaders();
  const res = await axios.patch(`${API}/goals/${goalId}`, fields, { headers });
  return res.data;
}
export async function toggleGoal(goalId) {
  const headers = await authHeaders();
  const res = await axios.patch(`${API}/goals/${goalId}/toggle`, null, { headers });
  return res.data;
}
export async function deleteGoal(goalId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/goals/${goalId}`, { headers });
}

// ---- Alarmlar ----
export async function fetchReminders() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/reminders`, { headers });
  return res.data.reminders || [];
}
export async function createReminder({ text, due_at, recurrence }) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/reminders`, { text, due_at, recurrence }, { headers });
  return res.data;
}
export async function cancelReminder(reminderId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/reminders/${reminderId}`, { headers });
}
// A reminder as an .ics file (GET /api/reminders/{id}.ics, backend
// routers/calendar_links.py) — the ".ics indir" button of a reminder card
// (components/MessageExtras.jsx ActionCards). A Blob; errors look like
// axios's (e.response). Only this API's own route gets the device's auth.
export async function fetchReminderIcs(reminderId, { signal } = {}) {
  const id = String(reminderId || "");
  if (!/^[a-f0-9]{24}$/i.test(id)) throw httpLikeError(404, "");
  const headers = await authHeaders();
  const res = await fetch(`${API}/reminders/${id}.ics`, { headers, ...(signal ? { signal } : {}) });
  if (!res.ok) {
    if (res.status === 401) sessionLost();
    throw httpLikeError(res.status, "");
  }
  return res.blob();
}

// ---- Günlük ----
export async function fetchJournal() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/journal`, { headers });
  return { entries: res.data.entries || [], aiSummaries: res.data.ai_summaries || [] };
}
export async function createJournalEntry(content) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/journal`, { content }, { headers });
  return res.data;
}
export async function editJournalEntry(entryId, content) {
  const headers = await authHeaders();
  const res = await axios.patch(`${API}/journal/${entryId}`, { content }, { headers });
  return res.data;
}
export async function deleteJournalEntry(entryId) {
  const headers = await authHeaders();
  await axios.delete(`${API}/journal/${entryId}`, { headers });
}

// ---- Profil ----
export async function fetchProfile() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/profile`, { headers });
  return res.data;
}
export async function updateProfile(fields) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/profile`, fields, { headers });
  return res.data;
}
// date: the viewer's LOCAL "YYYY-MM-DD" (the server's UTC day lags behind
// Turkey between 00:00 and 03:00).
export async function fetchDayInfo(lang, date) {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/day-info`, { headers, params: date ? { lang, date } : { lang } });
  return res.data;
}
export async function fetchUsage() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/usage`, { headers });
  return res.data;
}

// ---- Hesap ----
// Permanently deletes the account and everything tied to it (backend
// routers/account.py::delete_account). On success this browser is signed
// out right here, before anything else can run: the stored device
// credentials now point at a user that no longer exists, and the caller
// must NOT make any further API call after this resolves — with the
// credentials gone, getCredentials() would silently mint a brand-new
// anonymous account. Just redirect away. luna_mode/luna_mood belonged to
// the deleted account too; luna_lang is a device preference and stays.
export async function deleteAccount() {
  const headers = await authHeaders();
  const res = await axios.delete(`${API}/account`, { headers });
  signOut();
  localStorage.removeItem("luna_mode");
  localStorage.removeItem("luna_mood");
  localStorage.removeItem("luna_mood_day");
  localStorage.removeItem("luna_mood_log");
  localStorage.removeItem("luna_reply_lang");
  return res.data; // { ok, deleted }
}

// ---- Premium / Abonelik ----
export async function fetchSubscription() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/subscription`, { headers });
  return res.data;
}
export async function selectPlan(plan) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/subscription/select`, { plan }, { headers });
  return res.data;
}

// Starts a real PayTR card-registration + first-charge request (2026-09-27,
// replaces iyzico — see git history). Returns { merchant_oid, form_fields }:
// form_fields are the signed, card-free fields components/CheckoutModal.jsx
// posts directly to PayTR alongside the raw card fields the user types —
// this backend call never sees or handles card data.
//
// 2026-09-30: `acceptance` carries the two checkout confirmations the user
// ticked in the billing form (Ön Bilgilendirme Formu + Mesafeli Satış
// Sözleşmesi read, and immediate start / cayma hakkı waiver). The backend
// rejects the checkout (400) unless both are true and sales_docs_version
// matches its settings.SALES_DOCS_VERSION, then records them in
// legal_records. Omitting `acceptance` sends false — never a silent "yes".
export const SALES_DOCS_VERSION = "2026-09-30";

export async function checkoutSubscription(plan, billing, acceptance = {}) {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/subscription/checkout`, {
    plan,
    name: billing.name,
    surname: billing.surname,
    email: billing.email,
    phone: billing.phone,
    address: billing.address,
    preinfo_accepted: acceptance.preinfo_accepted === true,
    instant_start_accepted: acceptance.instant_start_accepted === true,
    sales_docs_version: acceptance.sales_docs_version || SALES_DOCS_VERSION,
  }, { headers });
  return res.data;
}

export async function cancelSubscription() {
  const headers = await authHeaders();
  const res = await axios.post(`${API}/subscription/cancel`, {}, { headers });
  return res.data;
}
