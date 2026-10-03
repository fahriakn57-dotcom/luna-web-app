import axios from "axios";

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

async function authHeaders() {
  const { id, secret } = await getCredentials();
  return { "X-Device-Id": id, "X-Device-Secret": secret };
}

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
    // the help card with the emergency numbers stays under it after a reload.
    safety: meta.safety ? { kind: meta.safety } : undefined,
  };
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
// interface language.
function chatBody({ message, mode, lang, conversationId, voice, mood }) {
  return {
    text: message,
    mode: mode === "work" ? "work" : "friend",
    conversation_id: conversationId || null,
    voice: !!voice,
    language: getReplyLang() || lang,
    ...(mood ? { mood } : {}),
  };
}

// idempotencyKey: sent as X-Idempotency-Key — a turn asked again under the
// same key is answered once (a repeat gets that answer replayed, or 409
// while it is still being written). See streamVoiceChat. signal: cancels it
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
export async function sendChat({ message, mode, lang, conversationId, voice = false, mood = null, idempotencyKey = null, signal = null, onSafety = null }) {
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
  return res.data.reply;
}

// ---- A spoken turn, streamed ----
// The voice call's reply as it is being written, so Luna can start talking
// at her first sentence instead of after the whole reply: POST
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
// key) is safe. Gives up when no data arrives for STREAM_IDLE_MS — the call
// is waiting in silence meanwhile, so a stalled stream is called off soon
// (the server sends no keep-alives: this also bounds the wait for the first
// bit of the reply, which normally comes within a few seconds).
const STREAM_IDLE_MS = 15000;

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

export async function streamVoiceChat({ message, mode, lang, conversationId, mood = null, signal, onDelta, idempotencyKey = null, onSafety = null }) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json", Accept: "text/event-stream" };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const ctl = new window.AbortController();
  let idleTimer = null;
  let timedOut = false;
  const stillThere = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, STREAM_IDLE_MS);
  };
  const cancel = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener("abort", cancel);
  stillThere();

  let written = "";     // the reply so far, from its deltas
  let deltas = 0;
  let reply = null;     // the whole reply, once it is complete
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
      if (event.safety) {
        try {
          onSafety?.(event.safety);
        } catch (_) {}
      }
    } else if (event?.type === "task_failed") {
      failure = httpLikeError(failedStatus(event), typeof event.detail === "string" ? event.detail : "");
    }
  });

  // Why a stream ended without its reply: our own abort, a timeout, or the
  // connection dropping (e: the network error, if any).
  const brokenOff = (e) => {
    if (signal?.aborted) return e || Object.assign(new Error("canceled"), { name: "AbortError" });
    const err = timedOut ? Object.assign(new Error("timeout"), { name: "TimeoutError" }) : e || new Error("stream ended early");
    // (Never after a timeout: the server may still be writing that reply.)
    err.canFallBack = !timedOut && deltas === 0;
    return err;
  };

  try {
    let res;
    try {
      res = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(chatBody({ message, mode, lang, conversationId, voice: true, mood })),
        signal: ctl.signal,
      });
    } catch (e) {
      throw brokenOff(e);
    }
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
          stillThere();
          read(decoder.decode(value, { stream: true }));
        }
        if (reply !== null || failure) reader.cancel().catch(() => {});
      }
    } catch (e) {
      // (The reply may have been complete before the connection went.)
      if (reply === null && !failure) throw brokenOff(e);
    }
    if (failure) throw failure;
    if (reply === null) throw brokenOff(null);
    return reply;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", cancel);
  }
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
export async function sendMedia(file, text, mode) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("text", text || "");
  form.append("mode", mode === "work" ? "work" : "friend");
  form.append("file", file);
  const res = await axios.post(`${API}/chat/media`, form, { headers });
  return res.data.reply;
}

// Same idea as sendMedia, for up to 10 files in ONE turn (web only — the
// mobile client still uses the single-file /chat/media above, so that route
// is left untouched; see backend/luna/routers/media.py::chat_media_batch).
export async function sendMediaBatch(files, text, mode) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("text", text || "");
  form.append("mode", mode === "work" ? "work" : "friend");
  files.forEach((f) => form.append("files", f));
  const res = await axios.post(`${API}/chat/media-batch`, form, { headers });
  return res.data.reply;
}

// Asks Luna to GENERATE a new image from a text prompt (LunaWorks Modu) —
// distinct from sendMedia above, which sends an EXISTING file for Luna to
// look at. Backend: routers/media.py::generate_image (Gemini image model).
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
// has had Luna draw (see generateImage above), newest first.
export async function fetchGeneratedImages() {
  const headers = await authHeaders();
  const res = await axios.get(`${API}/media/generated-images`, { headers });
  return (res.data.images || []).map((im) => ({
    id: im.id,
    prompt: im.prompt || "",
    imageUrl: `data:${im.mime_type || "image/png"};base64,${im.image_base64}`,
    createdAt: im.created_at,
  }));
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
// voice use per turn; `part` is the piece's index. `signal` cancels it.
export async function fetchTTS({ text, turnId, part = 0, signal } = {}) {
  const headers = await authHeaders();
  const voice = "coral";
  const body = { text, voice, ...(turnId ? { turn_id: turnId, part } : {}) };
  const res = await axios.post(`${API}/tts`, body, { headers, signal });
  const bytes = atob(res.data.audio_base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
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
