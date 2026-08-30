import type { PropertyListing } from "@/lib/types";
import { listingMarket } from "@/lib/listing-market";

export function outboundListingLinks(listing: {
  address: string;
  city: string;
  state: string;
  zip: string;
  listingUrl?: string | null;
  listPrice?: number | null;
  status?: string | null;
  saleType?: string | null;
  market?: PropertyListing["market"];
}) {
  const q = encodeURIComponent(`${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}`);
  const rent = listingMarket(listing) === "rental";
  const redfin =
    listing.listingUrl ||
    (rent
      ? `https://www.redfin.com/stingray/do/location-search?location=${q}&v=2&market=rental`
      : `https://www.redfin.com/stingray/do/location-search?location=${q}`);
  return [
    { name: "Redfin", href: redfin },
    {
      name: "Zillow",
      href: rent
        ? `https://www.zillow.com/homes/for_rent/${q}_rb/`
        : `https://www.zillow.com/homes/for_sale/${q}_rb/`,
    },
  ];
}

export function linksForListing(listing: PropertyListing) {
  return outboundListingLinks(listing);
}
