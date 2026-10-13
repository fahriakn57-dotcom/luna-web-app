// The server's own explanation of a refused request, for the error toast —
// instead of a generic "küçük bir sorun yaşadım, tekrar dener misin?" that
// is wrong for exactly these answers:
// - 403: e.g. picture making paused after repeated content-rule refusals —
//   "try again" only extends the pause;
// - 413: the typed message is too long ("Mesajın çok uzun..."), too many
//   files at once, or the file too big;
// - 422: the request can't be done as asked — e.g. the text sent with a
//   file is too long (code "caption_too_long", 8.000 characters), a picture
//   refused under the content rules ("image_refused"), a scanned PDF over
//   its page cap, or a body the server couldn't read;
// - 429: a plan quota (lib/api.js callers keep their own rate-limit text).
// Only a readable sentence counts: FastAPI's validation list, an internal
// code ("internal_error", "tts_busy") or an HTML error page never reaches
// the user.
export const DETAIL_STATUSES = [403, 413, 422, 429];

const MAX_DETAIL_CHARS = 400;

export function serverDetail(e, statuses = DETAIL_STATUSES) {
  const status = e?.response?.status;
  if (!statuses.includes(status)) return null;
  const detail = e?.response?.data?.detail;
  if (typeof detail !== "string") return null;
  const text = detail.trim();
  if (!text || text.length > MAX_DETAIL_CHARS) return null;
  if (/^[a-z0-9_.:-]+$/.test(text)) return null; // a machine code, not a sentence
  if (/^\s*</.test(text)) return null; // markup
  return text;
}
