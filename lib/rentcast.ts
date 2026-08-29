import { findRedfinListing } from "@/lib/redfin-csv";
import { SEED_LISTINGS, slugAddress } from "@/data/listings";
import type { PropertyListing } from "@/lib/types";

type RentCastListing = {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  price?: number;
  daysOnMarket?: number;
  latitude?: number;
  longitude?: number;
  status?: string;
  propertyType?: string;
};

function hasRentCastKey() {
  return Boolean(process.env.RENTCAST_API_KEY);
}

function toListing(raw: RentCastListing, extra?: Partial<PropertyListing>): PropertyListing {
  const address = raw.addressLine1 || raw.formattedAddress || "Unknown address";
  const city = raw.city || "";
  const state = raw.state || "";
  const zip = raw.zipCode || "";
  return {
    id: raw.id || slugAddress(address, city, state),
    address,
    city,
    state,
    zip,
    beds: raw.bedrooms ?? null,
    baths: raw.bathrooms ?? null,
    sqft: raw.squareFootage ?? null,
    yearBuilt: raw.yearBuilt ?? null,
    listPrice: raw.price ?? null,
    daysOnMarket: raw.daysOnMarket ?? null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    status: raw.status,
    facts: extra?.facts ?? {},
  };
}

async function rentcast(path: string) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("RENTCAST_API_KEY missing");
  const res = await fetch(`https://api.rentcast.io/v1${path}`, {
    headers: { Accept: "application/json", "X-Api-Key": key },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RentCast ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export type SearchQuery = {
  city?: string;
  state?: string;
  zip?: string;
  status?: string;
  minBeds?: number;
  minSqft?: number;
  maxPrice?: number;
  address?: string;
};

export async function searchListings(query: SearchQuery): Promise<{
  listings: PropertyListing[];
  source: "rentcast" | "seed";
  notice?: string;
}> {
  if (query.address) {
    const one = await lookupByAddress(query.address);
    return one
      ? { listings: [one.listing], source: one.source, notice: one.notice }
      : { listings: [], source: hasRentCastKey() ? "rentcast" : "seed" };
  }

  if (hasRentCastKey()) {
    const params = new URLSearchParams({ status: query.status || "Active", limit: "20" });
    if (query.city) params.set("city", query.city);
    if (query.state) params.set("state", query.state);
    if (query.zip) params.set("zipCode", query.zip);
    if (query.minBeds) params.set("bedrooms", String(query.minBeds));
    if (query.maxPrice) params.set("maxPrice", String(query.maxPrice));
    try {
      const data = (await rentcast(`/listings/sale?${params.toString()}`)) as RentCastListing[];
      let listings = (Array.isArray(data) ? data : []).map((r) => toListing(r));
      if (query.minSqft) listings = listings.filter((l) => (l.sqft ?? 0) >= query.minSqft!);
      return { listings, source: "rentcast" };
    } catch (err) {
      return {
        listings: filterSeed(query),
        source: "seed",
        notice: `RentCast unavailable (${err instanceof Error ? err.message : "error"}); showing seed listings.`,
      };
    }
  }

  return {
    listings: filterSeed(query),
    source: "seed",
    notice: "No RENTCAST_API_KEY — showing Hillsborough seed listings.",
  };
}

function filterSeed(query: SearchQuery): PropertyListing[] {
  return SEED_LISTINGS.filter((l) => {
    if (query.city && !l.city.toLowerCase().includes(query.city.toLowerCase())) return false;
    if (query.state && l.state.toLowerCase() !== query.state.toLowerCase()) return false;
    if (query.zip && l.zip !== query.zip) return false;
    if (query.minBeds && (l.beds ?? 0) < query.minBeds) return false;
    if (query.minSqft && (l.sqft ?? 0) < query.minSqft) return false;
    if (query.maxPrice && (l.listPrice ?? 0) > query.maxPrice) return false;
    if (query.address) {
      const hay = `${l.address} ${l.city} ${l.state} ${l.zip}`.toLowerCase();
      if (!hay.includes(query.address.toLowerCase())) return false;
    }
    return true;
  });
}

export async function lookupByAddress(address: string): Promise<{
  listing: PropertyListing;
  source: "rentcast" | "seed";
  notice?: string;
} | null> {
  const seed = SEED_LISTINGS.find((l) =>
    `${l.address}, ${l.city}, ${l.state} ${l.zip}`.toLowerCase().includes(address.toLowerCase())
  );
  if (hasRentCastKey()) {
    try {
      const data = (await rentcast(`/properties?address=${encodeURIComponent(address)}`)) as RentCastListing[];
      const first = Array.isArray(data) ? data[0] : undefined;
      if (first) {
        const listing = toListing(first, { facts: seed?.facts ?? {} });
        return { listing, source: "rentcast" };
      }
    } catch (err) {
      if (seed) {
        return {
          listing: seed,
          source: "seed",
          notice: `RentCast lookup failed; used seed match. ${err instanceof Error ? err.message : ""}`,
        };
      }
      return null;
    }
  }
  if (seed) {
    return {
      listing: seed,
      source: "seed",
      notice: hasRentCastKey() ? undefined : "Seed listing (add RENTCAST_API_KEY for live lookup).",
    };
  }
  return null;
}

export function getSeedListing(id: string) {
  return SEED_LISTINGS.find((l) => l.id === id) ?? null;
}

const memoryStore = new Map<string, PropertyListing>();

export function rememberListing(listing: PropertyListing) {
  memoryStore.set(listing.id, listing);
  return listing;
}

export function recallListing(id: string) {
  return memoryStore.get(id) ?? findRedfinListing(id) ?? getSeedListing(id);
}
