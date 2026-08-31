import type { PropertyListing } from "@/lib/types";

const MAX_RECALL = 80;

export function sanitizeListings(raw: unknown): PropertyListing[] {
  if (!Array.isArray(raw)) return [];
  const out: PropertyListing[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as PropertyListing;
    if (!row.id || !row.address) continue;
    out.push({
      ...row,
      facts: row.facts && typeof row.facts === "object" ? row.facts : {},
    });
    if (out.length >= MAX_RECALL) break;
  }
  return out;
}

export const LISTING_POOL_KEY = "homestead-listing-pool";

export function readStoredPool(): PropertyListing[] {
  try {
    const raw = window.sessionStorage.getItem(LISTING_POOL_KEY);
    if (!raw) return [];
    return sanitizeListings(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeStoredPool(listings: PropertyListing[]) {
  try {
    const clean = sanitizeListings(listings);
    if (!clean.length) return;
    window.sessionStorage.setItem(LISTING_POOL_KEY, JSON.stringify(clean));
  } catch {
    /* quota / private mode */
  }
}
