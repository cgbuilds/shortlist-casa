import { NextResponse } from "next/server";
import { baselineStatus } from "@/kb/catalog";
import { grade } from "@/lib/grade";
import { parseAddressFromInput } from "@/lib/parse-address";
import { loadBundledRedfinFavorites, parseRedfinCsv } from "@/lib/redfin-csv";
import {
  hasLiveSearch,
  queryFromMatrix,
  rememberListing,
  RENTCAST_SIGNUP_URL,
  searchListings,
} from "@/lib/rentcast";
import {
  adviseLiveSearch,
  decideLivePull,
  filterListingsByQuery,
  getLiveCache,
  getLiveQuota,
  livePullNotice,
  markFetched,
  withUserQueue,
} from "@/lib/listing-cache";
import { enrichListingsForMatrix } from "@/lib/osm-amenities";
import { ensureMatrix } from "@/lib/matrix-tools";
import { getSessionUser, getUserListings, loadActiveMatrix, saveGrade, saveSearch, saveUserListings } from "@/lib/session";
import type { PropertyListing, UserMatrix } from "@/lib/types";

async function rank(listings: PropertyListing[], matrix: UserMatrix) {
  const ready = await enrichListingsForMatrix(listings, matrix);
  return ready
    .map((listing) => {
      rememberListing(listing);
      const g = grade(listing, matrix);
      return { listing, grade: g };
    })
    .sort((a, b) => {
      if (a.grade.mustHaveFailed !== b.grade.mustHaveFailed) return a.grade.mustHaveFailed ? 1 : -1;
      return (b.grade.total ?? -1) - (a.grade.total ?? -1);
    });
}

function filterList(
  listings: PropertyListing[],
  q: { minBeds?: number; minSqft?: number; maxPrice?: number; city?: string; q?: string }
) {
  return listings.filter((l) => {
    if (q.minBeds && (l.beds ?? 0) < q.minBeds) return false;
    if (q.minSqft && (l.sqft ?? 0) < q.minSqft) return false;
    if (q.maxPrice && (l.listPrice ?? 0) > q.maxPrice) return false;
    if (q.city && !`${l.city} ${l.neighborhood ?? ""}`.toLowerCase().includes(q.city.toLowerCase())) return false;
    if (q.q) {
      const hay = `${l.address} ${l.city} ${l.zip} ${l.neighborhood ?? ""}`.toLowerCase();
      if (!hay.includes(q.q.toLowerCase())) return false;
    }
    return true;
  });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    liveSearch: hasLiveSearch(),
    signupUrl: RENTCAST_SIGNUP_URL,
    quota: getLiveQuota(user.id),
    cache: getLiveCache(user.id),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as {
    city?: string;
    state?: string;
    zip?: string;
    minBeds?: number;
    minSqft?: number;
    maxPrice?: number;
    q?: string;
    csv?: string;
    source?: "favorites" | "rentcast" | "upload" | "live";
    draft?: UserMatrix;
    force?: boolean;
  };

  const matrix = ensureMatrix(body.draft ?? (await loadActiveMatrix(user)));

  if (body.csv) {
    const parsed = parseRedfinCsv(body.csv);
    if (!parsed.length) {
      return NextResponse.json({ error: "No rows parsed. Use Redfin → Favorites → Download CSV." }, { status: 400 });
    }
    saveUserListings(user, parsed);
    const ranked = await rank(filterList(parsed, body), matrix);
    await saveSearch(user, { source: "upload" }, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    return NextResponse.json({
      source: "upload",
      notice: `Imported ${parsed.length} Redfin rows.`,
      results: ranked,
    });
  }

  if (body.source === "live") {
    const baseline = baselineStatus(matrix);
    if (!baseline.complete) {
      return NextResponse.json(
        {
          error: `Set baseline in chat first: ${baseline.gaps.filter((g) => !g.done).map((g) => g.label).join(", ")}.`,
          liveSearch: hasLiveSearch(),
          quota: getLiveQuota(user.id),
        },
        { status: 400 }
      );
    }
    if (!hasLiveSearch()) {
      return NextResponse.json(
        {
          error: `Add a free RentCast key (${RENTCAST_SIGNUP_URL}) as RENTCAST_API_KEY to pull live listings. Until then, upload a Redfin CSV.`,
          liveSearch: false,
          signupUrl: RENTCAST_SIGNUP_URL,
          quota: getLiveQuota(user.id),
        },
        { status: 400 }
      );
    }
    const query = queryFromMatrix(matrix);
    return withUserQueue(user.id, async () => {
      const decision = decideLivePull(user.id, query, Boolean(body.force));
      if (decision.action === "quota") {
        return NextResponse.json(
          {
            error: `Beta live-search cap reached (${decision.quota.used}/${decision.quota.userLimit}). Re-grade the cache or wait until next month.`,
            quota: decision.quota,
            cache: getLiveCache(user.id),
            advice: adviseLiveSearch(user.id, query),
          },
          { status: 429 }
        );
      }
      let listings = decision.cached?.listings ?? [];
      let pulled = false;
      let fromCache = decision.action === "cache" || decision.action === "confirm";
      let quota = decision.quota;
      if (decision.action === "fetch") {
        const result = await searchListings(query);
        if (!result.listings.length) {
          return NextResponse.json({
            source: result.source,
            notice: result.notice ?? "No live listings matched that search.",
            results: [],
            quota,
            cache: getLiveCache(user.id),
            advice: adviseLiveSearch(user.id, query),
          });
        }
        listings = result.listings;
        quota = markFetched(user.id, query, listings);
        pulled = true;
        fromCache = false;
      }
      const filtered = filterListingsByQuery(listings, query);
      saveUserListings(user, listings);
      const ranked = await rank(filtered, matrix);
      await saveSearch(user, { source: "live", query, fromCache, pulled }, ranked.map((r) => r.listing.id));
      for (const row of ranked) await saveGrade(user, row.listing, row.grade);
      const top = ranked.filter((r) => !r.grade.mustHaveFailed);
      const advice = adviseLiveSearch(user.id, query);
      const notice =
        decision.action === "confirm"
          ? `${advice.advice} Showing the ${ranked.length} cached homes that still fit.`
          : `${livePullNotice({
              fromCache,
              stale: false,
              pulled,
              count: ranked.length,
              fetchedAt: decision.cached?.fetchedAt ?? Date.now(),
              quota,
              searchArea: matrix.searchArea,
            })} ${top.length} pass must-haves.`;
      return NextResponse.json({
        source: pulled ? "rentcast" : "cache",
        notice,
        results: ranked,
        quota,
        cache: getLiveCache(user.id),
        fromCache,
        pulled,
        needsConfirm: decision.action === "confirm",
        advice,
      });
    });
  }

  if (body.source === "rentcast") {
    const parsed = body.q ? parseAddressFromInput(body.q) : null;
    const looksLikePlace = Boolean(body.q && !parsed && !/\d/.test(body.q));
    const result = await searchListings({
      city: body.city || (looksLikePlace ? body.q : undefined),
      state: body.state || (looksLikePlace ? "FL" : undefined),
      zip: body.zip,
      minBeds: body.minBeds,
      minSqft: body.minSqft,
      maxPrice: body.maxPrice,
      address: parsed || undefined,
    });
    const ranked = await rank(result.listings, matrix);
    await saveSearch(user, body, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    return NextResponse.json({ source: result.source, notice: result.notice, results: ranked });
  }

  const listings = body.source === "favorites" ? loadBundledRedfinFavorites() : getUserListings(user);
  if (body.source === "favorites") saveUserListings(user, listings);
  const city = body.city || (body.q && !parseAddressFromInput(body.q) && !/\d/.test(body.q) ? body.q : undefined);
  let working = filterList(listings, { ...body, city, q: city ? undefined : body.q });
  if (body.source !== "favorites" && getLiveCache(user.id)) {
    working = filterListingsByQuery(working, queryFromMatrix(matrix));
  }
  const ranked = await rank(working, matrix);
  await saveSearch(user, body, ranked.map((r) => r.listing.id));
  for (const row of ranked) await saveGrade(user, row.listing, row.grade);
  const cache = getLiveCache(user.id);
  const quota = getLiveQuota(user.id);
  return NextResponse.json({
    source: body.source === "favorites" ? "redfin-favorites" : cache ? "cache" : "session",
    notice: cache
      ? livePullNotice({
          fromCache: true,
          stale: cache.stale,
          pulled: false,
          count: ranked.length,
          fetchedAt: cache.fetchedAt,
          quota,
          searchArea: matrix.searchArea,
        })
      : `${listings.length} homes from ${body.source === "favorites" ? "the sample Valrico Redfin CSV" : "your current list"}.`,
    results: ranked,
    quota,
    cache,
  });
}
