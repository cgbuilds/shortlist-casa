import { NextResponse } from "next/server";
import { baselineStatus } from "@/kb/catalog";
import { TOP_LISTING_COUNT, takeTopListings } from "@/lib/grade";
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
  rememberLivePull,
  withUserQueue,
  RENTCAST_CAP_MESSAGE,
} from "@/lib/listing-cache";
import { rankListings, type RankRow } from "@/lib/rank-listings";
import { ensureMatrix } from "@/lib/matrix-tools";
import { getSessionUser, getUserListings, getCsvMeta, loadActiveMatrix, saveCsvListings, adoptLiveListings, saveGrade, saveSearch, saveListingSet, loadListingSet } from "@/lib/session";
import { sanitizeListings } from "@/lib/listings-payload";
import type { PropertyListing, UserMatrix } from "@/lib/types";

function ndjsonStream(run: (emit: (obj: unknown) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      try {
        await run(emit);
      } catch (err) {
        emit({ type: "error", error: err instanceof Error ? err.message : "Scoring failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function respondRanked(
  stream: boolean | undefined,
  listings: PropertyListing[],
  matrix: UserMatrix,
  after: (ranked: RankRow[]) => Promise<Record<string, unknown>>
) {
  if (!stream) {
    const ranked = await rankListings(listings, matrix);
    return NextResponse.json(await after(ranked));
  }
  return ndjsonStream(async (emit) => {
    const ranked = await rankListings(listings, matrix, (p) => {
      emit({
        type: "progress",
        analyzed: p.analyzed,
        total: p.total,
        processing: p.processing,
        results: p.results,
        totalMatched: p.totalMatched,
      });
    });
    emit({ type: "done", ...(await after(ranked)) });
  });
}

function packResults(ranked: RankRow[]) {
  const totalMatched = ranked.length;
  const results = takeTopListings(ranked);
  const clip =
    totalMatched > TOP_LISTING_COUNT ? ` Showing the top ${results.length} of ${totalMatched} by score.` : "";
  return { results, totalMatched, clip, listings: ranked.map((r) => r.listing) };
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
    stream?: boolean;
    listings?: unknown;
  };

  const matrix = ensureMatrix(body.draft ?? (await loadActiveMatrix(user)));

  if (body.csv) {
    const parsed = parseRedfinCsv(body.csv);
    if (!parsed.length) {
      return NextResponse.json({ error: "No rows parsed. Use Redfin → Favorites → Download CSV." }, { status: 400 });
    }
    const filename = body.filename?.trim() || "favorites.csv";
    saveCsvListings(user, parsed, filename);
    return respondRanked(body.stream, filterList(parsed, body), matrix, async (ranked) => {
      await saveSearch(user, { source: "upload", filename }, ranked.map((r) => r.listing.id));
      for (const row of ranked) await saveGrade(user, row.listing, row.grade);
      const packed = packResults(ranked);
      const saved = getCsvMeta(user);
      return {
        source: "upload",
        notice: `Saved ${parsed.length} homes from ${filename}. This file stays on your account — ask chat to rescore it until you upload a new CSV.${packed.clip}`,
        results: packed.results,
        totalMatched: packed.totalMatched,
        listings: packed.listings,
        saved,
        quota: getLiveQuota(user.id),
        cache: getLiveCache(user.id),
      };
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
              : `Beta live-search cap reached (${decision.quota.used}/${decision.quota.userLimit}). Ask chat to rescore the cache or wait until next month.`,
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
      adoptLiveListings(user, listings);
      const filtered = filterListingsByQuery(listings, query);
      listings.forEach(rememberListing);
      return respondRanked(body.stream, filtered, matrix, async (ranked) => {
        await saveSearch(user, { source: "live", query, fromCache, pulled }, ranked.map((r) => r.listing.id));
        await saveListingSet(user, ranked.map((r) => r.listing), pulled ? "live" : "cache");
        for (const row of ranked) await saveGrade(user, row.listing, row.grade);
        const packed = packResults(ranked);
        const top = ranked.filter((r) => !r.grade.mustHaveFailed);
        const advice = adviseLiveSearch(user.id, query);
        const notice =
          decision.action === "confirm"
            ? `${advice.advice} Showing the ${packed.results.length} best of ${packed.totalMatched} cached homes that still fit.`
            : `${livePullNotice({
                fromCache,
                stale: false,
                pulled,
                count: packed.totalMatched,
                fetchedAt: decision.cached?.fetchedAt ?? Date.now(),
                quota,
                searchArea: matrix.searchArea,
              })} ${top.length} pass must-haves.${packed.clip}`;
        return {
          source: pulled ? "rentcast" : "cache",
          notice,
          results: packed.results,
          totalMatched: packed.totalMatched,
          listings: packed.listings,
          quota,
          cache: getLiveCache(user.id),
          fromCache,
          pulled,
          needsConfirm: decision.action === "confirm",
          advice,
          saved: getCsvMeta(user),
        };
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
    const fromClient = sanitizeListings(body.listings);
    const liveList = listingsFromCache(user.id);
    let listings = fromClient.length ? fromClient : liveList?.length ? liveList : csv;
    if (!listings.length) listings = await loadListingSet(user);
    if (!listings.length) {
      const baseline = baselineStatus(matrix);
      const why = !baseline.complete
        ? `Nothing to grade, and your must-haves are incomplete (${baseline.gaps.filter((g) => !g.done).map((g) => g.label).join(", ")}).`
        : "Nothing to grade: no live cache and no saved CSV. Upload a Redfin CSV or confirm a live pull first.";
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
    const query = queryFromMatrix(matrix);
    if (fromClient.length) {
      rememberLivePull(user.id, query, fromClient);
      adoptLiveListings(user, fromClient);
    }
    const scoped = fromClient.length ? fromClient : liveList?.length ? listings : filterList(listings, body);
    const working = fromClient.length ? fromClient : filterListingsByQuery(scoped, query);
    return respondRanked(body.stream, working, matrix, async (ranked) => {
      await saveSearch(user, { source: "regrade" }, ranked.map((r) => r.listing.id));
      await saveListingSet(user, ranked.map((r) => r.listing), "regrade");
      for (const row of ranked) await saveGrade(user, row.listing, row.grade);
      const packed = packResults(ranked);
      const incomplete = ranked.filter((r) => r.grade.band === "incomplete").length;
      const cache = getLiveCache(user.id);
      const quota = getLiveQuota(user.id);
      const from = fromClient.length || liveList?.length ? "your last search" : `saved file ${saved?.filename ?? "CSV"}`;
      const notice =
        !ranked.length && scoped.length
          ? matrix.intent === "rent"
            ? "This list is homes for sale. Confirm a live pull to load rentals (uses 1 of 3), or switch back to Buy."
            : "No for-sale homes in this list — they look like rentals. Stay on Buy and confirm a live pull, or switch to Rent."
          : incomplete === ranked.length && ranked.length
            ? `Scored ${ranked.length} homes from ${from}, but every score is incomplete — your must-haves are not set, or listings lack year/type/price.${packed.clip}`
            : `Scored ${ranked.length} homes from ${from}${incomplete ? ` · ${incomplete} incomplete` : ""}.${packed.clip}`;
      return {
        source: fromClient.length || liveList?.length ? "cache" : "saved",
        notice,
        results: packed.results,
        totalMatched: packed.totalMatched,
        listings: packed.listings,
        quota,
        cache,
        saved,
      };
    });
  }

  if (body.source === "saved") {
    if (!csv.length) {
      return NextResponse.json(
        { error: "No saved CSV yet. Upload a Redfin Favorites file first.", saved: null },
        { status: 400 }
      );
    }
    return respondRanked(body.stream, filterList(csv, body), matrix, async (ranked) => {
      await saveSearch(user, { source: "saved" }, ranked.map((r) => r.listing.id));
      for (const row of ranked) await saveGrade(user, row.listing, row.grade);
      const packed = packResults(ranked);
      return {
        source: "saved",
        notice: `Scored ${packed.totalMatched} homes from saved file ${saved?.filename ?? "your CSV"}.${packed.clip}`,
        results: packed.results,
        totalMatched: packed.totalMatched,
        listings: packed.listings,
        quota: getLiveQuota(user.id),
        cache: getLiveCache(user.id),
        saved,
      };
    });
  }

  if (body.source === "favorites") {
    const listings = loadBundledRedfinFavorites();
    listings.forEach(rememberListing);
    if (!getUserListings(user).length) {
      saveCsvListings(user, listings, "starter-tampa.csv");
    }
    return respondRanked(body.stream, filterList(listings, body), matrix, async (ranked) => {
      await saveSearch(user, body, ranked.map((r) => r.listing.id));
      for (const row of ranked) await saveGrade(user, row.listing, row.grade);
      const packed = packResults(ranked);
      return {
        source: "redfin-favorites",
        notice: `Showing ${packed.clip ? `the top ${packed.results.length} of ${packed.totalMatched}` : `${packed.totalMatched}`} homes from the sample Valrico CSV. Your uploaded file is unchanged${saved ? ` (${saved.filename}, ${saved.count} homes)` : ""}.`,
        results: packed.results,
        totalMatched: packed.totalMatched,
        listings: packed.listings,
        quota: getLiveQuota(user.id),
        cache: getLiveCache(user.id),
        saved,
      };
    });
  }

  return NextResponse.json({ error: "Unknown search source." }, { status: 400 });
}
