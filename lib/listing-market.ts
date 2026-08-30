import type { ListingIntent, ListingMarket, PropertyListing } from "@/lib/types";

/** Ask prices below this are treated as monthly rent, not a sale price. */
export const RENT_PRICE_CEILING = 20_000;

export function listingMarket(
  listing: Pick<PropertyListing, "market" | "status" | "saleType"> & { listPrice?: number | null }
): ListingMarket {
  if (listing.market === "rental" || listing.market === "sale") return listing.market;
  const blob = `${listing.status ?? ""} ${listing.saleType ?? ""}`.toLowerCase();
  if (/\brent/.test(blob)) return "rental";
  if (listing.listPrice != null && listing.listPrice > 0 && listing.listPrice < RENT_PRICE_CEILING) {
    return "rental";
  }
  return "sale";
}

export function marketFromIntent(intent?: ListingIntent | null): ListingMarket {
  return intent === "rent" ? "rental" : "sale";
}

export function formatAskPrice(
  listing: Pick<PropertyListing, "market" | "status" | "saleType"> & { listPrice?: number | null }
) {
  if (listing.listPrice == null) return "";
  const n = `$${listing.listPrice.toLocaleString()}`;
  return listingMarket(listing) === "rental" ? `${n}/mo` : n;
}

export function marketLabel(market: ListingMarket) {
  return market === "rental" ? "For rent" : "For sale";
}

export function inferMarketFromCsv(status?: string | null, saleType?: string | null): ListingMarket {
  const blob = `${status ?? ""} ${saleType ?? ""}`.toLowerCase();
  if (/\brent/.test(blob)) return "rental";
  return "sale";
}
