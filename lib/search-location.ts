import { displayCityName, normalizePlaceName } from "@/kb/catalog";

export const SCHOOL_POINT_RADIUS_MILES = 8;
export const NEIGHBORHOOD_RADIUS_MILES = 10;

const TOWN_N_COUNTRY = /\btown\s*(?:['’]n['’]|n|and|&)\s*country\b/i;

const NAMED_PLACES: Array<[RegExp, string]> = [
  [TOWN_N_COUNTRY, "Town N Country"],
  [/\bbloomingdale\b/i, "Bloomingdale"],
  [/\briver hills\b/i, "River Hills"],
  [/\bvalrico\b/i, "Valrico"],
  [/\bbrandon\b/i, "Brandon"],
  [/\bst\.?\s*pete(?:rsburg)?\b/i, "St. Petersburg"],
  [/\bclearwater\b/i, "Clearwater"],
  [/\blithia\b/i, "Lithia"],
  [/\briverview\b/i, "Riverview"],
  [/\bwestchase\b/i, "Westchase"],
  [/\bcarrollwood\b/i, "Carrollwood"],
];

const LOCAL_RADIUS_PLACES = new Set(
  [
    "town n country",
    "westchase",
    "carrollwood",
    "citrus park",
    "bloomingdale",
    "river hills",
    "fishhawk",
    "fishhawk / lithia",
  ].map((p) => normalizePlaceName(p))
);

const SCHOOL_POINT =
  /\b([A-Za-z][A-Za-z0-9 .'-]{0,40}?(?:preparatory(?: school)?|prep(?:aratory)?(?: school)?|high school|elementary(?: school)?|middle school|academy))\b/i;

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

export function extractNamedPlaces(text: string): string[] {
  const named: string[] = [];
  for (const [re, label] of NAMED_PLACES) {
    if (re.test(text)) named.push(label);
  }
  return named;
}

export function usesLocalRadius(place: string) {
  return LOCAL_RADIUS_PLACES.has(normalizePlaceName(place.replace(/,.*$/, "")));
}

export function parseSearchLocation(userText: string): ParsedSearchLocation | null {
  const searchZip = extractSearchZip(userText);
  const searchPoint = extractSearchPoint(userText);
  const namedPlaces = extractNamedPlaces(userText);

  let searchArea = "";
  const citySt = userText.match(/\b([A-Za-z][A-Za-z .']{1,40}),\s*(FL|Florida|TX|CA|GA|NC|SC|AL|TN)\b/i);
  if (citySt && !TOWN_N_COUNTRY.test(citySt[1])) {
    const st = citySt[2].toUpperCase() === "FLORIDA" ? "FL" : citySt[2].toUpperCase();
    searchArea = `${citySt[1].trim()}, ${st}`;
  } else if (namedPlaces.some((p) => /petersburg|clearwater/i.test(p))) {
    const primary =
      namedPlaces.find((p) => /petersburg/i.test(p)) ??
      namedPlaces.find((p) => /clearwater/i.test(p)) ??
      namedPlaces[0];
    searchArea = `${primary}, FL`;
  } else if (/\btampa\b/i.test(userText) && !TOWN_N_COUNTRY.test(userText) && !searchPoint) {
    searchArea = "Tampa, FL";
  } else if (namedPlaces.length) {
    searchArea = `${namedPlaces[0]}, FL`;
  } else if (searchPoint) {
    searchArea = `${searchPoint}, FL`;
  } else if (searchZip) {
    searchArea = searchZip;
  }

  if (!searchArea && !searchZip && !searchPoint) return null;

  const metroCity = searchArea.split(",")[0]?.trim().toLowerCase() ?? "";
  const locationAllowlist = namedPlaces.filter((p) => {
    const n = p.toLowerCase();
    return n !== metroCity && !usesLocalRadius(p);
  });

  return { searchArea, locationAllowlist, searchZip, searchPoint };
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
