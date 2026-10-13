// Central language registry — keep in sync with backend's
// config.SUPPORTED_LANGUAGES. flag is a plain emoji (no external assets).
// speech: the BCP-47 locale the browser's speech recognition listens in.
export const LANGUAGES = [
  { code: "tr", label: "Türkçe", flag: "🇹🇷", speech: "tr-TR" },
  { code: "en", label: "English", flag: "🇬🇧", speech: "en-US" },
  { code: "es", label: "Español", flag: "🇪🇸", speech: "es-ES" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", speech: "de-DE" },
  { code: "ru", label: "Русский", flag: "🇷🇺", speech: "ru-RU" },
  { code: "it", label: "Italiano", flag: "🇮🇹", speech: "it-IT" },
];

export function langLabel(code) {
  return LANGUAGES.find((l) => l.code === code)?.label || String(code || "").toUpperCase();
}

// "de" -> "de-DE"; anything unknown listens in English ("en-US"), as the
// app always did for a non-Turkish interface.
export function speechLocale(code) {
  const base = String(code || "").toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((l) => l.code === base)?.speech || "en-US";
}
