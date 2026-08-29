import { CATALOG, catalogById } from "@/kb/catalog";
import type {
  DimensionScore,
  GradeResult,
  PropertyListing,
  UserMatrix,
} from "@/lib/types";

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function unknownScore(
  matrix: UserMatrix,
  reason: string
): { score: number | null; unknown: true; reason: string } {
  if (matrix.unknownPolicy === "penalize") {
    return { score: 40, unknown: true, reason: `${reason} (unknown penalized)` };
  }
  return { score: null, unknown: true, reason };
}

export function estimatePitia(listing: PropertyListing, matrix: UserMatrix): number | null {
  if (!listing.listPrice) return null;
  const down = (matrix.budget.downPaymentPct ?? 5) / 100;
  const rate = (matrix.budget.ratePct ?? 6.5) / 100 / 12;
  const n = 360;
  const principal = listing.listPrice * (1 - down);
  const pAndI =
    rate === 0 ? principal / n : (principal * rate) / (1 - Math.pow(1 + rate, -n));
  const taxMonthly = (listing.listPrice * ((matrix.budget.taxRatePct ?? 1.1) / 100)) / 12;
  const ins = matrix.budget.insuranceMonthly ?? 250;
  const hoa = listing.facts.hoa ? 80 : 0;
  const cdd = listing.facts.cdd ? 150 : 0;
  return Math.round(pAndI + taxMonthly + ins + hoa + cdd);
}

function scoreNumericMin(value: number, min: number): number {
  if (value >= min * 1.15) return 100;
  if (value >= min) return 80;
  if (value >= min * 0.9) return 50;
  return 20;
}

function scoreAgeMax(age: number, max: number): number {
  if (age <= max * 0.5) return 100;
  if (age <= max) return 80;
  if (age <= max * 1.5) return 45;
  return 15;
}

function scoreDom(dom: number, min: number, invert?: boolean): number {
  const raw = invert
    ? clamp(100 - (dom / Math.max(min, 1)) * 50)
    : clamp((dom / Math.max(min * 2, 1)) * 100);
  return raw;
}

function evaluateDimension(
  id: string,
  listing: PropertyListing,
  matrix: UserMatrix
): Omit<DimensionScore, "enabled" | "weight" | "label"> {
  const knobs = matrix.dimensions[id];
  const dim = catalogById(id);
  if (!knobs || !dim) {
    return { id, score: null, unknown: true, mustHaveFailed: false, reason: "Unknown dimension" };
  }

  switch (id) {
    case "beds": {
      if (listing.beds == null) return { id, ...unknownScore(matrix, "Beds unknown"), mustHaveFailed: !!knobs.mustHave };
      const min = knobs.min ?? 4;
      const score = scoreNumericMin(listing.beds, min);
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.beds < min,
        reason: `${listing.beds} beds (min ${min})`,
      };
    }
    case "baths": {
      if (listing.baths == null) return { id, ...unknownScore(matrix, "Baths unknown"), mustHaveFailed: !!knobs.mustHave };
      const min = knobs.min ?? 2;
      return {
        id,
        score: scoreNumericMin(listing.baths, min),
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.baths < min,
        reason: `${listing.baths} baths (min ${min})`,
      };
    }
    case "sqft": {
      if (listing.sqft == null) return { id, ...unknownScore(matrix, "Sqft unknown"), mustHaveFailed: !!knobs.mustHave };
      const min = knobs.min ?? 2500;
      return {
        id,
        score: scoreNumericMin(listing.sqft, min),
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.sqft < min,
        reason: `${listing.sqft.toLocaleString()} sf (min ${min.toLocaleString()})`,
      };
    }
    case "construction": {
      const c = listing.facts.construction;
      if (!c) return { id, ...unknownScore(matrix, "Construction unknown"), mustHaveFailed: !!knobs.mustHave };
      const prefer = String(knobs.prefs?.prefer ?? "block");
      const score = c === prefer ? 100 : c === "frame" ? 40 : 55;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && c !== prefer,
        reason: `${c} (prefer ${prefer})`,
      };
    }
    case "stories": {
      if (listing.facts.stories == null)
        return { id, ...unknownScore(matrix, "Stories unknown"), mustHaveFailed: !!knobs.mustHave };
      const max = knobs.max ?? 1;
      const stories = listing.facts.stories;
      const score = stories <= max ? 100 : stories === max + 1 ? 50 : 20;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && stories > max,
        reason: `${stories} stor${stories === 1 ? "y" : "ies"} (max ${max})`,
      };
    }
    case "roof_age": {
      if (listing.facts.roofAgeYears == null)
        return { id, ...unknownScore(matrix, "Roof age unknown"), mustHaveFailed: !!knobs.mustHave };
      const max = knobs.max ?? 10;
      const age = listing.facts.roofAgeYears;
      return {
        id,
        score: scoreAgeMax(age, max),
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && age > max,
        reason: `Roof ~${age} yrs (target ≤${max})`,
      };
    }
    case "hvac_age": {
      if (listing.facts.hvacAgeYears == null)
        return { id, ...unknownScore(matrix, "HVAC age unknown"), mustHaveFailed: !!knobs.mustHave };
      const max = knobs.max ?? 10;
      const age = listing.facts.hvacAgeYears;
      return {
        id,
        score: scoreAgeMax(age, max),
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && age > max,
        reason: `HVAC ~${age} yrs (target ≤${max})`,
      };
    }
    case "impact_glass": {
      if (listing.facts.impactGlass == null)
        return { id, ...unknownScore(matrix, "Impact glass unknown"), mustHaveFailed: !!knobs.mustHave };
      const yes = listing.facts.impactGlass;
      return {
        id,
        score: yes ? 100 : 30,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !yes,
        reason: yes ? "Impact glass / shutters" : "No impact protection noted",
      };
    }
    case "permits": {
      if (listing.facts.permitsClosed == null)
        return { id, ...unknownScore(matrix, "Permit status unknown"), mustHaveFailed: !!knobs.mustHave };
      const closed = listing.facts.permitsClosed;
      return {
        id,
        score: closed ? 100 : 35,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !closed,
        reason: closed ? "Major permits closed" : "Open or missing permit history",
      };
    }
    case "dom": {
      if (listing.daysOnMarket == null)
        return { id, ...unknownScore(matrix, "DOM unknown"), mustHaveFailed: false };
      const min = knobs.min ?? 30;
      const score = scoreDom(listing.daysOnMarket, min, knobs.invert);
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: false,
        reason: `${listing.daysOnMarket} DOM`,
      };
    }
    case "price_cuts": {
      if (listing.facts.priceCutCount == null)
        return { id, ...unknownScore(matrix, "Price-cut history unknown"), mustHaveFailed: false };
      const cuts = listing.facts.priceCutCount;
      const min = knobs.min ?? 1;
      const score = cuts <= 0 ? 25 : clamp(50 + cuts * 20);
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && cuts < min,
        reason: `${cuts} price cut(s)`,
      };
    }
    case "failed_pending": {
      if (listing.facts.failedPending == null)
        return { id, ...unknownScore(matrix, "Pending history unknown"), mustHaveFailed: false };
      const failed = listing.facts.failedPending;
      return {
        id,
        score: failed ? 90 : 45,
        unknown: false,
        mustHaveFailed: false,
        reason: failed ? "Prior failed pending" : "No failed pending noted",
      };
    }
    case "list_vs_jv": {
      if (!listing.listPrice || listing.facts.countyJustValue == null)
        return { id, ...unknownScore(matrix, "Just value unknown"), mustHaveFailed: false };
      const ratio = listing.listPrice / listing.facts.countyJustValue;
      let score = 50;
      if (ratio <= 0.95) score = 95;
      else if (ratio <= 1.05) score = 80;
      else if (ratio <= 1.2) score = 55;
      else score = 25;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: false,
        reason: `List ${Math.round(ratio * 100)}% of county JV`,
      };
    }
    case "price_cap": {
      if (!listing.listPrice) return { id, ...unknownScore(matrix, "Price unknown"), mustHaveFailed: !!knobs.mustHave };
      const cap = matrix.budget.maxPrice ?? listing.listPrice;
      const ratio = listing.listPrice / cap;
      const score = ratio <= 0.9 ? 100 : ratio <= 1 ? 80 : ratio <= 1.08 ? 40 : 10;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.listPrice > cap,
        reason: `$${listing.listPrice.toLocaleString()} vs cap $${cap.toLocaleString()}`,
      };
    }
    case "pitia_slack": {
      const pitia = estimatePitia(listing, matrix);
      if (pitia == null) return { id, ...unknownScore(matrix, "Cannot estimate PITIA"), mustHaveFailed: false };
      const max = matrix.budget.maxPitia ?? pitia;
      const slackTarget = matrix.budget.minMonthlySlack ?? 0;
      const slack = max - pitia;
      let score = 50;
      if (slack >= slackTarget && slackTarget > 0) score = 90;
      else if (slack >= 0) score = 70;
      else if (slack >= -300) score = 40;
      else score = 15;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && slack < slackTarget,
        reason: `Est. PITIA $${pitia.toLocaleString()}/mo, slack $${slack.toLocaleString()}`,
      };
    }
    case "school_area": {
      const area = listing.facts.schoolArea;
      if (!area) return { id, ...unknownScore(matrix, "School area unknown"), mustHaveFailed: !!knobs.mustHave };
      const ok =
        matrix.locationAllowlist.length === 0 ||
        matrix.locationAllowlist.some((a) => a.toLowerCase() === area.toLowerCase());
      return {
        id,
        score: ok ? 100 : 20,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !ok,
        reason: ok ? `${area} is in allowlist` : `${area} is outside allowlist`,
      };
    }
    case "hoa_cdd": {
      const avoidHoa = Boolean(knobs.prefs?.avoidHoa);
      const avoidCdd = Boolean(knobs.prefs?.avoidCdd);
      if (listing.facts.hoa == null && listing.facts.cdd == null)
        return { id, ...unknownScore(matrix, "HOA/CDD unknown"), mustHaveFailed: false };
      const hoaHit = avoidHoa && listing.facts.hoa;
      const cddHit = avoidCdd && listing.facts.cdd;
      const hit = Boolean(hoaHit || cddHit);
      const score = !avoidHoa && !avoidCdd ? 70 : hit ? 15 : 100;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && hit,
        reason: hit ? "HOA/CDD conflicts with your avoid list" : "HOA/CDD within preference",
      };
    }
    case "seller_credit": {
      if (listing.facts.sellerCreditPreferred == null)
        return { id, ...unknownScore(matrix, "Seller-credit signal unknown"), mustHaveFailed: false };
      return {
        id,
        score: listing.facts.sellerCreditPreferred ? 80 : 50,
        unknown: false,
        mustHaveFailed: false,
        reason: listing.facts.sellerCreditPreferred
          ? "Listing hints at credits / concessions"
          : "No credit signal",
      };
    }
    default:
      return { id, score: null, unknown: true, mustHaveFailed: false, reason: "Unscored" };
  }
}

function bandFor(total: number | null, mustHaveFailed: boolean): GradeResult["band"] {
  if (mustHaveFailed) return "pass";
  if (total == null) return "incomplete";
  if (total >= 80) return "strong";
  if (total >= 65) return "fit";
  if (total >= 50) return "stretch";
  return "pass";
}

export function grade(listing: PropertyListing, matrix: UserMatrix): GradeResult {
  const perDimension: DimensionScore[] = [];
  for (const dim of CATALOG) {
    const knobs = matrix.dimensions[dim.id] ?? dim.defaultKnobs;
    const evaluated = evaluateDimension(dim.id, listing, matrix);
    perDimension.push({
      ...evaluated,
      enabled: knobs.enabled,
      weight: knobs.weight,
      label: knobs.label ?? dim.defaultLabel,
    });
  }

  for (const rubric of matrix.manualRubrics) {
    perDimension.push({
      id: rubric.id,
      label: rubric.label,
      enabled: true,
      weight: rubric.weight,
      score: null,
      unknown: true,
      mustHaveFailed: false,
      reason: "Manual rubric — score after viewing",
    });
  }

  const active = perDimension.filter((d) => d.enabled);
  const mustHaveFailed = active.some((d) => d.mustHaveFailed);
  const scored = active.filter((d) => d.score != null);
  const weightSum = scored.reduce((s, d) => s + d.weight, 0);
  const total =
    weightSum > 0
      ? Math.round(scored.reduce((s, d) => s + (d.score as number) * d.weight, 0) / weightSum)
      : null;

  const pitia = estimatePitia(listing, matrix);
  const monthlySlack = pitia != null && matrix.budget.maxPitia != null ? matrix.budget.maxPitia - pitia : null;

  return {
    total,
    band: bandFor(total, mustHaveFailed),
    mustHaveFailed,
    perDimension,
    estimatedPitia: pitia,
    monthlySlack,
  };
}

export function applyFactOverrides(
  listing: PropertyListing,
  facts: Partial<PropertyListing["facts"]> & Partial<Pick<PropertyListing, "beds" | "baths" | "sqft" | "listPrice" | "daysOnMarket" | "yearBuilt">>
): PropertyListing {
  return {
    ...listing,
    beds: facts.beds ?? listing.beds,
    baths: facts.baths ?? listing.baths,
    sqft: facts.sqft ?? listing.sqft,
    listPrice: facts.listPrice ?? listing.listPrice,
    daysOnMarket: facts.daysOnMarket ?? listing.daysOnMarket,
    yearBuilt: facts.yearBuilt ?? listing.yearBuilt,
    facts: { ...listing.facts, ...facts },
  };
}
