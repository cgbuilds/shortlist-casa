export type UnknownPolicy = "skip" | "penalize";

export type ConstructionType = "block" | "frame" | "other";

export type PropertyType = "sfr" | "townhouse" | "condo" | "multi" | "other";

export type NeighborhoodVibe = "sleepy" | "local_center" | "busy";

export type DrainageQuality = "high" | "mixed" | "poor";

export type PropertyFacts = {
  construction?: ConstructionType | null;
  stories?: number | null;
  roofAgeYears?: number | null;
  hvacAgeYears?: number | null;
  impactGlass?: boolean | null;
  permitsClosed?: boolean | null;
  hoa?: boolean | null;
  cdd?: boolean | null;
  schoolArea?: string | null;
  countyJustValue?: number | null;
  failedPending?: boolean | null;
  priceCutCount?: number | null;
  sellerCreditPreferred?: boolean | null;
  propertyType?: PropertyType | null;
  garage?: boolean | null;
  endUnit?: boolean | null;
  inUnitLaundry?: boolean | null;
  floodZone?: string | null;
  sfha?: boolean | null;
  walkable?: boolean | null;
  neighborhoodVibe?: NeighborhoodVibe | null;
  cafeCount?: number | null;
  shopCount?: number | null;
  drainageQuality?: DrainageQuality | null;
  streetFlooding?: boolean | null;
};

export type PropertyListing = {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  listPrice: number | null;
  daysOnMarket: number | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string | null;
  photoUrl?: string | null;
  listingUrl?: string | null;
  hoaMonthly?: number | null;
  neighborhood?: string | null;
  mls?: string | null;
  saleType?: string | null;
  pricePerSqft?: number | null;
  facts: PropertyFacts;
};

export type DimensionKnobs = {
  enabled: boolean;
  weight: number;
  label?: string;
  mustHave?: boolean;
  invert?: boolean;
  min?: number;
  max?: number;
  prefs?: Record<string, string | number | boolean | string[]>;
};

export type ManualRubric = {
  id: string;
  label: string;
  weight: number;
};

export type BudgetSettings = {
  maxPrice?: number;
  maxPitia?: number;
  minMonthlySlack?: number;
  downPaymentPct?: number;
  ratePct?: number;
  taxRatePct?: number;
  insuranceMonthly?: number;
};

export type UserMatrix = {
  catalogVersion: string;
  unknownPolicy: UnknownPolicy;
  searchArea: string;
  budget: BudgetSettings;
  locationAllowlist: string[];
  dimensions: Record<string, DimensionKnobs>;
  manualRubrics: ManualRubric[];
};

export type DimensionScore = {
  id: string;
  label: string;
  enabled: boolean;
  weight: number;
  score: number | null;
  unknown: boolean;
  mustHaveFailed: boolean;
  reason: string;
};

export type GradeResult = {
  total: number | null;
  band: "superb" | "excellent" | "good" | "pass" | "miss" | "incomplete";
  mustHaveFailed: boolean;
  perDimension: DimensionScore[];
  estimatedPitia: number | null;
  monthlySlack: number | null;
};

export type CatalogDimension = {
  id: string;
  cluster: "must_haves" | "structure" | "motivation" | "money" | "location" | "deal";
  defaultLabel: string;
  description: string;
  requiredFields: string[];
  enrichable: boolean;
  defaultEnabled: boolean;
  defaultWeight: number;
  defaultKnobs: DimensionKnobs;
  allowedKnobs: string[];
};
