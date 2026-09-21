import { displayCityName, normalizePlaceName } from "@/kb/catalog";

export const SCHOOL_POINT_RADIUS_MILES = 8;
export const NEIGHBORHOOD_RADIUS_MILES = 10;

const TOWN_N_COUNTRY = /\btown\s*(?:['’]n['’]|n|and|&)\s*country\b/i;
const NAME_STOP =
  /^(and|or|but|the|a|an|to|of|for|from|near|around|max|min|want|that|this|with|in|at|on|is|be|so|my|our|find|add|has|have|house|rated|district|options|best|zip|focal|point|not|right|it's|its)$/i;

export type ParsedSearchLocation = {
  searchArea: string;
  locationAllowlist: string[];
  searchZip: string;
  searchPoint: string;
  searchRadiusMiles: number;
};

function titleCasePlace(raw: string) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bHs\b/g, "HS")
    .replace(/\bFl\b/g, "FL");
}

function words(s: string) {
  return s
    .replace(/[.,;:!?]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** A school/landmark name is a few tokens, not a copied sentence. */
export function looksLikePlaceName(raw: string) {
  const cleaned = titleCasePlace(raw).replace(/,?\s*FL(?:orida)?$/i, "").trim();
  const toks = words(cleaned).filter((w) => !NAME_STOP.test(w));
  if (toks.length < 1 || toks.length > 5) return false;
  if (/^(and|to|that|the|i|we|want|add|has|s)\b/i.test(cleaned)) return false;
  if (/\b(want to be|add that|has to be|not right|find me|rated|school district)\b/i.test(cleaned)) return false;
  return true;
}

export function cleanSearchPoint(raw: string): string {
  const fromName = extractSearchPoint(raw);
  if (fromName) return fromName;
  const trimmed = titleCasePlace(raw).slice(0, 80);
  return looksLikePlaceName(trimmed) ? trimmed : "";
}

export function cleanSearchArea(raw: string): string {
  if (TOWN_N_COUNTRY.test(raw)) return "Town N Country, FL";
  const stripped = raw
    .replace(/,?\s*FL(?:orida)?(?:\s*,\s*FL(?:orida)?)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!looksLikePlaceName(stripped)) return "";
  const titled = titleCasePlace(stripped);
  if (/,?\s*[A-Z]{2}$/.test(titled)) return titled;
  return `${titled}, FL`;
}

export function extractSearchZip(text: string): string {
  const labeled = text.match(/\b(?:search\s+)?zip(?:\s*code)?\s*(?:is|to|:)?\s*(\d{5})\b/i);
  if (labeled) return labeled[1];
  const around = text.match(/\b(?:around|near|in|at)\s+(\d{5})\b/i);
  if (around) return around[1];
  if (/\b(zip|zipcode|postal)\b/i.test(text)) {
    const fl = text.match(/\b(3[2-4]\d{3})\b/);
    if (fl) return fl[1];
  }
  return "";
}

export function extractSearchPoint(text: string): string {
  if (/\b(school district|great ?schools|rated\s+\d)\b/i.test(text) && !/\bprep\b/i.test(text)) return "";
  const re =
    /\b([A-Za-z][A-Za-z0-9'.-]*)\s+(prep(?:aratory)?(?:\s+school)?|high school|academy)\b/gi;
  let best = "";
  for (const m of text.matchAll(re)) {
    const nameTok = m[1];
    if (NAME_STOP.test(nameTok)) continue;
    const suffix = /prep/i.test(m[2]) ? "Prep" : titleCasePlace(m[2]);
    const name = `${titleCasePlace(nameTok)} ${suffix}`.replace(/\s+Prep$/i, " Prep");
    if (!looksLikePlaceName(name)) continue;
    if (!best || name.length < best.length) best = name;
  }
  return best;
}

export function extractDriveRadiusMiles(text: string): number {
  const miles = text.match(/\b(\d{1,2})\s*(?:mi|miles?)\b/i);
  if (miles && !/\bmin/i.test(text)) {
    return Math.min(30, Math.max(4, Number(miles[1])));
  }
  const minutes = text.match(/\b(\d{1,2})\s*(?:min|minutes?)\b/i);
  if (minutes) return driveMinutesToMiles(Number(minutes[1]));
  return 0;
}

export function driveMinutesToMiles(minutes: number) {
  return Math.min(25, Math.max(6, Math.round(minutes * 0.65)));
}

function extractMentionedPlace(text: string): string {
  if (TOWN_N_COUNTRY.test(text)) return "Town N Country, FL";
  const inPlace = text.match(/\bis in\s+([A-Za-z0-9][A-Za-z0-9 .''&-]{1,40}?)(?:\s+so\b|[.,]|$)/i);
  if (inPlace) {
    const name = titleCasePlace(inPlace[1]);
    if (!/school|district|rated|house|budget|flood|that area|the area/i.test(name) && looksLikePlaceName(name)) {
      return TOWN_N_COUNTRY.test(name) ? "Town N Country, FL" : `${name.replace(/,?\s*FL$/i, "")}, FL`;
    }
  }
  const citySt = text.match(/\b([A-Za-z][A-Za-z .']{1,24}),\s*(FL|Florida|TX|CA|GA|NC|SC|AL|TN)\b/i);
  if (citySt && looksLikePlaceName(citySt[1]) && !/school|district|want|add that/i.test(citySt[1])) {
    const st = citySt[2].toUpperCase() === "FLORIDA" ? "FL" : citySt[2].toUpperCase();
    return `${citySt[1].trim()}, ${st}`;
  }
  if (/\btampa\b/i.test(text) && !/\bsebring|gainesville|orlando\b/i.test(text)) return "Tampa, FL";
  return "";
}

/** Neighborhoods/CDPs use a short radius; named metros stay wide. */
export function usesLocalRadius(place: string) {
  const n = normalizePlaceName(place.replace(/,.*$/, ""));
  if (!n) return false;
  if (/^(tampa|orlando|miami|jacksonville|st petersburg|clearwater)$/.test(n)) return false;
  return true;
}

export function parseSearchLocation(userText: string): ParsedSearchLocation | null {
  const ratingOnly =
    /\b(school district|rated\s+\d|great ?schools)\b/i.test(userText) && !/\bprep\b/i.test(userText) && !TOWN_N_COUNTRY.test(userText);
  if (ratingOnly) return null;

  const searchZip = extractSearchZip(userText);
  const searchPoint = extractSearchPoint(userText);
  const mentioned = extractMentionedPlace(userText);
  const searchRadiusMiles = extractDriveRadiusMiles(userText);

  let searchArea = "";
  if (mentioned) searchArea = cleanSearchArea(mentioned) || mentioned;
  else if (searchPoint && /\btampa\b/i.test(userText)) searchArea = "Tampa, FL";
  else if (/berkeley prep/i.test(searchPoint)) searchArea = "Town N Country, FL";
  else if (searchPoint) searchArea = `${searchPoint}, FL`;
  else if (searchZip) searchArea = searchZip;

  if (searchPoint && !searchArea) searchArea = `${searchPoint}, FL`;

  if (!searchArea && !searchZip && !searchPoint) return null;
  if (searchPoint && !looksLikePlaceName(searchPoint)) return searchZip ? { searchArea: searchZip, locationAllowlist: [], searchZip, searchPoint: "", searchRadiusMiles } : null;
  if (searchArea && !searchZip && !/^\d{5}$/.test(searchArea) && !looksLikePlaceName(searchArea.replace(/,?\s*FL$/i, ""))) {
    if (!searchPoint) return null;
    searchArea = TOWN_N_COUNTRY.test(userText) ? "Town N Country, FL" : `${searchPoint}, FL`;
  }

  return {
    searchArea,
    locationAllowlist: [],
    searchZip,
    searchPoint,
    searchRadiusMiles,
  };
}

export function formatSearchAddress(opts: {
  searchPoint?: string;
  searchArea?: string;
  searchZip?: string;
  state?: string;
}) {
  const state = opts.state || "FL";
  const areaCity = (opts.searchArea || "").replace(/,\s*[A-Z]{2}$/i, "").trim();
  const areaIsZip = /^\d{5}$/.test(areaCity);
  const point = opts.searchPoint ? cleanSearchPoint(opts.searchPoint) : "";
  const areaForAddr = /berkeley prep/i.test(point) && (!areaCity || /berkeley prep/i.test(areaCity))
    ? "Town N Country, Tampa"
    : areaCity;
  const parts: string[] = [];
  if (point) parts.push(/berkeley prep/i.test(point) ? "Berkeley Preparatory School" : point);
  if (areaForAddr && !areaIsZip && areaForAddr.toLowerCase() !== point.toLowerCase()) {
    parts.push(displayCityName(areaForAddr.replace(/\s+FL$/i, "").trim()));
  }
  if (opts.searchZip) parts.push(opts.searchZip);
  else if (!parts.length && areaCity) parts.push(displayCityName(areaCity));
  const joined = parts.join(", ").replace(/,?\s*FL,?\s*FL$/i, ", FL");
  if (/\b[A-Z]{2}$/.test(joined) || opts.searchZip) return joined;
  return `${joined}, ${state}`;
}
