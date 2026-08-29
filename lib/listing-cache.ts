import type { PropertyListing } from "@/lib/types";
import type { SearchQuery } from "@/lib/rentcast";

export const LIVE_CACHE_TTL_MS = Number.POSITIVE_INFINITY;

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
  const userLimit = Math.max(1, Number(process.env.RENTCAST_USER_MONTHLY_LIMIT || 3));
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
  const expiresAt = row.fetchedAt;
  return {
    queryKey: row.queryKey,
    query: row.query,
    count: row.listings.length,
    fetchedAt: row.fetchedAt,
    expiresAt,
    stale: false,
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

export function liveWorkarounds(cached: SearchQuery, next: SearchQuery): string[] {
  const tips: string[] = [];
  if ((cached.minBeds ?? 0) > (next.minBeds ?? 0)) {
    tips.push(`Keep min beds at ${cached.minBeds}+ instead of ${next.minBeds}+`);
  }
  if ((cached.minBaths ?? 0) > (next.minBaths ?? 0)) {
    tips.push(`Keep min baths at ${cached.minBaths}+ instead of ${next.minBaths}+`);
  }
  if ((cached.minSqft ?? 0) > (next.minSqft ?? 0)) {
    tips.push(`Keep min sqft at ${cached.minSqft}+`);
  }
  if (cached.maxPrice != null && (next.maxPrice == null || next.maxPrice > cached.maxPrice)) {
    tips.push(`Keep max price at $${cached.maxPrice.toLocaleString()} or less`);
  }
  const cachedPlace = cached.address || cached.city || "";
  const nextPlace = next.address || next.city || "";
  if (cachedPlace && nextPlace && cachedPlace !== nextPlace) {
    tips.push(`Stay in ${cachedPlace} instead of switching to ${nextPlace}`);
  }
  if ((cached.propertyType ?? "") !== (next.propertyType ?? "")) {
    tips.push(`Stay on ${cached.propertyType || "the current property type"}`);
  }
  return tips;
}

export type LiveAdvice = {
  recommendation: "first-pull" | "regrade" | "confirm-pull" | "quota";
  canReuse: boolean;
  needsPull: boolean;
  coveragePct: number | null;
  matchCount: number;
  cacheCount: number;
  used: number;
  remaining: number;
  userLimit: number;
  workarounds: string[];
  advice: string;
};

export function adviseLiveSearch(userId: string, query: SearchQuery): LiveAdvice {
  const quota = getLiveQuota(userId);
  const cached = pulls.get(userId);
  const counter = `${quota.used}/${quota.userLimit} live searches used`;
  if (!cached) {
    if (quota.remaining <= 0) {
      return {
        recommendation: "quota",
        canReuse: false,
        needsPull: true,
        coveragePct: null,
        matchCount: 0,
        cacheCount: 0,
        used: quota.used,
        remaining: quota.remaining,
        userLimit: quota.userLimit,
        workarounds: [],
        advice: `No cached listings, and you are at the beta cap (${counter}). Upload a Redfin CSV or wait for next month.`,
      };
    }
    return {
      recommendation: "first-pull",
      canReuse: false,
      needsPull: true,
      coveragePct: null,
      matchCount: 0,
      cacheCount: 0,
      used: quota.used,
      remaining: quota.remaining,
      userLimit: quota.userLimit,
      workarounds: [],
      advice: `First live search uses 1 of ${quota.userLimit}. After that, changing coffee, vibe, or tighter beds/price re-grades the cache for free. ${counter}; ${quota.remaining} left.`,
    };
  }
  const matches = filterListingsByQuery(cached.listings, query);
  const coveragePct = cached.listings.length
    ? Math.round((100 * matches.length) / cached.listings.length)
    : 0;
  const canReuse = canReusePull(cached.query, query);
  const workarounds = liveWorkarounds(cached.query, query);
  if (canReuse) {
    return {
      recommendation: "regrade",
      canReuse: true,
      needsPull: false,
      coveragePct,
      matchCount: matches.length,
      cacheCount: cached.listings.length,
      used: quota.used,
      remaining: quota.remaining,
      userLimit: quota.userLimit,
      workarounds: [],
      advice: `${coveragePct}% of your cached list (${matches.length}/${cached.listings.length}) still matches. Re-grade for free — do not spend a live search. ${counter}; ${quota.remaining} left.`,
    };
  }
  if (quota.remaining <= 0) {
    return {
      recommendation: "quota",
      canReuse: false,
      needsPull: true,
      coveragePct,
      matchCount: matches.length,
      cacheCount: cached.listings.length,
      used: quota.used,
      remaining: quota.remaining,
      userLimit: quota.userLimit,
      workarounds,
      advice: `Beta cap reached (${counter}). ${coveragePct}% of the cached homes still fit. ${workarounds.join(" · ") || "Re-grade the cache."} A new pull is not available.`,
    };
  }
  return {
    recommendation: "confirm-pull",
    canReuse: false,
    needsPull: true,
    coveragePct,
    matchCount: matches.length,
    cacheCount: cached.listings.length,
    used: quota.used,
    remaining: quota.remaining,
    userLimit: quota.userLimit,
    workarounds,
    advice: `${coveragePct}% of the cached homes still match this new search (${matches.length}/${cached.listings.length}). Workaround: ${workarounds.join("; ") || "keep the current area/type/floors"}. If you still want a new batch, say "confirm live pull" to use 1 of ${quota.remaining} remaining (${counter}).`,
  };
}

export function decideLivePull(
  userId: string,
  query: SearchQuery,
  force: boolean
): { action: "cache" | "fetch" | "confirm" | "quota"; cached?: CachedPull; quota: LiveQuota } {
  const quota = getLiveQuota(userId);
  const cached = pulls.get(userId);
  const reusable = Boolean(cached && canReusePull(cached.query, query));
  if (cached && reusable && !force) return { action: "cache", cached, quota };
  if (quota.remaining <= 0 || quota.globalRemaining <= 0) {
    if (cached) return { action: "cache", cached, quota };
    return { action: "quota", quota };
  }
  if (!cached) return { action: "fetch", quota };
  if (force) return { action: "fetch", quota };
  return { action: "confirm", cached, quota };
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
  const pulls = `${result.quota.used}/${result.quota.userLimit} used · ${left} live search${left === 1 ? "" : "es"} left`;
  if (result.pulled) {
    return `Pulled ${result.count} live listings${result.searchArea ? ` around ${result.searchArea}` : ""}. ${pulls}. Cache stays until you confirm another pull or the area/type/budget widens.`;
  }
  if (result.fromCache) {
    const age = result.fetchedAt ? formatAge(result.fetchedAt) : "earlier";
    return `Re-graded ${result.count} cached listings (${age}). ${pulls}.`;
  }
  return pulls;
}

export { formatAge };
