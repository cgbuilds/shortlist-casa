import { NextResponse } from "next/server";
import { baselineStatus } from "@/kb/catalog";
import { grade } from "@/lib/grade";
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
  listingsFromCache,
  livePullNotice,
  markFetched,
  withUserQueue,
  RENTCAST_CAP_MESSAGE,
} from "@/lib/listing-cache";
import { enrichListingsForMatrix } from "@/lib/osm-amenities";
import { ensureMatrix } from "@/lib/matrix-tools";
import { getSessionUser, getUserListings, getCsvMeta, loadActiveMatrix, saveCsvListings, saveGrade, saveSearch } from "@/lib/session";
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
    saved: getCsvMeta(user),
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
    filename?: string;
    source?: "favorites" | "rentcast" | "upload" | "live" | "saved" | "regrade";
    draft?: UserMatrix;
    force?: boolean;
  };

  const matrix = ensureMatrix(body.draft ?? (await loadActiveMatrix(user)));

  if (body.csv) {
    const parsed = parseRedfinCsv(body.csv);
    if (!parsed.length) {
      return NextResponse.json({ error: "No rows parsed. Use Redfin → Favorites → Download CSV." }, { status: 400 });
    }
    const filename = body.filename?.trim() || "favorites.csv";
    saveCsvListings(user, parsed, filename);
    const ranked = await rank(filterList(parsed, body), matrix);
    await saveSearch(user, { source: "upload", filename }, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    const saved = getCsvMeta(user);
    return NextResponse.json({
      source: "upload",
      notice: `Saved ${parsed.length} homes from ${filename}. This file stays on your account — Re-grade uses it until you upload a new CSV.`,
      results: ranked,
      saved,
      quota: getLiveQuota(user.id),
      cache: getLiveCache(user.id),
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
        const accountEmpty = decision.quota.globalRemaining <= 0;
        return NextResponse.json(
          {
            error: accountEmpty
              ? RENTCAST_CAP_MESSAGE
              : `Beta live-search cap reached (${decision.quota.used}/${decision.quota.userLimit}). Re-grade the cache or wait until next month.`,
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
        if (result.blockedByCap) {
          return NextResponse.json(
            {
              error: result.notice ?? RENTCAST_CAP_MESSAGE,
              quota: getLiveQuota(user.id),
              cache: getLiveCache(user.id),
              advice: adviseLiveSearch(user.id, query),
            },
            { status: 429 }
          );
        }
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
      listings.forEach(rememberListing);
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
        saved: getCsvMeta(user),
      });
    });
  }

  if (body.source === "rentcast") {
    return NextResponse.json(
      {
        error: "Direct RentCast queries are disabled so the 50/month account cap cannot be bypassed. Use live search (cached) or a Redfin CSV.",
        quota: getLiveQuota(user.id),
      },
      { status: 400 }
    );
  }

  const saved = getCsvMeta(user);
  const csv = getUserListings(user);
  if (body.source === "regrade" || !body.source) {
    const liveList = listingsFromCache(user.id);
    const listings = liveList?.length ? liveList : csv;
    if (!listings.length) {
      const baseline = baselineStatus(matrix);
      const why = !baseline.complete
        ? `Nothing to re-grade, and your must-haves are incomplete (${baseline.gaps.filter((g) => !g.done).map((g) => g.label).join(", ")}).`
        : "Nothing to re-grade: no live cache and no saved CSV. Upload a Redfin CSV or confirm a live pull first.";
      return NextResponse.json(
        {
          error: why,
          results: undefined,
          quota: getLiveQuota(user.id),
          cache: getLiveCache(user.id),
          saved,
          matrixOn: baseline.complete,
        },
        { status: 409 }
      );
    }
    const working = liveList?.length
      ? filterListingsByQuery(listings, queryFromMatrix(matrix))
      : filterList(listings, body);
    const ranked = await rank(working, matrix);
    await saveSearch(user, { source: "regrade" }, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    const incomplete = ranked.filter((r) => r.grade.band === "incomplete").length;
    const cache = getLiveCache(user.id);
    const quota = getLiveQuota(user.id);
    const from = liveList?.length ? "live cache" : `saved file ${saved?.filename ?? "CSV"}`;
    const notice =
      incomplete === ranked.length && ranked.length
        ? `Re-graded ${ranked.length} homes from ${from}, but every score is incomplete — your must-haves are not set, or listings lack year/type/price.`
        : `Re-graded ${ranked.length} homes from ${from}${incomplete ? ` · ${incomplete} incomplete` : ""}.`;
    return NextResponse.json({
      source: liveList?.length ? "cache" : "saved",
      notice,
      results: ranked,
      quota,
      cache,
      saved,
    });
  }

  if (body.source === "saved") {
    if (!csv.length) {
      return NextResponse.json(
        { error: "No saved CSV yet. Upload a Redfin Favorites file first.", saved: null },
        { status: 400 }
      );
    }
    const ranked = await rank(filterList(csv, body), matrix);
    await saveSearch(user, { source: "saved" }, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    return NextResponse.json({
      source: "saved",
      notice: `Graded ${ranked.length} homes from saved file ${saved?.filename ?? "your CSV"}.`,
      results: ranked,
      quota: getLiveQuota(user.id),
      cache: getLiveCache(user.id),
      saved,
    });
  }

  if (body.source === "favorites") {
    const listings = loadBundledRedfinFavorites();
    listings.forEach(rememberListing);
    const ranked = await rank(filterList(listings, body), matrix);
    await saveSearch(user, body, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    return NextResponse.json({
      source: "redfin-favorites",
      notice: `Showing ${listings.length} homes from the sample Valrico CSV. Your uploaded file is unchanged${saved ? ` (${saved.filename}, ${saved.count} homes)` : ""}.`,
      results: ranked,
      quota: getLiveQuota(user.id),
      cache: getLiveCache(user.id),
      saved,
    });
  }

  return NextResponse.json({ error: "Unknown search source." }, { status: 400 });
}
