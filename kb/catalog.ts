import type { CatalogDimension, UserMatrix } from "@/lib/types";

export const CATALOG_VERSION = "1.3.0";

export const SCHOOL_AREA_OPTIONS = [
  "Bloomingdale HS",
  "Newsome HS",
  "Riverview HS",
  "FishHawk / Lithia",
  "River Hills",
  "Valrico",
  "Brandon",
  "Other Hillsborough",
] as const;

export const CATALOG: CatalogDimension[] = [
  {
    id: "beds",
    cluster: "must_haves",
    defaultLabel: "Bedrooms",
    description: "Minimum bedroom count. Family default is 2+.",
    requiredFields: ["beds"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: { enabled: false, weight: 10, min: 2, mustHave: true },
    allowedKnobs: ["enabled", "weight", "min", "mustHave", "label"],
  },
  {
    id: "baths",
    cluster: "must_haves",
    defaultLabel: "Bathrooms",
    description: "Minimum bathroom count. Family default is 2+.",
    requiredFields: ["baths"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, min: 2, mustHave: true },
    allowedKnobs: ["enabled", "weight", "min", "mustHave", "label"],
  },
  {
    id: "sqft",
    cluster: "must_haves",
    defaultLabel: "Living square feet",
    description: "Minimum heated living area. Off by default; turn on if a buyer wants 2500+.",
    requiredFields: ["sqft"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, min: 2500, mustHave: false },
    allowedKnobs: ["enabled", "weight", "min", "mustHave", "label"],
  },
  {
    id: "property_type",
    cluster: "must_haves",
    defaultLabel: "Property type",
    description: "Prefer townhouse, condo, single-family, or multi. Set from chat after the buyer names a type.",
    requiredFields: ["facts.propertyType"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: { enabled: false, weight: 10, mustHave: false, prefs: {} },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "garage",
    cluster: "must_haves",
    defaultLabel: "Garage",
    description: "Prefer a garage, especially with a townhouse.",
    requiredFields: ["facts.garage"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "laundry",
    cluster: "must_haves",
    defaultLabel: "In-unit washer / dryer",
    description: "Washer and dryer in the unit, not a shared laundry.",
    requiredFields: ["facts.inUnitLaundry"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: true },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "end_unit",
    cluster: "structure",
    defaultLabel: "End unit / sunlight",
    description: "Prefer end unit for more windows and light (townhouse/condo).",
    requiredFields: ["facts.endUnit"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 6,
    defaultKnobs: { enabled: false, weight: 6, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "stories",
    cluster: "structure",
    defaultLabel: "Stories / special-assessment risk",
    description: "Prefer 3 floors or fewer (FL condo/townhouse inspection and special-assessment rules).",
    requiredFields: ["facts.stories"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: { enabled: false, weight: 10, max: 3, mustHave: true },
    allowedKnobs: ["enabled", "weight", "max", "min", "mustHave", "label"],
  },
  {
    id: "construction",
    cluster: "structure",
    defaultLabel: "Construction (block vs frame)",
    description: "Prefers concrete block over wood frame.",
    requiredFields: ["facts.construction"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: {
      enabled: false,
      weight: 10,
      mustHave: false,
      prefs: { prefer: "block" },
    },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "roof_age",
    cluster: "structure",
    defaultLabel: "Roof age",
    description: "Newer roofs score higher. Default target is under 10 years.",
    requiredFields: ["facts.roofAgeYears"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, max: 10, mustHave: false },
    allowedKnobs: ["enabled", "weight", "max", "mustHave", "label"],
  },
  {
    id: "hvac_age",
    cluster: "structure",
    defaultLabel: "HVAC age",
    description: "Newer HVAC scores higher.",
    requiredFields: ["facts.hvacAgeYears"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 6,
    defaultKnobs: { enabled: false, weight: 6, max: 10 },
    allowedKnobs: ["enabled", "weight", "max", "mustHave", "label"],
  },
  {
    id: "impact_glass",
    cluster: "structure",
    defaultLabel: "Impact glass / shutters",
    description: "Impact windows or shutters for Florida wind.",
    requiredFields: ["facts.impactGlass"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 6,
    defaultKnobs: { enabled: false, weight: 6, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "permits",
    cluster: "structure",
    defaultLabel: "Closed permits",
    description: "Major work (roof/HVAC/windows) permitted and closed.",
    requiredFields: ["facts.permitsClosed"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 4,
    defaultKnobs: { enabled: false, weight: 4 },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "dom",
    cluster: "motivation",
    defaultLabel: "Days on market",
    description: "Longer DOM suggests more seller motivation.",
    requiredFields: ["daysOnMarket"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 4,
    defaultKnobs: { enabled: false, weight: 4, min: 30 },
    allowedKnobs: ["enabled", "weight", "min", "invert", "label"],
  },
  {
    id: "price_cuts",
    cluster: "motivation",
    defaultLabel: "Price cuts",
    description: "More list-price cuts suggest flexibility.",
    requiredFields: ["facts.priceCutCount"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 4,
    defaultKnobs: { enabled: false, weight: 4, min: 1 },
    allowedKnobs: ["enabled", "weight", "min", "label"],
  },
  {
    id: "failed_pending",
    cluster: "motivation",
    defaultLabel: "Failed pending / kick-out",
    description: "A failed pending can mean a motivated relist.",
    requiredFields: ["facts.failedPending"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 4,
    defaultKnobs: { enabled: false, weight: 4 },
    allowedKnobs: ["enabled", "weight", "label"],
  },
  {
    id: "list_vs_jv",
    cluster: "motivation",
    defaultLabel: "List vs county just value",
    description: "List at or below Hillsborough just value scores as better value / possible distress.",
    requiredFields: ["listPrice", "facts.countyJustValue"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 6,
    defaultKnobs: { enabled: false, weight: 6 },
    allowedKnobs: ["enabled", "weight", "label"],
  },
  {
    id: "price_cap",
    cluster: "money",
    defaultLabel: "List price vs budget",
    description: "How the ask compares to your max purchase price.",
    requiredFields: ["listPrice"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "pitia_slack",
    cluster: "money",
    defaultLabel: "PITIA / monthly slack",
    description: "Estimated principal, interest, taxes, insurance vs your max payment and slack target.",
    requiredFields: ["listPrice"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: { enabled: false, weight: 10, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "long_term",
    cluster: "money",
    defaultLabel: "Long-term hold",
    description: "Prefer newer/maintained stock for a 10+ year hold. Uses year built when present.",
    requiredFields: ["yearBuilt"],
    enrichable: false,
    defaultEnabled: false,
    defaultWeight: 5,
    defaultKnobs: { enabled: false, weight: 5, min: 1990 },
    allowedKnobs: ["enabled", "weight", "min", "label"],
  },
  {
    id: "school_area",
    cluster: "location",
    defaultLabel: "School / neighborhood area",
    description: "Match city or named area against the neighborhoods the buyer named in chat. Empty list means anywhere in the general area.",
    requiredFields: ["facts.schoolArea"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 10, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "walkable",
    cluster: "location",
    defaultLabel: "Walkable location",
    description: "Prefer a walkable setting. When lat/lng exist we count nearby cafés and shops; you can still override on the property page.",
    requiredFields: ["facts.walkable", "facts.cafeCount"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: false },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "neighborhood_vibe",
    cluster: "location",
    defaultLabel: "Neighborhood feel",
    description: "Soft filter: sleepy suburb vs walkable local city-center vs busy/strip. Prefer local_center when they want shops nearby but not a hectic area.",
    requiredFields: ["facts.neighborhoodVibe", "facts.cafeCount", "facts.shopCount"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: false, prefs: { prefer: "local_center" } },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "local_amenities",
    cluster: "location",
    defaultLabel: "Walk-to shops / coffee",
    description: "At least one café and everyday shops within a short walk. Counted from OpenStreetMap when the listing has coordinates.",
    requiredFields: ["facts.cafeCount", "facts.shopCount"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 8,
    defaultKnobs: { enabled: false, weight: 8, mustHave: false, prefs: { requireCoffee: false, requireShops: false } },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "flood",
    cluster: "location",
    defaultLabel: "FEMA flood zone",
    description: "FEMA map zone (X vs AE/VE). If they will live in a high zone, set prefs.acceptSfha true and use flood_resilience for actual street/sewage flooding.",
    requiredFields: ["facts.floodZone"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 6,
    defaultKnobs: { enabled: false, weight: 6, mustHave: true, prefs: { acceptSfha: false } },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "flood_resilience",
    cluster: "location",
    defaultLabel: "Drainage / interior flooding",
    description: "Street ponding and sewage backup after ordinary rain — not the FEMA zone. Mark on the property page; listings do not include this.",
    requiredFields: ["facts.drainageQuality", "facts.streetFlooding"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 10,
    defaultKnobs: { enabled: false, weight: 10, mustHave: true },
    allowedKnobs: ["enabled", "weight", "mustHave", "label"],
  },
  {
    id: "hoa_cdd",
    cluster: "location",
    defaultLabel: "HOA / CDD",
    description: "Penalty if HOA or CDD is present and you asked to avoid them.",
    requiredFields: ["facts.hoa", "facts.cdd"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 4,
    defaultKnobs: {
      enabled: false,
      weight: 4,
      prefs: { avoidHoa: false, avoidCdd: false },
    },
    allowedKnobs: ["enabled", "weight", "mustHave", "label", "prefs"],
  },
  {
    id: "seller_credit",
    cluster: "deal",
    defaultLabel: "Seller credit vs price cut",
    description: "Informational preference: closing credit can beat a sticker cut at low down payment.",
    requiredFields: ["facts.sellerCreditPreferred"],
    enrichable: true,
    defaultEnabled: false,
    defaultWeight: 2,
    defaultKnobs: { enabled: false, weight: 2 },
    allowedKnobs: ["enabled", "weight", "label"],
  },
];

export function catalogById(id: string): CatalogDimension | undefined {
  return CATALOG.find((d) => d.id === id);
}

export function defaultMatrix(): UserMatrix {
  const dimensions: UserMatrix["dimensions"] = {};
  for (const dim of CATALOG) {
    dimensions[dim.id] = { ...dim.defaultKnobs, prefs: dim.defaultKnobs.prefs };
  }
  return {
    catalogVersion: CATALOG_VERSION,
    unknownPolicy: "skip",
    searchArea: "",
    intent: "buy",
    budget: {
      downPaymentPct: 5,
      ratePct: 6.5,
      taxRatePct: 1.1,
      insuranceMonthly: 250,
    },
    locationAllowlist: [],
    dimensions,
    manualRubrics: [],
  };
}

const LEGACY_AREAS = ["Valrico", "Brandon", "Bloomingdale HS", "River Hills"];

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  sfr: "Single-family",
  townhouse: "Townhouse",
  condo: "Condo",
  multi: "Multi-family",
};

const PLACE_ALIASES: Record<string, string> = {
  "st pete": "st petersburg",
  "st. pete": "st petersburg",
  "saint petersburg": "st petersburg",
  "st. petersburg": "st petersburg",
  "st petersburg": "st petersburg",
};

export function normalizePlaceName(raw: string) {
  let compact = raw.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  compact = compact
    .replace(/\bsaint petersburg\b/g, "st petersburg")
    .replace(/\bst pete\b/g, "st petersburg");
  return PLACE_ALIASES[compact] ?? compact;
}

export function placesMatch(haystack: string, needle: string) {
  const h = normalizePlaceName(haystack);
  const n = normalizePlaceName(needle);
  if (!h || !n) return false;
  return h.includes(n) || n.includes(h);
}

export function displayCityName(raw: string) {
  const n = normalizePlaceName(raw);
  if (n === "st petersburg") return "St. Petersburg";
  if (n === "clearwater") return "Clearwater";
  return raw.trim();
}

export function isLegacyAllowlist(areas: string[] | undefined) {
  if (!areas || areas.length !== LEGACY_AREAS.length) return false;
  return LEGACY_AREAS.every((a) => areas.includes(a));
}

export function parseSearchArea(searchArea: string): { city: string; state: string } {
  const trimmed = searchArea.trim();
  const m = trimmed.match(/^(.+?)(?:,\s*|\s+)(FL|Florida)$/i) || trimmed.match(/^(.+?),\s*([A-Z]{2})$/i);
  if (!m) return { city: trimmed, state: "" };
  const state = m[2].toUpperCase() === "FLORIDA" ? "FL" : m[2].toUpperCase();
  return { city: m[1].trim(), state };
}

export function formatPropertyType(prefer: string | undefined): string {
  if (!prefer) return "";
  return PROPERTY_TYPE_LABELS[prefer] ?? prefer;
}

export type BaselineGap = { id: string; label: string; value: string; done: boolean };

export function baselineStatus(matrix: UserMatrix): { complete: boolean; gaps: BaselineGap[] } {
  const beds = matrix.dimensions.beds;
  const baths = matrix.dimensions.baths;
  const ptype = matrix.dimensions.property_type;
  const prefer = ptype?.prefs?.prefer ? String(ptype.prefs.prefer) : "";
  const gaps: BaselineGap[] = [
    {
      id: "area",
      label: "General area",
      value: matrix.searchArea || matrix.locationAllowlist.join(", ") || "not set",
      done: Boolean(matrix.searchArea) || matrix.locationAllowlist.length > 0,
    },
    {
      id: "beds",
      label: "Bedrooms",
      value: beds?.enabled && beds.min != null ? `${beds.min}+` : "not set",
      done: Boolean(beds?.enabled && beds.min != null),
    },
    {
      id: "baths",
      label: "Bathrooms",
      value: baths?.enabled && baths.min != null ? `${baths.min}+` : "not set",
      done: Boolean(baths?.enabled && baths.min != null),
    },
    {
      id: "property_type",
      label: "Property type",
      value: ptype?.enabled && prefer ? formatPropertyType(prefer) : "not set",
      done: Boolean(ptype?.enabled && prefer),
    },
  ];
  return { complete: gaps.every((g) => g.done), gaps };
}

export function publicCatalog() {
  return CATALOG.map((d) => ({
    id: d.id,
    cluster: d.cluster,
    defaultLabel: d.defaultLabel,
    description: d.description,
    enrichable: d.enrichable,
    defaultEnabled: d.defaultEnabled,
    defaultWeight: d.defaultWeight,
    allowedKnobs: d.allowedKnobs,
  }));
}
