// Countries for Settings' "Ülke / Country" (profile.country, ISO 3166-1
// alpha-2 — backend services/user_locale.py): web search results, the
// clock in Luna's answers and the crisis help lines follow it. Normally it
// comes on its own from the device's time zone; the user can pick one.
// Names come from the browser (Intl.DisplayNames) in the interface
// language, so no list of 240 names has to ship in two languages.
import { uiLang } from "./i18n";

// Every inhabited ISO 3166-1 country / territory (the codes tzdata's
// iso3166.tab knows — the server accepts no other).
const CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM " +
  "FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM " +
  "JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT " +
  "PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL " +
  "TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

export const COUNTRY_CODES = Object.freeze(CODES);

const cache = {};

function displayNames(lang) {
  const loc = uiLang(lang) === "tr" ? "tr" : "en";
  if (!(loc in cache)) {
    try {
      cache[loc] = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames([loc], { type: "region" }) : null;
    } catch {
      cache[loc] = null;
    }
  }
  return cache[loc];
}

// "DE" -> "Almanya" / "Germany"; the code itself when the browser can't
// name it; "" for no country.
export function countryName(code, lang) {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(c)) return "";
  try {
    return displayNames(lang)?.of(c) || c;
  } catch {
    return c;
  }
}

// [{ code, name }] sorted by name in the interface language.
export function countryOptions(lang) {
  const loc = uiLang(lang) === "tr" ? "tr" : "en";
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, lang) }))
    .sort((a, b) => a.name.localeCompare(b.name, loc));
}
