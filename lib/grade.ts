import { CATALOG, catalogById, parseSearchArea, placesMatch, PROPERTY_TYPE_LABELS } from "@/kb/catalog";
import { RENT_PRICE_CEILING } from "@/lib/listing-market";
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
  if (matrix.intent === "rent") return listing.listPrice;
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
      const rent = matrix.intent === "rent";
      return {
        id,
        score,
        unknown: false,
        mustHaveFailed: !!knobs.mustHave && listing.listPrice > cap,
        reason: rent
          ? `$${listing.listPrice.toLocaleString()}/mo vs cap $${cap.toLocaleString()}/mo`
          : `$${listing.listPrice.toLocaleString()} vs cap $${cap.toLocaleString()}`,
      };
    }
    case "pitia_slack": {
      if (matrix.intent === "rent") {
        if (!listing.listPrice) return { id, ...unknownScore(matrix, "Rent unknown"), mustHaveFailed: false };
        const cap =
          matrix.budget.maxPitia ??
          (matrix.budget.maxPrice != null && matrix.budget.maxPrice < RENT_PRICE_CEILING
            ? matrix.budget.maxPrice
            : null);
        if (cap == null) {
          return { id, ...unknownScore(matrix, "Set a monthly rent cap in chat"), mustHaveFailed: false };
        }
        const slack = cap - listing.listPrice;
        const slackTarget = matrix.budget.minMonthlySlack ?? 0;
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
          reason: `Rent $${listing.listPrice.toLocaleString()}/mo vs cap $${cap.toLocaleString()}/mo`,
        };
      }
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

export const TOP_LISTING_COUNT = 10;

export function takeTopListings<T>(rows: T[]): T[] {
  return rows.slice(0, TOP_LISTING_COUNT);
}

export function wordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Slots: fit, home, pluses, catch. Wording is rotated per listing so similar homes do not share a paragraph. */
export const WHY_GRADE_TEMPLATE = "{fit} {home} {plusLine} {catchLine}";

export const WHY_GRADE_FIT: Record<GradeResult["band"], string[]> = {
  superb: [
    "This is one of the closest matches to what you asked for.",
    "Almost everything you named shows up here.",
    "This one sits at the top of the pile for your must-haves.",
  ],
  excellent: [
    "This is a strong match, with only small gaps against your must-haves.",
    "Most of what you asked for lands here, with only minor misses.",
    "A strong fit — the gaps are small next to the rest of this list.",
  ],
  good: [
    "This is a decent match with some real tradeoffs, so it is not at the top of your list.",
    "A workable pick with caveats — not the strongest on this list.",
    "Close on a few must-haves, farther off on others.",
    "Fine to keep in the mix, but the mismatches are why it is not excellent.",
    "Useful, not a standout: a couple of asks landed, a couple did not.",
    "Worth a look, with the tradeoffs you already spelled out in chat.",
  ],
  pass: [
    "This clears the basics but has more mismatches than the stronger homes above it.",
    "It meets the floor, without much that makes it a favorite.",
    "A bare pass — keep it only if the stronger homes fall through.",
  ],
  miss: [
    "Skip this one unless you drop a must-have — it fails something you said you need.",
    "A must-have does not hold here, so it should not jump the rest of the list.",
    "This one breaks a rule you set, even if other parts look fine.",
  ],
  incomplete: [
    "We cannot fairly rank this yet — too many listing facts are still blank.",
    "Too many blanks on the listing to grade this the same way as the others.",
  ],
};

export const WHY_GRADE_INSTRUCTIONS = `When you describe a home, write fit + home + pluses + catch. Never say it is good/excellent "because the score is N". Rotate openers so two similar homes do not start the same way. Keep the blurb over 15 words. Name concrete facts vs must-haves.`;

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(seed: string, options: T[]): T {
  return options[hashString(seed) % options.length];
}

function padWhy(text: string) {
  let out = text.replace(/\s+/g, " ").trim();
  const extra =
    " Compare those facts to your must-haves in chat if you want to change what we treat as a dealbreaker.";
  while (wordCount(out) <= 15) out += extra;
  return out;
}

function typeWord(raw?: string | null) {
  if (!raw) return "home";
  return (PROPERTY_TYPE_LABELS[raw] ?? raw.replace(/_/g, " ")).toLowerCase();
}

function prettyCommunity(raw: string) {
  const cleaned = raw
    .replace(/\bTWNHMS?\b/gi, "")
    .replace(/\bCONDOS?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  return cleaned.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function joinAnd(parts: string[], seed: string) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) {
    return pick(seed + ":join", [
      `${parts[0]}, and ${parts[1]}`,
      `${parts[0]}; ${parts[1]}`,
      `${parts[0]}, plus ${parts[1]}`,
    ]);
  }
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

function factPhrase(d: DimensionScore, tone: "up" | "down", seed: string): string {
  const r = d.reason.replace(/\s+/g, " ").trim();
  if (d.id === "beds") {
    const m = r.match(/^([\d.]+) beds \(min (\d+)\)/i);
    if (m) {
      const have = m[1];
      const min = m[2];
      if (tone === "up" && Number(have) > Number(min)) {
        return pick(seed + ":beds", [
          `${have} bedrooms, above your ${min}-bed floor`,
          `more bedrooms than you required (${have} vs ${min})`,
        ]);
      }
      if (tone === "up") return `${have} bedrooms, matching the ${min} you asked for`;
      return `only ${have} bedrooms, below your ${min}-bed floor`;
    }
  }
  if (d.id === "baths") {
    const m = r.match(/^([\d.]+) baths \(min (\d+)/i);
    if (m) {
      const have = m[1];
      const min = m[2];
      if (tone === "up" && Number(have) > Number(min)) {
        const extras = [`${have} baths, above your ${min}-bath floor`, `${have} bathrooms, which clears your ${min}-bath floor`];
        if (Number(have) === Number(min) + 0.5) extras.push(`an extra half-bath over the ${min} you asked for`);
        return pick(seed + ":baths", extras);
      }
      if (tone === "up") return `${have} baths, matching what you asked for`;
      return `only ${have} baths, below your ${min}-bath floor`;
    }
  }
  if (d.id === "walkable") {
    const counts = r.match(/(\d+) cafés?, (\d+) shops/i);
    if (counts && /walkable/i.test(r)) {
      return pick(seed + ":walk", [
        `a walkable block with ${counts[1]} cafés and ${counts[2]} shops nearby`,
        `cafés and shops in walking distance (${counts[1]} cafés, ${counts[2]} shops)`,
        `errands on foot — ${counts[1]} cafés and ${counts[2]} shops nearby`,
      ]);
    }
    if (/walkable/i.test(r)) return "a walkable location";
    if (counts) return `not very walkable (${counts[1]} cafés, ${counts[2]} shops nearby)`;
    return "a car-dependent location";
  }
  if (d.id === "property_type") {
    const m = r.match(/^(\w+) \(prefer (\w+)\)/i);
    if (m) {
      const have = typeWord(m[1]);
      const want = typeWord(m[2]);
      if (tone === "down" && have !== want) {
        return pick(seed + ":type", [
          `this is a ${have}, and you preferred a ${want}`,
          `you wanted a ${want}; this one is a ${have}`,
          `type mismatch: ${have} instead of ${want}`,
        ]);
      }
      return `this is the ${have} type you asked for`;
    }
  }
  if (d.id === "school_area") {
    if (/outside named neighborhoods/i.test(r)) {
      const name = prettyCommunity(r.replace(/\s+is outside named neighborhoods/i, ""));
      return pick(seed + ":area", [
        `it is in ${name}, which is not one of the neighborhoods you named`,
        `${name} was not on your neighborhood list`,
        `the community (${name}) sits outside the places you named`,
      ]);
    }
    if (/is outside /i.test(r)) return r.replace(/\s+is outside /, " sits outside ");
    if (/matches /i.test(r) || /is in /i.test(r)) return `it is in an area that matches what you named`;
    if (/No neighborhood filter/i.test(r)) return "you did not name specific neighborhoods";
  }
  if (d.id === "long_term") {
    const m = r.match(/Built (\d+) \(~(\d+) yrs; long-term floor (\d+)\)/i);
    if (m) {
      if (tone === "up") {
        return pick(seed + ":year", [
          `it was built in ${m[1]}, newer than your ${m[3]} long-term floor`,
          `a ${m[2]}-year-old building, which clears your long-term cutoff`,
          `newer construction (${m[1]}), which fits a long-term hold`,
        ]);
      }
      return `built in ${m[1]}, older than your ${m[3]} long-term floor`;
    }
  }
  if (d.id === "construction") {
    const m = r.match(/^(\w+) \(prefer (\w+)\)/i);
    if (m && tone === "down") return `construction is ${m[1]}, and you preferred ${m[2]}`;
    if (m) return `${m[1]} construction, which is what you preferred`;
  }
  if (d.id === "price_cap") {
    return tone === "up" ? `the ask is within your budget (${r})` : `the ask is tight vs your budget (${r})`;
  }
  return r.charAt(0).toLowerCase() + r.slice(1);
}

export function explainGrade(
  listing: PropertyListing,
  opts: {
    band: GradeResult["band"];
    total: number | null;
    mustHaveFailed: boolean;
    perDimension: DimensionScore[];
    incompleteReason?: string;
  }
) {
  const seed = listing.id || listing.address;
  const scored = opts.perDimension.filter((d) => d.enabled && d.score != null);
  const failed = opts.perDimension.filter((d) => d.enabled && d.mustHaveFailed);
  const highs = [...scored].sort((a, b) => (b.score as number) - (a.score as number)).slice(0, 2);
  const lows = (failed.length ? failed : [...scored].filter((d) => (d.score as number) < 70))
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 2);
  const beds = listing.beds != null ? `${listing.beds}-bed` : "";
  const type = typeWord(listing.facts.propertyType);
  const priceNum = listing.listPrice ? `$${listing.listPrice.toLocaleString()}` : "";
  const city = listing.city ? ` in ${listing.city}` : "";
  const home = pick(seed + ":home", [
    `${listing.address}${city} is a ${[beds, type].filter(Boolean).join(" ")}${priceNum ? ` listed at ${priceNum}` : ""}.`,
    `This ${[beds, type].filter(Boolean).join(" ")} at ${listing.address} is asking ${priceNum || "an unlisted price"}.`,
    `Listed at ${priceNum || "an unlisted price"}, ${listing.address} is a ${[beds, type].filter(Boolean).join(" ")}${city}.`,
  ]);
  const fitList = WHY_GRADE_FIT[opts.band];
  const fit =
    opts.band === "incomplete" && opts.incompleteReason
      ? `${pick(seed + ":fit", fitList)} ${opts.incompleteReason}`
      : pick(seed + ":fit", fitList);
  const strengths = highs.length
    ? joinAnd(
        highs.map((d) => factPhrase(d, "up", seed)),
        seed + ":s"
      )
    : "nothing scored really stands out yet";
  const tradeoffs = lows.length
    ? joinAnd(
        lows.map((d) => factPhrase(d, "down", seed)),
        seed + ":t"
      )
    : "nothing scored looks like a serious problem";
  const plusLine = pick(seed + ":plus", [
    `What works: ${strengths}.`,
    `Pluses: ${strengths}.`,
    `On the plus side, ${strengths}.`,
    `You'll like that it has ${strengths}.`,
  ]);
  const catchLine = pick(seed + ":catch", [
    `What doesn't: ${tradeoffs}.`,
    `The catch: ${tradeoffs}.`,
    `Holding it back: ${tradeoffs}.`,
    `Tradeoffs: ${tradeoffs}.`,
  ]);
  const layout = pick(seed + ":layout", [
    `${fit} ${home} ${plusLine} ${catchLine}`,
    `${home} ${fit} ${plusLine} ${catchLine}`,
    `${fit} ${plusLine} ${home} ${catchLine}`,
    `${home} ${plusLine} ${catchLine} ${fit}`,
  ]);
  return padWhy(layout);
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
  const band = bandFor(total, mustHaveFailed);
  let incompleteReason: string | undefined;
  if (band === "incomplete") {
    if (!active.length) {
      incompleteReason = "Your must-haves are empty — tell chat the area, beds, baths, and home type, then say you’re ready.";
    } else if (!scored.length) {
      incompleteReason = "This listing is missing the facts those gates need (year, type, price, etc.).";
    } else {
      incompleteReason = "Not enough scored fields for a total yet.";
    }
  }

  return {
    total,
    band,
    mustHaveFailed,
    incompleteReason,
    why: explainGrade(listing, { band, total, mustHaveFailed, perDimension, incompleteReason }),
    perDimension,
    estimatedPitia: pitia,
    monthlySlack,
    costKind: matrix.intent === "rent" ? "rent" : "pitia",
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
