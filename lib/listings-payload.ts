import type { PropertyListing, UserMatrix } from "@/lib/types";

const MAX_RECALL = 80;
export const LISTING_POOL_KEY = "homestead-listing-pool";
export const SESSION_KEY = "homestead-session-v1";

export type HomesteadSession = {
  listings: PropertyListing[];
  matrix?: UserMatrix;
  savedAt: number;
  awaitingSearch?: boolean;
  hasOwnList?: boolean;
};

/** True when the scored set is a live pull or user CSV — not the bundled sample. */
export function isOwnListSource(source?: string, filename?: string, pulled?: boolean) {
  const src = source ?? "";
  if (src === "rentcast" || src === "upload" || src === "live") return true;
  if (pulled) return true;
  if (src === "saved" && filename && !/starter/i.test(filename)) return true;
  return false;
}

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

function looksLikeMatrix(raw: unknown): raw is UserMatrix {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as UserMatrix;
  return typeof m.searchArea === "string" && typeof m.catalogVersion === "string" && Boolean(m.dimensions);
}

export function parseStoredSession(raw: string | null): HomesteadSession {
  if (!raw) return { listings: [], savedAt: 0 };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return { listings: sanitizeListings(parsed), savedAt: 0 };
    }
    if (parsed && typeof parsed === "object") {
      const row = parsed as {
        listings?: unknown;
        matrix?: unknown;
        savedAt?: unknown;
        awaitingSearch?: unknown;
        hasOwnList?: unknown;
      };
      return {
        listings: sanitizeListings(row.listings),
        matrix: looksLikeMatrix(row.matrix) ? row.matrix : undefined,
        savedAt: typeof row.savedAt === "number" ? row.savedAt : 0,
        awaitingSearch: row.awaitingSearch === true,
        hasOwnList: row.hasOwnList === true,
      };
    }
  } catch {
    /* ignore */
  }
  return { listings: [], savedAt: 0 };
}

function readStore(store: Storage | undefined, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(store: Storage | undefined, key: string, value: string) {
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readStoredSession(): HomesteadSession {
  if (typeof window === "undefined") return { listings: [], savedAt: 0 };
  const fromSession = parseStoredSession(readStore(window.localStorage, SESSION_KEY));
  if (fromSession.listings.length || fromSession.matrix) return fromSession;
  const fromLocalLegacy = parseStoredSession(readStore(window.localStorage, LISTING_POOL_KEY));
  if (fromLocalLegacy.listings.length) return fromLocalLegacy;
  return parseStoredSession(readStore(window.sessionStorage, LISTING_POOL_KEY));
}

export function readStoredPool(): PropertyListing[] {
  return readStoredSession().listings;
}

export function writeStoredSession(patch: {
  listings?: PropertyListing[];
  matrix?: UserMatrix;
  awaitingSearch?: boolean;
  hasOwnList?: boolean;
}) {
  if (typeof window === "undefined") return;
  const prev = readStoredSession();
  const listings = patch.listings ? sanitizeListings(patch.listings) : prev.listings;
  const matrix = patch.matrix ?? prev.matrix;
  const awaitingSearch = patch.awaitingSearch ?? prev.awaitingSearch;
  const hasOwnList = patch.hasOwnList ?? prev.hasOwnList;
  if (!listings.length && !matrix) return;
  const payload = JSON.stringify({
    listings,
    matrix,
    savedAt: Date.now(),
    awaitingSearch,
    hasOwnList,
  } satisfies HomesteadSession);
  if (!writeStore(window.localStorage, SESSION_KEY, payload)) {
    const slim = JSON.stringify({
      listings: listings.slice(0, 25),
      matrix,
      savedAt: Date.now(),
      awaitingSearch,
      hasOwnList,
    } satisfies HomesteadSession);
    writeStore(window.localStorage, SESSION_KEY, slim);
  }
  writeStore(window.sessionStorage, SESSION_KEY, payload);
}

export function writeStoredPool(listings: PropertyListing[]) {
  writeStoredSession({ listings });
}

export function writeStoredMatrix(matrix: UserMatrix) {
  writeStoredSession({ matrix });
}
