// Central language registry — keep in sync with backend's
// config.SUPPORTED_LANGUAGES. flag is a plain emoji (no external assets).
export const LANGUAGES = [
  { code: "tr", label: "Türkçe", flag: "🇹🇷" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
];

export function langLabel(code) {
  return LANGUAGES.find((l) => l.code === code)?.label || code.toUpperCase();
}
