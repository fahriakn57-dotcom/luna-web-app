// The plan catalog as the app shows it (GET /api/subscription's `catalog`,
// backend routers/subscription.py PLAN_CATALOG) — used by
// components/PremiumPanel.jsx.
import { uiLang } from "./i18n";

// A plan's feature lines in the interface language: the server's English
// copy (features_en) on an English screen, its Turkish copy otherwise — and
// the Turkish one when an older server sends no English.
export function planFeatures(plan, lang) {
  const tr = Array.isArray(plan?.features) ? plan.features : [];
  const en = Array.isArray(plan?.features_en) ? plan.features_en : [];
  return uiLang(lang) === "en" && en.length ? en : tr;
}

// The price as the interface writes numbers: 199.9 -> "₺199,90" (Turkish)
// or "₺199.90" (English) — a raw JS number would render "₺199.9". A free
// plan (price_try 0) is just "₺0". Plans without a TRY price fall back to
// the old USD display.
export function formatPlanPrice(plan, lang = "tr") {
  if (plan?.price_try == null) return `$${plan?.price_usd ?? 0}`;
  if (plan.price_try === 0) return "₺0";
  const locale = uiLang(lang) === "tr" ? "tr-TR" : "en-US";
  return `₺${Number(plan.price_try).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
