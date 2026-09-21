import type { GradeResult, PropertyListing, UserMatrix } from "@/lib/types";

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haystack(listing: PropertyListing) {
  return norm(`${listing.city} ${listing.state} ${listing.neighborhood ?? ""} ${listing.address} ${listing.zip ?? ""}`);
}

const TAMPA_METRO = /\b(tampa|valrico|lithia|brandon|riverview|bloomingdale|plant city|seffner|dover|town n country|westchase|carrollwood)\b/;

/** Strict fit check for the bundled sample list only — not for a live or uploaded set. */
export function sampleListingFits(
  listing: PropertyListing,
  matrix: UserMatrix,
  grade?: Pick<GradeResult, "mustHaveFailed"> | null
) {
  if (grade?.mustHaveFailed) return false;

  const hay = haystack(listing);
  if (matrix.searchZip) {
    if (listing.zip && listing.zip !== matrix.searchZip) return false;
  } else if (matrix.locationAllowlist.length) {
    const hit = matrix.locationAllowlist.some((place) => {
      const p = norm(place);
      return p.length >= 3 && (hay.includes(p) || p.includes(norm(listing.city)));
    });
    if (!hit) return false;
  } else if (matrix.searchArea?.trim()) {
    const asked = norm(matrix.searchArea.split(",")[0] ?? "");
    if (asked.length >= 3) {
      const cityHit = hay.includes(asked) || asked.includes(norm(listing.city));
      const tampaAsk = /\btampa\b/.test(asked);
      if (!cityHit && !(tampaAsk && TAMPA_METRO.test(hay))) return false;
    }
  }

  const beds = matrix.dimensions.beds;
  if (beds?.enabled && beds.min != null && (listing.beds ?? 0) < beds.min) return false;
  const baths = matrix.dimensions.baths;
  if (baths?.enabled && baths.min != null && (listing.baths ?? 0) < baths.min) return false;
  const cap = matrix.budget.maxPrice;
  if (cap && listing.listPrice && listing.listPrice > cap) return false;
  const type = matrix.dimensions.property_type;
  const prefer = type?.prefs?.prefer;
  if (type?.enabled && prefer && listing.facts.propertyType && listing.facts.propertyType !== prefer) return false;
  if (matrix.intent === "rent") return false;

  return true;
}
