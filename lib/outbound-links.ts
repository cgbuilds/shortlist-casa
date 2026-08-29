import type { PropertyListing } from "@/lib/types";

export function outboundListingLinks(listing: {
  address: string;
  city: string;
  state: string;
  zip: string;
  listingUrl?: string | null;
}) {
  const q = encodeURIComponent(`${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}`);
  const redfin = listing.listingUrl || `https://www.redfin.com/stingray/do/location-search?location=${q}`;
  return [
    { name: "Redfin", href: redfin },
    { name: "Zillow", href: `https://www.zillow.com/homes/${q}_rb/` },
  ];
}

export function linksForListing(listing: PropertyListing) {
  return outboundListingLinks(listing);
}
