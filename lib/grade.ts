import { CATALOG, catalogById, parseSearchArea, placesMatch } from "@/kb/catalog";
import { inferVibe } from "@/lib/osm-amenities";
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
  const hoa = listing.hoaMonthly ?? (listing.facts.hoa ? 80 : 0);
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
      const max = knobs.max ?? 3;
      const type = listing.facts.propertyType;
      if (listing.facts.stories == null) {
        if (type === "sfr") {
          return {
            id,
            score: 85,
            unknown: false,
            mustHaveFailed: false,
            reason: `SFR assumed ≤${max} stories (low special-assessment risk)`,
          };
        }
        return { id, ...unknownScore(matrix, "Stories unknown"), mustHaveFailed: false };
      }
      const stories = listing.facts.stories;
      const score = stories <= max ? 100 : stories === max + 1 ? 40 : 10;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && stories > max,
        reason: `${stories} stor${stories === 1 ? "y" : "ies"} (max ${max} to limit special assessments)`,
      };
    }
    case "property_type": {
      const t = listing.facts.propertyType;
      if (!t) return { id, ...unknownScore(matrix, "Property type unknown"), mustHaveFailed: false };
      const prefer = String(knobs.prefs?.prefer ?? "townhouse");
      const score = t === prefer ? 100 : t === "sfr" && prefer === "townhouse" ? 55 : t === "condo" ? 70 : 40;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && t !== prefer,
        reason: `${t} (prefer ${prefer})`,
      };
    }
    case "garage": {
      if (listing.facts.garage == null)
        return { id, ...unknownScore(matrix, "Garage unknown — fill from the listing"), mustHaveFailed: false };
      return {
        id,
        score: listing.facts.garage ? 100 : 25,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !listing.facts.garage,
        reason: listing.facts.garage ? "Garage" : "No garage",
      };
    }
    case "laundry": {
      if (listing.facts.inUnitLaundry == null)
        return { id, ...unknownScore(matrix, "Laundry unknown — fill from the listing"), mustHaveFailed: false };
      return {
        id,
        score: listing.facts.inUnitLaundry ? 100 : 15,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !listing.facts.inUnitLaundry,
        reason: listing.facts.inUnitLaundry ? "In-unit washer/dryer" : "No in-unit laundry",
      };
    }
    case "end_unit": {
      if (listing.facts.propertyType === "sfr") {
        return { id, score: 70, unknown: false, mustHaveFailed: false, reason: "SFR — end-unit N/A (sunlight typically fine)" };
      }
      if (listing.facts.endUnit == null)
        return { id, ...unknownScore(matrix, "End unit unknown"), mustHaveFailed: false };
      return {
        id,
        score: listing.facts.endUnit ? 100 : 40,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !listing.facts.endUnit,
        reason: listing.facts.endUnit ? "End unit" : "Interior unit",
      };
    }
    case "walkable": {
      const cafes = listing.facts.cafeCount;
      const shops = listing.facts.shopCount;
      const inferred =
        listing.facts.walkable ??
        (cafes != null && shops != null ? cafes >= 1 && shops >= 2 : null);
      if (inferred == null)
        return { id, ...unknownScore(matrix, "Walkability unknown — nearby shops not counted yet"), mustHaveFailed: false };
      return {
        id,
        score: inferred ? 100 : 30,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !inferred,
        reason:
          cafes != null
            ? inferred
              ? `Walkable (${cafes} cafés, ${shops} shops nearby)`
              : `Car-dependent (${cafes} cafés, ${shops} shops nearby)`
            : inferred
              ? "Walkable"
              : "Car-dependent",
      };
    }
    case "neighborhood_vibe": {
      const cafes = listing.facts.cafeCount;
      const shops = listing.facts.shopCount;
      const vibe =
        listing.facts.neighborhoodVibe ??
        (cafes != null && shops != null ? inferVibe(cafes, shops) : null);
      if (!vibe)
        return { id, ...unknownScore(matrix, "Neighborhood feel unknown until shops/cafés are counted"), mustHaveFailed: false };
      const prefer = String(knobs.prefs?.prefer ?? "local_center");
      const labels: Record<string, string> = {
        sleepy: "laid-back / sleepy",
        local_center: "local city-center",
        busy: "busy / high-traffic",
      };
      const score =
        vibe === prefer ? 100 : prefer === "local_center" && vibe === "busy" ? 30 : prefer === "local_center" && vibe === "sleepy" ? 40 : 50;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && vibe !== prefer,
        reason: `${labels[vibe] ?? vibe} (want ${labels[prefer] ?? prefer})`,
      };
    }
    case "local_amenities": {
      const cafes = listing.facts.cafeCount;
      const shops = listing.facts.shopCount;
      if (cafes == null && shops == null)
        return { id, ...unknownScore(matrix, "Nearby cafés/shops not counted yet"), mustHaveFailed: false };
      const coffeeN = cafes ?? 0;
      const shopN = shops ?? 0;
      const needCoffee = Boolean(knobs.prefs?.requireCoffee);
      const needShops = Boolean(knobs.prefs?.requireShops);
      const coffeeOk = !needCoffee || coffeeN >= 1;
      const shopsOk = !needShops || shopN >= 3;
      let score = 40;
      if (coffeeN >= 1 && shopN >= 3) score = 100;
      else if (coffeeN >= 1) score = 75;
      else if (shopN >= 3) score = 60;
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && (!coffeeOk || !shopsOk),
        reason: `${coffeeN} café${coffeeN === 1 ? "" : "s"}, ${shopN} shops within a short walk`,
      };
    }
    case "flood": {
      const zone = listing.facts.floodZone?.toUpperCase() ?? null;
      if (!zone && listing.facts.sfha == null)
        return { id, ...unknownScore(matrix, "Flood zone unknown — check FEMA / listing"), mustHaveFailed: false };
      const high = listing.facts.sfha === true || (zone != null && /^(A|AE|AH|AO|VE|V)/.test(zone));
      const x = zone === "X" || zone === "X500" || zone === "AREA X";
      const acceptSfha = Boolean(knobs.prefs?.acceptSfha);
      if (acceptSfha) {
        return {
          id,
          score: high ? 55 : x ? 90 : 70,
          unknown: false,
          mustHaveFailed: false,
          reason: high
            ? `${zone || "SFHA"} — FEMA high zone accepted; score drainage separately`
            : `Lower FEMA risk (${zone || "not SFHA"})`,
        };
      }
      return {
        id,
        score: high ? 10 : x ? 100 : 60,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && high,
        reason: high ? `Flood risk (${zone || "SFHA"})` : `Lower flood risk (${zone || "not SFHA"})`,
      };
    }
    case "flood_resilience": {
      const drainage = listing.facts.drainageQuality;
      const street = listing.facts.streetFlooding;
      if (drainage == null && street == null)
        return {
          id,
          ...unknownScore(matrix, "Drainage unknown — mark ponding / sewage backup on the property page"),
          mustHaveFailed: false,
        };
      if (drainage === "poor" || street === true) {
        return {
          id,
          score: 15,
          unknown: false,
          mustHaveFailed: !!knobs.mustHave,
          reason: street ? "Street / sewage flooding after rain" : "Poor drainage",
        };
      }
      if (drainage === "high" && street === false) {
        return { id, score: 100, unknown: false, mustHaveFailed: false, reason: "Drains well; no regular street flooding" };
      }
      if (drainage === "high") {
        return { id, score: 85, unknown: false, mustHaveFailed: false, reason: "Good drainage" };
      }
      if (street === false) {
        return { id, score: 75, unknown: false, mustHaveFailed: false, reason: "No regular street flooding noted" };
      }
      return { id, score: 55, unknown: false, mustHaveFailed: false, reason: "Mixed drainage" };
    }
    case "long_term": {
      if (listing.yearBuilt == null)
        return { id, ...unknownScore(matrix, "Year built unknown"), mustHaveFailed: false };
      const min = knobs.min ?? 1990;
      const age = new Date().getFullYear() - listing.yearBuilt;
      return {
        id,
        score: listing.yearBuilt >= min ? (age <= 15 ? 100 : age <= 30 ? 80 : 60) : 35,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.yearBuilt < min,
        reason: `Built ${listing.yearBuilt} (~${age} yrs; long-term floor ${min})`,
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
      const parsed = parseSearchArea(matrix.searchArea || "");
      if (parsed.state && listing.state && listing.state.toUpperCase() !== parsed.state) {
        return {
          id,
          score: 20,
          unknown: false,
          mustHaveFailed: !!knobs.mustHave,
          reason: `${listing.city}, ${listing.state} is outside ${matrix.searchArea}`,
        };
      }
      const area = listing.facts.schoolArea || listing.city;
      if (!area && matrix.locationAllowlist.length) {
        return { id, ...unknownScore(matrix, "School area unknown"), mustHaveFailed: !!knobs.mustHave };
      }
      if (matrix.locationAllowlist.length === 0) {
        return {
          id,
          score: 100,
          unknown: false,
          mustHaveFailed: false,
          reason: matrix.searchArea
            ? `${listing.city} is in ${matrix.searchArea}`
            : "No neighborhood filter",
        };
      }
      const hay = `${area} ${listing.city} ${listing.neighborhood ?? ""}`;
      const ok = matrix.locationAllowlist.some(
        (named) => placesMatch(hay, named) || placesMatch(area ?? "", named)
      );
      return {
        id,
        score: ok ? 100 : 20,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && !ok,
        reason: ok ? `${area} matches ${matrix.locationAllowlist.join(", ")}` : `${area} is outside named neighborhoods`,
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

export function bandFor(total: number | null, mustHaveFailed: boolean): GradeResult["band"] {
  if (mustHaveFailed) return "miss";
  if (total == null) return "incomplete";
  if (total >= 90) return "superb";
  if (total >= 80) return "excellent";
  if (total >= 65) return "good";
  return "pass";
}

export function gradeCaption(grade: Pick<GradeResult, "total" | "band" | "mustHaveFailed">) {
  const score = grade.total == null ? "—" : String(grade.total);
  return { score, word: grade.band };
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
