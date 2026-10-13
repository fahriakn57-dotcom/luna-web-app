// Which optional abilities the server has switched on (GET /api/features,
// backend routers/system.py), asked once per page load and shared:
//   realtime_voice  the voice call may use the speech-to-speech session
//                   (it falls back to the classic call when refused)
//   chat_files      "bunu PDF yap" / "X hakkında sunum hazırla" in chat make
//                   the real file
//   chat_images     "bir kedi çiz" in chat draws it
//   agent_tools     Luna can act in chat (reminders, notes, calendar links);
//                   such a reply carries `actions`
//   web_search      replies may search the web and list their sources
//   code_execution, video   never offered by this app (always false)
//   free_daily_messages / free_daily_voice   the free plan's daily caps
// Anything the server doesn't say — an older server, no connection — is
// off (DEFAULT_FEATURES): the app then simply doesn't offer it.
import { useEffect, useState } from "react";
import { fetchFeatures } from "./api";

export const DEFAULT_FEATURES = Object.freeze({
  email: false,
  sales: true,
  realtime_voice: false,
  chat_files: false,
  chat_images: false,
  agent_tools: false,
  web_search: false,
  code_execution: false,
  video: false,
  languages: [],
  free_daily_messages: null,
  free_daily_voice: null,
});

const FLAGS = ["email", "realtime_voice", "chat_files", "chat_images", "agent_tools", "web_search"];

const positiveInt = (v) => (Number.isInteger(v) && v > 0 && v < 1e9 ? v : null);

// The server's answer, cleaned: a flag is on only when it is exactly true;
// code execution and video stay off whatever is said.
export function normalizeFeatures(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULT_FEATURES };
  for (const key of FLAGS) out[key] = d[key] === true;
  // (an older server without the field meant "open", as PremiumPanel reads it)
  out.sales = d.sales !== false;
  out.languages = Array.isArray(d.languages) ? d.languages.filter((l) => typeof l === "string" && l) : [];
  out.free_daily_messages = positiveInt(d.free_daily_messages);
  out.free_daily_voice = positiveInt(d.free_daily_voice);
  return Object.freeze(out);
}

let pending = null;

// The features, asked once and shared by every caller. A failed ask is
// not kept: the next call asks again.
export function loadFeatures() {
  if (!pending) {
    pending = fetchFeatures().then((raw) => {
      if (!raw) pending = null;
      return normalizeFeatures(raw);
    }, () => {
      pending = null;
      return normalizeFeatures(null);
    });
  }
  return pending;
}

// (tests)
export function resetFeaturesForTest() {
  pending = null;
}

// The features for a component: DEFAULT_FEATURES until the answer arrives.
export function useFeatures() {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  useEffect(() => {
    let alive = true;
    loadFeatures().then((f) => {
      if (alive) setFeatures(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
