// The app's two languages: the INTERFACE (every screen has Turkish and
// English text — t(tr, en)) and the REPLY language Luna answers in (any of
// lib/languages.js LANGUAGES, chosen in Settings; lib/api.js getReplyLang).
// Luna is used worldwide: someone we know nothing about yet gets the
// interface — and replies — in their browser's language, never a hard-coded
// Turkish default; only a Turkish browser lands on Turkish. An existing
// account signing in on a new browser keeps its OWN language instead
// (accountLanguage below): the browser only speaks for someone new.
import { LANGUAGES } from "./languages";

export const UI_LANGS = ["tr", "en"];
const LANG_KEY = "luna_lang";
const REPLY_LANG_KEY = "luna_reply_lang"; // (lib/api.js REPLY_LANG_KEY)

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

// "de-AT" / "DE" / " de " -> "de"; "" for anything else.
export function baseLang(code) {
  if (typeof code !== "string") return "";
  const m = /^\s*([a-zA-Z]{2,3})(?:[-_][a-zA-Z0-9]+)*\s*$/.exec(code);
  return m ? m[1].toLowerCase() : "";
}

// One of Luna's reply languages, or "" when it isn't one.
export function supportedLang(code) {
  const base = baseLang(code);
  return SUPPORTED.has(base) ? base : "";
}

// The interface language for any language code: Turkish only for Turkish,
// English for everything else (the other reply languages have no interface
// text of their own yet).
export function uiLang(code) {
  return baseLang(code) === "tr" ? "tr" : "en";
}

// t(tr, en) for a language code — the same helper every screen uses, but
// right for "de", "es", ... too (they read English, never Turkish).
export function makeT(lang) {
  const tr = uiLang(lang) === "tr";
  return (trText, enText) => (tr ? trText : enText);
}

// The browser's preferred languages, best first ([] when it says nothing).
function browserLanguages(nav) {
  if (!nav) return [];
  const list = Array.isArray(nav.languages) && nav.languages.length ? nav.languages : [nav.language];
  return list.filter((l) => typeof l === "string" && l);
}

// The first of the browser's languages Luna speaks; "en" when none is (a
// French or Japanese browser gets English, the language most of the world
// can read), "tr" only when the browser itself is Turkish.
export function detectLang(nav = typeof navigator !== "undefined" ? navigator : null) {
  for (const l of browserLanguages(nav)) {
    const code = supportedLang(l);
    if (code) return code;
  }
  return "en";
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice lasts for this visit only
  }
}

// When this browser first opened Luna (ms, by its own clock), stamped on the
// first call — initialUiLang() runs it before anything saves luna_lang. 0
// for a browser that used Luna before it was kept (luna_lang is saved
// already): there nothing about the language changes (accountLanguage).
const FIRST_SEEN_KEY = "luna_first_seen";
export function deviceFirstSeen(now = Date.now()) {
  const raw = read(FIRST_SEEN_KEY);
  const stamped = raw === null || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(stamped) && stamped >= 0) return stamped;
  const stamp = read(LANG_KEY) ? 0 : now;
  write(FIRST_SEEN_KEY, String(stamp));
  return stamp;
}

// Whether the account existed before this browser first opened Luna — an
// existing account signing in on a new (or cleared) browser, not one just
// created here. accountAgeSeconds: GET /api/profile account_age_seconds
// (the server's clock); firstSeen: deviceFirstSeen() (this device's clock),
// so neither clock's skew matters. False when either is unknown.
const SIGN_UP_SLACK_MS = 2 * 60 * 1000;
export function accountPredatesDevice(accountAgeSeconds, firstSeen, now = Date.now()) {
  if (typeof accountAgeSeconds !== "number" || !Number.isFinite(accountAgeSeconds) || accountAgeSeconds < 0) return false;
  if (typeof firstSeen !== "number" || !Number.isFinite(firstSeen) || firstSeen <= 0) return false;
  const deviceAgeMs = Math.max(0, now - firstSeen);
  return accountAgeSeconds * 1000 > deviceAgeMs + SIGN_UP_SLACK_MS;
}

// The account's own language, once GET /api/profile is in (pages/Luna.jsx):
// { reply, ui } — store `reply` as the reply language (lib/api.js
// setReplyLang) and, when `ui` is set, show that interface — or null: the
// device decides, as before (seedReplyLang from the browser). Never over a
// reply language chosen on this device. The account's language counts
//  - when it is not TR/EN: only the Settings picker sets one (on this or
//    another device) — the reply language, the screens stay as they are;
//  - for an existing account signing in on a new browser (accountPredates
//    Device): a Turkish account on a German or English browser stays
//    Turkish — screens, replies, speech — instead of being moved to the
//    browser's language and having that saved over its own with the next
//    message. An account just created here has only the server's default
//    ("tr") and takes the browser's language.
export function accountLanguage(profile, { now = Date.now(), firstSeen = deviceFirstSeen(now) } = {}) {
  if (supportedLang(read(REPLY_LANG_KEY))) return null;
  const server = supportedLang(profile && profile.profile && profile.profile.language);
  if (!server) return null;
  const existing = accountPredatesDevice(profile.account_age_seconds, firstSeen, now);
  if (existing) return { reply: server, ui: uiLang(server) };
  if (!UI_LANGS.includes(server)) return { reply: server, ui: null };
  return null;
}

// An account created on this browser within the last hour (a fresh
// sign-up): the app saves the language it starts with to the profile right
// away (pages/Luna.jsx), so signing in elsewhere later finds the right one
// instead of the server's "tr" default — the first message would save it
// anyway; this covers an account that has not written yet.
const FRESH_ACCOUNT_SECONDS = 60 * 60;
export function justCreatedHere(profile, { now = Date.now(), firstSeen = deviceFirstSeen(now) } = {}) {
  const age = profile && profile.account_age_seconds;
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0 || age > FRESH_ACCOUNT_SECONDS) return false;
  return firstSeen > 0 && !accountPredatesDevice(age, firstSeen, now);
}

// The interface language to start with: the one saved on this device, else
// the browser's. Always "tr" or "en".
export function initialUiLang(nav) {
  deviceFirstSeen();
  const saved = read(LANG_KEY);
  if (saved && supportedLang(saved)) return uiLang(saved);
  return uiLang(detectLang(nav));
}

// The reply language for someone who has never picked one: the one chosen
// on this device, else a saved language other than TR/EN (the old landing
// page saved "de", "es", ... as luna_lang), else the browser's when it is
// one of Luna's, not TR/EN (those follow the interface already), and the
// interface `ui` is the one that browser gets ("en") — someone who switched
// the screens to Turkish wants Turkish, whatever the browser says. null
// when the interface language is right: lib/api.js then sends it, as
// before. Read it before the app rewrites luna_lang.
export function initialReplyLang(ui, nav) {
  const chosen = supportedLang(read(REPLY_LANG_KEY));
  if (chosen) return chosen;
  const saved = supportedLang(read(LANG_KEY));
  if (saved && !UI_LANGS.includes(saved)) return saved;
  const browser = detectLang(nav);
  if (UI_LANGS.includes(browser) || uiLang(ui) !== uiLang(browser)) return null;
  return browser;
}

// Keeps `candidate` (initialReplyLang) as the reply language unless one is
// chosen already — on this device, or on another one through the profile
// (pages/Luna.jsx checks that first). So a first-time German visitor gets
// English screens and German replies without opening Settings. Returns the
// reply language now in effect (null: the interface language).
export function seedReplyLang(candidate) {
  const chosen = supportedLang(read(REPLY_LANG_KEY));
  if (chosen) return chosen;
  const lang = supportedLang(candidate);
  if (!lang || UI_LANGS.includes(lang)) return null;
  write(REPLY_LANG_KEY, lang);
  return lang;
}
