import { displayCityName, normalizePlaceName, parseSearchArea } from "@/kb/catalog";
import { formatSearchAddress, SCHOOL_POINT_RADIUS_MILES, NEIGHBORHOOD_RADIUS_MILES, usesLocalRadius } from "@/lib/search-location";
import { findRedfinListing } from "@/lib/redfin-csv";
import { SEED_LISTINGS, slugAddress } from "@/data/listings";
import { RENTCAST_CAP_MESSAGE, reserveRentcastCall, withGlobalQueue } from "@/lib/listing-cache";
import { listingMarket, marketFromIntent } from "@/lib/listing-market";
import type { ListingMarket, PropertyListing, PropertyType, UserMatrix } from "@/lib/types";

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
  mlsNumber?: string;
  hoa?: { fee?: number } | null;
};

const RC_PROPERTY_TYPE: Record<string, string> = {
  sfr: "Single Family",
  townhouse: "Townhouse",
  condo: "Condo",
  multi: "Multi-Family",
};

export const RENTCAST_SIGNUP_URL = "https://www.rentcast.io/api";

export function hasLiveSearch() {
  return Boolean(process.env.RENTCAST_API_KEY);
}

function mapRcType(raw?: string): PropertyType {
  const t = (raw || "").toLowerCase();
  if (t.includes("town")) return "townhouse";
  if (t.includes("condo")) return "condo";
  if (t.includes("multi")) return "multi";
  if (t.includes("single")) return "sfr";
  return "other";
}

function toListing(raw: RentCastListing, extra?: Partial<PropertyListing>): PropertyListing {
  const address = raw.addressLine1 || raw.formattedAddress || "Unknown address";
  const city = raw.city || "";
  const state = raw.state || "";
  const zip = raw.zipCode || "";
  const hoaFee = raw.hoa?.fee;
  const listing: PropertyListing = {
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
    mls: raw.mlsNumber || extra?.mls || null,
    hoaMonthly: hoaFee ?? extra?.hoaMonthly ?? null,
    market: extra?.market,
    facts: {
      ...extra?.facts,
      propertyType: mapRcType(raw.propertyType),
      hoa: hoaFee != null ? hoaFee > 0 : extra?.facts?.hoa ?? null,
      schoolArea: extra?.facts?.schoolArea ?? (city || null),
    },
  };
  listing.market = extra?.market ?? listingMarket(listing);
  return listing;
}

async function rentcast(path: string) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("RENTCAST_API_KEY missing");
  return withGlobalQueue(async () => {
    if (!reserveRentcastCall()) {
      throw new Error(RENTCAST_CAP_MESSAGE);
    }
    const res = await fetch(`https://api.rentcast.io/v1${path}`, {
      headers: { Accept: "application/json", "X-Api-Key": key },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RentCast ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  });
}

export type SearchQuery = {
  city?: string;
  state?: string;
  zip?: string;
  status?: string;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  maxPrice?: number;
  address?: string;
  radius?: number;
  propertyType?: string;
  market?: ListingMarket;
};

export function queryFromMatrix(matrix: UserMatrix): SearchQuery {
  const parsed = parseSearchArea(matrix.searchArea);
  const beds = matrix.dimensions.beds;
  const baths = matrix.dimensions.baths;
  const sqft = matrix.dimensions.sqft;
  const prefer = matrix.dimensions.property_type?.enabled
    ? String(matrix.dimensions.property_type.prefs?.prefer ?? "")
    : "";
  const named = matrix.locationAllowlist.filter(
    (a) => a.trim() && !/\bhs\b/i.test(a) && !/prep(?:aratory)?|high school|academy/i.test(a)
  );
  const query: SearchQuery = {
    status: "Active",
    market: marketFromIntent(matrix.intent),
    minBeds: beds?.enabled && beds.min != null ? beds.min : undefined,
    minBaths: baths?.enabled && baths.min != null ? baths.min : undefined,
    minSqft: sqft?.enabled && sqft.min != null ? sqft.min : undefined,
    maxPrice: matrix.budget.maxPrice,
    propertyType: RC_PROPERTY_TYPE[prefer],
  };
  const zip = (matrix.searchZip || "").replace(/\D/g, "").slice(0, 5);
  const point = (matrix.searchPoint || "").trim();
  const state = parsed.state || "FL";
  if (point) {
    query.address = formatSearchAddress({
      searchPoint: point,
      searchArea: matrix.searchArea,
      searchZip: zip,
      state,
    });
    query.radius = SCHOOL_POINT_RADIUS_MILES;
    query.state = state;
    if (zip) query.zip = zip;
    return query;
  }
  if (zip) {
    query.zip = zip;
    query.state = state;
    return query;
  }
  if (named.length === 1) {
    query.city = displayCityName(named[0]);
    query.state = state;
    return query;
  }
  if (named.length > 1) {
    const pinellas = named.find((n) => /petersburg|clearwater|largo|gulfport|pinellas/i.test(normalizePlaceName(n)));
    const center = displayCityName(pinellas || named[0]);
    query.address = `${center}, ${state}`;
    query.radius = 14;
    query.state = state;
    return query;
  }
  if (parsed.city && /^\d{5}$/.test(parsed.city)) {
    query.zip = parsed.city;
    query.state = parsed.state || "FL";
    return query;
  }
  if (parsed.city && parsed.state) {
    query.address = `${parsed.city}, ${parsed.state}`;
    query.radius = usesLocalRadius(parsed.city) ? NEIGHBORHOOD_RADIUS_MILES : 22;
    query.state = parsed.state;
    return query;
  }
  if (parsed.city) {
    query.city = parsed.city;
    query.state = parsed.state || "FL";
  }
  return query;
}

export async function searchListings(query: SearchQuery): Promise<{
  listings: PropertyListing[];
  source: "rentcast" | "seed";
  notice?: string;
  blockedByCap?: boolean;
}> {
  if (query.address && !query.radius) {
    const one = await lookupByAddress(query.address);
    return one
      ? { listings: [one.listing], source: one.source, notice: one.notice }
      : { listings: [], source: hasLiveSearch() ? "rentcast" : "seed" };
  }

  if (hasLiveSearch()) {
    const params = new URLSearchParams({ status: query.status || "Active", limit: "50" });
    if (query.radius && (query.address || (query.city && query.state))) {
      params.set("address", query.address || `${query.city}, ${query.state}`);
      params.set("radius", String(query.radius));
    } else {
      if (query.city) params.set("city", query.city);
      if (query.state) params.set("state", query.state);
      if (query.zip) params.set("zipCode", query.zip);
    }
    if (query.minBeds != null) params.set("bedrooms", `${query.minBeds}:*`);
    if (query.minBaths != null) params.set("bathrooms", `${query.minBaths}:*`);
    if (query.minSqft != null) params.set("squareFootage", `${query.minSqft}:*`);
    if (query.maxPrice != null) params.set("price", `*:${query.maxPrice}`);
    if (query.propertyType) params.set("propertyType", query.propertyType);
    const market = query.market === "rental" ? "rental" : "sale";
    const path = market === "rental" ? "/listings/rental/long-term" : "/listings/sale";
    try {
      const data = (await rentcast(`${path}?${params.toString()}`)) as RentCastListing[];
      const listings = (Array.isArray(data) ? data : [])
        .map((r) => toListing(r, { market }))
        .filter((l) => listingMarket(l) === market);
      return { listings, source: "rentcast" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      const blockedByCap =
        message === RENTCAST_CAP_MESSAGE || /unavailable right now|monthly cap|50 API/i.test(message);
      return {
        listings: [],
        source: "rentcast",
        notice: blockedByCap ? RENTCAST_CAP_MESSAGE : `Live search failed (${message}).`,
        blockedByCap,
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
  const market = query.market === "rental" ? "rental" : "sale";
  return SEED_LISTINGS.filter((l) => {
    if (listingMarket({ ...l, market: l.market ?? "sale" }) !== market) return false;
    if (query.city && !l.city.toLowerCase().includes(query.city.toLowerCase())) return false;
    if (query.state && l.state.toLowerCase() !== query.state.toLowerCase()) return false;
    if (query.zip && !query.radius && l.zip !== query.zip) return false;
    if (query.minBeds && (l.beds ?? 0) < query.minBeds) return false;
    if (query.minBaths && (l.baths ?? 0) < query.minBaths) return false;
    if (query.minSqft && (l.sqft ?? 0) < query.minSqft) return false;
    if (query.maxPrice && (l.listPrice ?? 0) > query.maxPrice) return false;
    if (query.address && !query.radius) {
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
  if (hasLiveSearch()) {
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
      notice: hasLiveSearch() ? undefined : "Seed listing (add RENTCAST_API_KEY for live lookup).",
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
