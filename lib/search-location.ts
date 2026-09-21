import { displayCityName, normalizePlaceName } from "@/kb/catalog";

export const SCHOOL_POINT_RADIUS_MILES = 8;
export const NEIGHBORHOOD_RADIUS_MILES = 10;

const SCHOOL_POINT =
  /\b([A-Za-z][A-Za-z0-9 .'-]{0,40}?(?:preparatory(?: school)?|prep(?:aratory)?(?: school)?|high school|elementary(?: school)?|middle school|academy))\b/i;

const GENERIC_IN =
  /\bis in\s+([A-Za-z0-9][A-Za-z0-9 .''&-]{1,40}?)(?:\s+so\b|[.,]|$)/i;

export type ParsedSearchLocation = {
  searchArea: string;
  locationAllowlist: string[];
  searchZip: string;
  searchPoint: string;
};

function titleCasePlace(raw: string) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bHs\b/g, "HS")
    .replace(/\bFl\b/g, "FL");
}

export function extractSearchZip(text: string): string {
  const labeled = text.match(/\b(?:search\s+)?zip(?:\s*code)?\s*(?:is|to|:)?\s*(\d{5})\b/i);
  if (labeled) return labeled[1];
  const around = text.match(/\b(?:around|near|in|at)\s+(\d{5})\b/i);
  if (around) return around[1];
  const fl = text.match(/\b(3[2-4]\d{3})\b/);
  if (fl) return fl[1];
  return "";
}

export function extractSearchPoint(text: string): string {
  const m = text.match(SCHOOL_POINT);
  if (!m) return "";
  const name = titleCasePlace(m[1]);
  if (/^(high school|elementary school|middle school|academy|prep)$/i.test(name)) return "";
  return name;
}

function extractMentionedPlace(text: string): string {
  const inPlace = text.match(GENERIC_IN);
  if (inPlace) {
    const name = titleCasePlace(inPlace[1]);
    if (!/^(that area|the area|town|the neighborhood|a flood zone|flood)$/i.test(name)) return name;
  }
  const citySt = text.match(/\b([A-Za-z][A-Za-z .']{1,40}),\s*(FL|Florida|TX|CA|GA|NC|SC|AL|TN)\b/i);
  if (citySt) {
    const st = citySt[2].toUpperCase() === "FLORIDA" ? "FL" : citySt[2].toUpperCase();
    return `${citySt[1].trim()}, ${st}`;
  }
  if (/\btampa\b/i.test(text)) return "Tampa, FL";
  return "";
}

/** Neighborhoods/CDPs use a short radius; named metros stay wide. Not a place dictionary. */
export function usesLocalRadius(place: string) {
  const n = normalizePlaceName(place.replace(/,.*$/, ""));
  if (!n) return false;
  if (/^(tampa|orlando|miami|jacksonville|st petersburg|clearwater)$/.test(n)) return false;
  return true;
}

export function parseSearchLocation(userText: string): ParsedSearchLocation | null {
  const searchZip = extractSearchZip(userText);
  const searchPoint = extractSearchPoint(userText);
  const mentioned = extractMentionedPlace(userText);

  let searchArea = "";
  if (mentioned.includes(",")) searchArea = mentioned;
  else if (mentioned) searchArea = `${mentioned}, FL`;
  else if (searchPoint) searchArea = `${searchPoint}, FL`;
  else if (searchZip) searchArea = searchZip;

  if (!searchArea && !searchZip && !searchPoint) return null;

  return {
    searchArea,
    locationAllowlist: [],
    searchZip,
    searchPoint,
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
  const parts: string[] = [];
  if (opts.searchPoint) parts.push(opts.searchPoint);
  if (areaCity && !areaIsZip && areaCity.toLowerCase() !== (opts.searchPoint || "").toLowerCase()) {
    parts.push(displayCityName(areaCity));
  }
  if (opts.searchZip) parts.push(opts.searchZip);
  else if (!parts.length && areaCity) parts.push(displayCityName(areaCity));
  const joined = parts.join(", ");
  if (/\b[A-Z]{2}$/.test(joined) || opts.searchZip) return joined;
  return `${joined}, ${state}`;
}
