// Links in Luna's replies: the Markdown renderer's links and autolinked
// URLs (components/Markdown.jsx) and the "Kaynaklar" chips under a searched
// reply (components/MessageExtras.jsx) go through these, so a link is only
// ever an http(s) or mailto address (never javascript:, data: or a relative
// path) and never carries the search engine's tracking parameters
// (?utm_source=openai and friends).

const TRACKING_PARAM = /^(utm_[a-z_]+|fbclid|gclid|mc_eid|mc_cid)$/i;

// The address without its tracking parameters. The text is returned as it
// came when there is nothing to strip (no URL normalisation surprises).
export function stripTracking(url) {
  const raw = String(url || "").trim();
  if (!raw.includes("?")) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return raw;
  }
  const keys = Array.from(parsed.searchParams.keys());
  if (!keys.some((k) => TRACKING_PARAM.test(k))) return raw;
  keys.filter((k) => TRACKING_PARAM.test(k)).forEach((k) => parsed.searchParams.delete(k));
  let out = parsed.toString();
  // "https://a.com/x?" -> "https://a.com/x"
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

// A link Luna may open: http(s) or mailto, tracking stripped — else null.
export function safeHref(url) {
  const raw = String(url || "").trim().replace(/^<|>$/g, "");
  if (!raw || raw.length > 4000) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(raw)) return raw;
  if (!/^https?:\/\/[^\s/?#]+/i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch (_) {
    return null;
  }
  return stripTracking(raw);
}

// "https://www.hurriyet.com.tr/ekonomi/..." -> "hurriyet.com.tr"
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch (_) {
    return "";
  }
}

const MAX_SOURCES = 10;

// The `sources` of a reply ([{title, url}] from /api/chat, the stream's
// assistant_completed or a stored message's meta.web_sources), cleaned for
// display: only safe links, tracking stripped, each page once, at most
// MAX_SOURCES. Each item: { title, url, domain }.
export function normalizeSources(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const url = safeHref(item.url);
    if (!url || url.startsWith("mailto:")) continue;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = hostLabel(url);
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 200) : domain;
    out.push({ title, url, domain });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}
