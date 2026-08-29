import type { PropertyListing } from "@/lib/types";
import type { SearchQuery } from "@/lib/rentcast";

export const LIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type LiveQuota = {
  used: number;
  remaining: number;
  userLimit: number;
  globalUsed: number;
  globalRemaining: number;
  globalLimit: number;
  month: string;
};

export type LiveCacheSnapshot = {
  queryKey: string;
  query: SearchQuery;
  count: number;
  fetchedAt: number;
  expiresAt: number;
  stale: boolean;
};

type CachedPull = {
  queryKey: string;
  query: SearchQuery;
  listings: PropertyListing[];
  fetchedAt: number;
};

const pulls = new Map<string, CachedPull>();
const userUsed = new Map<string, number>();
const globalUsed = new Map<string, number>();
const userTail = new Map<string, Promise<unknown>>();

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function liveQueryKey(query: SearchQuery) {
  return JSON.stringify({
    city: query.city ?? "",
    state: query.state ?? "",
    zip: query.zip ?? "",
    address: query.address ?? "",
    radius: query.radius ?? "",
    status: query.status ?? "Active",
    minBeds: query.minBeds ?? "",
    minBaths: query.minBaths ?? "",
    minSqft: query.minSqft ?? "",
    maxPrice: query.maxPrice ?? "",
    propertyType: query.propertyType ?? "",
  });
}

export function canReusePull(cached: SearchQuery, next: SearchQuery) {
  if ((cached.city ?? "") !== (next.city ?? "")) return false;
  if ((cached.state ?? "") !== (next.state ?? "")) return false;
  if ((cached.zip ?? "") !== (next.zip ?? "")) return false;
  if ((cached.address ?? "") !== (next.address ?? "")) return false;
  if ((cached.radius ?? "") !== (next.radius ?? "")) return false;
  if ((cached.status ?? "Active") !== (next.status ?? "Active")) return false;
  if ((cached.propertyType ?? "") !== (next.propertyType ?? "")) return false;
  if ((cached.minBeds ?? 0) > (next.minBeds ?? 0)) return false;
  if ((cached.minBaths ?? 0) > (next.minBaths ?? 0)) return false;
  if ((cached.minSqft ?? 0) > (next.minSqft ?? 0)) return false;
  if (next.maxPrice == null) return cached.maxPrice == null;
  if (cached.maxPrice == null) return true;
  return next.maxPrice <= cached.maxPrice;
}

export function quotaLimits() {
  const globalLimit = Math.max(1, Number(process.env.RENTCAST_MONTHLY_LIMIT || 50));
  const userLimit = Math.max(1, Number(process.env.RENTCAST_USER_MONTHLY_LIMIT || globalLimit));
  return { globalLimit, userLimit };
}

function usedMap(store: Map<string, number>, id: string) {
  const month = monthKey();
  const key = `${month}:${id}`;
  return { key, month, value: store.get(key) ?? 0 };
}

export function getLiveQuota(userId: string): LiveQuota {
  const { globalLimit, userLimit } = quotaLimits();
  const month = monthKey();
  const used = userUsed.get(`${month}:${userId}`) ?? 0;
  const gUsed = globalUsed.get(`${month}:global`) ?? 0;
  return {
    used,
    remaining: Math.max(0, userLimit - used),
    userLimit,
    globalUsed: gUsed,
    globalRemaining: Math.max(0, globalLimit - gUsed),
    globalLimit,
    month,
  };
}

function consumeQuota(userId: string) {
  const u = usedMap(userUsed, userId);
  const g = usedMap(globalUsed, "global");
  userUsed.set(u.key, u.value + 1);
  globalUsed.set(g.key, g.value + 1);
}

export function getLiveCache(userId: string): LiveCacheSnapshot | null {
  const row = pulls.get(userId);
  if (!row) return null;
  const expiresAt = row.fetchedAt + LIVE_CACHE_TTL_MS;
  return {
    queryKey: row.queryKey,
    query: row.query,
    count: row.listings.length,
    fetchedAt: row.fetchedAt,
    expiresAt,
    stale: Date.now() > expiresAt,
  };
}

export function filterListingsByQuery(listings: PropertyListing[], query: SearchQuery) {
  return listings.filter((l) => {
    if (query.minBeds && (l.beds ?? 0) < query.minBeds) return false;
    if (query.minBaths && (l.baths ?? 0) < query.minBaths) return false;
    if (query.minSqft && (l.sqft ?? 0) < query.minSqft) return false;
    if (query.maxPrice && (l.listPrice ?? 0) > query.maxPrice) return false;
    return true;
  });
}

export function listingsFromCache(userId: string): PropertyListing[] | null {
  const row = pulls.get(userId);
  if (!row) return null;
  return row.listings;
}

export function rememberLivePull(userId: string, query: SearchQuery, listings: PropertyListing[]) {
  pulls.set(userId, {
    queryKey: liveQueryKey(query),
    query,
    listings,
    fetchedAt: Date.now(),
  });
}

function formatAge(fetchedAt: number) {
  const mins = Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export type LivePullResult = {
  listings: PropertyListing[];
  fromCache: boolean;
  stale: boolean;
  pulled: boolean;
  quota: LiveQuota;
  notice: string;
};

export async function withUserQueue<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userTail.get(userId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => gate, () => gate);
  userTail.set(userId, tail);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function decideLivePull(
  userId: string,
  query: SearchQuery,
  force: boolean
): { action: "cache" | "fetch" | "stale" | "quota"; cached?: CachedPull; quota: LiveQuota } {
  const quota = getLiveQuota(userId);
  const cached = pulls.get(userId);
  const fresh = cached && Date.now() - cached.fetchedAt <= LIVE_CACHE_TTL_MS;
  const reusable = cached && canReusePull(cached.query, query);
  if (!force && reusable && fresh) return { action: "cache", cached, quota };
  if (quota.remaining <= 0 || quota.globalRemaining <= 0) {
    if (reusable && cached) return { action: "stale", cached, quota };
    return { action: "quota", quota };
  }
  return { action: "fetch", quota };
}

export function markFetched(userId: string, query: SearchQuery, listings: PropertyListing[]): LiveQuota {
  consumeQuota(userId);
  rememberLivePull(userId, query, listings);
  return getLiveQuota(userId);
}

export function livePullNotice(result: {
  fromCache: boolean;
  stale: boolean;
  pulled: boolean;
  count: number;
  fetchedAt?: number;
  quota: LiveQuota;
  searchArea?: string;
}) {
  const left = Math.min(result.quota.remaining, result.quota.globalRemaining);
  const pulls = `${left}/${result.quota.userLimit} pulls left this month`;
  if (result.pulled) {
    return `Pulled ${result.count} live listings${result.searchArea ? ` around ${result.searchArea}` : ""}. ${pulls}. Re-grade is free until area, type, or budget widens.`;
  }
  if (result.fromCache) {
    const age = result.fetchedAt ? formatAge(result.fetchedAt) : "earlier";
    return `Re-graded ${result.count} cached listings (${age}${result.stale ? ", stale" : ""}). ${pulls}.`;
  }
  return pulls;
}

export { formatAge };
