import type { PropertyFacts, PropertyListing, UserMatrix } from "@/lib/types";
import { looksLikeMatrix, sanitizeListings } from "@/lib/listings-payload";

export const SHARE_PREFIX = "s1.";
const SHARE_LIST_CAP = 10;

export type SharePayload = {
  v: 1;
  matrix: UserMatrix;
  listings: PropertyListing[];
};

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(token: string) {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function blobOf(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy]);
}

async function deflateRaw(data: Uint8Array) {
  const stream = blobOf(data).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array) {
  const stream = blobOf(data).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function slimFacts(facts: PropertyFacts | undefined): PropertyFacts {
  const out: PropertyFacts = {};
  if (!facts) return out;
  for (const [key, value] of Object.entries(facts)) {
    if (value == null) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function slimListing(listing: PropertyListing): PropertyListing {
  return {
    id: listing.id,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    yearBuilt: listing.yearBuilt,
    listPrice: listing.listPrice,
    daysOnMarket: listing.daysOnMarket,
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    status: listing.status ?? null,
    listingUrl: listing.listingUrl ?? null,
    hoaMonthly: listing.hoaMonthly ?? null,
    neighborhood: listing.neighborhood ?? null,
    market: listing.market,
    facts: slimFacts(listing.facts),
  };
}

export function packShare(matrix: UserMatrix, listings: PropertyListing[]): SharePayload {
  return {
    v: 1,
    matrix,
    listings: listings.slice(0, SHARE_LIST_CAP).map(slimListing),
  };
}

export async function encodeShare(matrix: UserMatrix, listings: PropertyListing[]) {
  const json = JSON.stringify(packShare(matrix, listings));
  const bytes = new TextEncoder().encode(json);
  const packed = await deflateRaw(bytes);
  return SHARE_PREFIX + toBase64Url(packed);
}

export async function decodeShare(token: string): Promise<SharePayload | null> {
  const raw = token.trim().replace(/^#/, "");
  if (!raw.startsWith(SHARE_PREFIX)) return null;
  try {
    const packed = fromBase64Url(raw.slice(SHARE_PREFIX.length));
    const json = new TextDecoder().decode(await inflateRaw(packed));
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { v?: unknown; matrix?: unknown; listings?: unknown };
    if (row.v !== 1 || !looksLikeMatrix(row.matrix)) return null;
    const listings = sanitizeListings(row.listings);
    if (!listings.length) return null;
    return { v: 1, matrix: row.matrix, listings };
  } catch {
    return null;
  }
}

export function shareUrlFromToken(token: string, origin = "") {
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/s#${token}`;
}
