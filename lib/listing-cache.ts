import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { PropertyListing } from "@/lib/types";
import type { SearchQuery } from "@/lib/rentcast";

export const LIVE_CACHE_TTL_MS = Number.POSITIVE_INFINITY;
/** RentCast Developer plan included requests. Never send a call that would overage. */
export const RENTCAST_HARD_CAP = 50;
export const RENTCAST_CAP_MESSAGE =
  "RentCast monthly cap of 50 API requests reached. This app will not send overage calls ($0.20 each). Re-grade the cache, upload a Redfin CSV, or wait until next month.";

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
let quotaHydrated = false;

function quotaFile() {
  return process.env.RENTCAST_QUOTA_FILE || join(process.cwd(), ".data", "rentcast-quota.json");
}

function hydrateQuota() {
  if (quotaHydrated) return;
  quotaHydrated = true;
  try {
    if (!existsSync(quotaFile())) return;
    const raw = JSON.parse(readFileSync(quotaFile(), "utf8")) as {
      month?: string;
      globalUsed?: number;
      users?: Record<string, number>;
    };
    const month = monthKey();
    if (raw.month !== month) return;
    globalUsed.set(`${month}:global`, Math.min(RENTCAST_HARD_CAP, raw.globalUsed ?? 0));
    for (const [id, n] of Object.entries(raw.users ?? {})) {
      userUsed.set(`${month}:${id}`, Number(n) || 0);
    }
  } catch {
    /* missing or corrupt file starts at zero */
  }
}

function persistQuota() {
  const month = monthKey();
  const users: Record<string, number> = {};
  const prefix = `${month}:`;
  for (const [k, v] of userUsed) {
    if (k.startsWith(prefix) && k !== `${prefix}global`) users[k.slice(prefix.length)] = v;
  }
  const file = quotaFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      month,
      globalUsed: globalUsed.get(`${month}:global`) ?? 0,
      users,
    })
  );
}

export function resetLiveQuotaForTests() {
  pulls.clear();
  userUsed.clear();
  globalUsed.clear();
  quotaHydrated = true;
}

export function setLiveQuotaForTests(opts: { globalUsed?: number; userId?: string; used?: number }) {
  hydrateQuota();
  const month = monthKey();
  if (opts.globalUsed != null) globalUsed.set(`${month}:global`, opts.globalUsed);
  if (opts.userId && opts.used != null) userUsed.set(`${month}:${opts.userId}`, opts.used);
  persistQuota();
}

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
  const raw = Number(process.env.RENTCAST_MONTHLY_LIMIT || RENTCAST_HARD_CAP);
  const requested = Number.isFinite(raw) ? raw : RENTCAST_HARD_CAP;
  const globalLimit = Math.min(RENTCAST_HARD_CAP, Math.max(1, requested));
  const userLimit = Math.max(1, Number(process.env.RENTCAST_USER_MONTHLY_LIMIT || 3));
  return { globalLimit, userLimit };
}

function usedMap(store: Map<string, number>, id: string) {
  const month = monthKey();
  const key = `${month}:${id}`;
  return { key, month, value: store.get(key) ?? 0 };
}

export function getLiveQuota(userId: string): LiveQuota {
  hydrateQuota();
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

function consumeUserQuota(userId: string) {
  hydrateQuota();
  const u = usedMap(userUsed, userId);
  userUsed.set(u.key, u.value + 1);
  persistQuota();
}

/** Count one RentCast HTTP call before it is sent. Returns false at the hard 50 cap (no overage). */
export function reserveRentcastCall(): boolean {
  hydrateQuota();
  const { globalLimit } = quotaLimits();
  const g = usedMap(globalUsed, "global");
  if (g.value >= globalLimit || g.value >= RENTCAST_HARD_CAP) return false;
  globalUsed.set(g.key, g.value + 1);
  persistQuota();
  return true;
}

export function atRentcastHardCap() {
  return getLiveQuota("__cap__").globalRemaining <= 0;
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

export function withGlobalQueue<T>(fn: () => Promise<T>): Promise<T> {
  return withUserQueue("__rentcast_global__", fn);
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
  const account = `${quota.globalUsed}/${quota.globalLimit} RentCast calls this month`;
  const blocked = quota.remaining <= 0 || quota.globalRemaining <= 0;
  if (!cached) {
    if (blocked) {
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
        advice: `No cached listings, and live search is blocked (${counter}; ${account}). This app never exceeds 50 RentCast requests (no $0.20 overage). Upload a Redfin CSV or wait until next month.`,
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
      advice: `You have used ${quota.used} of ${quota.userLimit} live searches (${quota.remaining} left). Cache is empty, so the first pull is required to load homes — that would spend 1, leaving ${Math.max(0, quota.remaining - 1)}. Account ${account}. Coffee/vibe/tighter beds after that re-grade for free.`,
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
  if (blocked) {
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
      advice: `Live search blocked (${counter}; ${account}). ${coveragePct}% of the cached homes still fit. ${workarounds.join(" · ") || "Re-grade the cache."} No overage requests will be sent.`,
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
  consumeUserQuota(userId);
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
