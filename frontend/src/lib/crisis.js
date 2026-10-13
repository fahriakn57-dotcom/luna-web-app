// The help card's lines (components/CrisisCard.jsx). Since the global
// launch the server sends the user's OWN country's lines with a flagged
// reply (backend services/safety.py client_payload: safety.resources =
// [{label, label_en, labels: {lang: text}, phone} | {..., url}] — Türkiye's
// 112 / ALO 183, the US's 911 / 988, ..., and the international helpline
// directory where the country is unknown), and with a reloaded one too
// (GET /api/messages meta.safety_resources, lib/api.js toWebMessage). Only
// when they are missing — an older server — the card falls back on where
// this DEVICE is, never on the interface language: Türkiye's lines on a
// device set to Türkiye's time zone, the directory and "your local
// emergency number" anywhere else. A Turkish screen in Berlin is not
// Türkiye, and an English screen in Istanbul is.
import { uiLang } from "./i18n";

// Türkiye's lines, exactly as the card always showed them.
export const TR_LINES = {
  self_harm: [{ phone: "112", tr: "Acil yardım", en: "Emergency" }],
  abuse: [
    { phone: "112", tr: "Acil yardım", en: "Emergency" },
    { phone: "183", tr: "ALO 183 Sosyal Destek Hattı", en: "ALO 183 support line" },
  ],
};

export const HELPLINE_DIRECTORY = "https://findahelpline.com";

const PHONE = /^\+?[0-9][0-9 ()-]{0,18}[0-9]$|^[0-9]$/;

function label(r, ui) {
  const own = r.labels && typeof r.labels === "object" ? r.labels[ui] : "";
  const text = own || (ui === "tr" ? r.label : r.label_en || r.label);
  return typeof text === "string" ? text.trim().slice(0, 80) : "";
}

// Türkiye's zones (an old browser may still report the backward links).
const TR_ZONES = new Set(["Europe/Istanbul", "Asia/Istanbul", "Turkey"]);
// Zones that name no place: a browser with no zone set reports one of these.
const PLACELESS = /^(etc\/)?(utc|gmt|universal|zulu|unknown)$|^(factory|localtime)$/i;

// This device's IANA time zone ("Europe/Berlin"), or "" when it has none.
export function deviceTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" ? tz : "";
  } catch (_) {
    return "";
  }
}

// Whether the fallback card is Türkiye's: a device in Türkiye's time zone;
// with no zone that names a place, only a Turkish screen (the server's own
// rule for a Turkish user it knows nothing about, services/user_locale.py).
function inTurkey(timeZone, ui) {
  const tz = typeof timeZone === "string" ? timeZone.trim() : "";
  if (tz && !PLACELESS.test(tz)) return TR_ZONES.has(tz);
  return ui === "tr";
}

// [{ key, label, phone?, tel?, url? }] for the card. kind: "self_harm" |
// "abuse"; resources: the server's list (or nothing); lang: the interface;
// timeZone: where this device is (only read when the list is missing).
export function crisisLines(kind, resources, lang, timeZone = deviceTimeZone()) {
  const ui = uiLang(lang);
  const out = [];
  if (Array.isArray(resources)) {
    for (const r of resources) {
      if (!r || typeof r !== "object") continue;
      const phone = typeof r.phone === "string" ? r.phone.trim() : "";
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (phone && PHONE.test(phone)) {
        out.push({ key: `p-${phone}`, label: label(r, ui), phone, tel: phone.replace(/[^0-9+]/g, "") });
      } else if (/^https:\/\/[^\s"'<>]+$/i.test(url)) {
        out.push({ key: `u-${url}`, label: label(r, ui) || url.replace(/^https:\/\//i, ""), url });
      }
      if (out.length >= 6) break;
    }
    if (out.length) return out;
  }
  if (!TR_LINES[kind]) return [];
  if (inTurkey(timeZone, ui)) {
    return TR_LINES[kind].map((l) => ({ key: `p-${l.phone}`, label: ui === "tr" ? l.tr : l.en, phone: l.phone, tel: l.phone }));
  }
  return [{ key: "u-directory", label: ui === "tr" ? "Ülkendeki destek hatları" : "Helplines in your country", url: HELPLINE_DIRECTORY }];
}

// Whether the card says "call your local emergency number" (it has no
// number of its own to offer: an unknown country, or a reloaded reply).
export function needsLocalEmergencyHint(lines) {
  return Array.isArray(lines) && lines.length > 0 && !lines.some((l) => l.phone);
}
