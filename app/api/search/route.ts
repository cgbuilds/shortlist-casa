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
import { ensureMatrix } from "@/lib/matrix-tools";
import { getSessionUser, getUserListings, loadActiveMatrix, saveGrade, saveSearch, saveUserListings } from "@/lib/session";
import type { PropertyListing, UserMatrix } from "@/lib/types";

function rank(listings: PropertyListing[], matrix: UserMatrix) {
  return listings
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
  };

  const matrix = ensureMatrix(body.draft ?? (await loadActiveMatrix(user)));

  if (body.csv) {
    const parsed = parseRedfinCsv(body.csv);
    if (!parsed.length) {
      return NextResponse.json({ error: "No rows parsed. Use Redfin → Favorites → Download CSV." }, { status: 400 });
    }
    saveUserListings(user, parsed);
    const ranked = rank(filterList(parsed, body), matrix);
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
        },
        { status: 400 }
      );
    }
    const query = queryFromMatrix(matrix);
    const result = await searchListings(query);
    if (!result.listings.length) {
      return NextResponse.json({
        source: result.source,
        notice: result.notice ?? "No live listings matched that search.",
        results: [],
      });
    }
    saveUserListings(user, result.listings);
    const ranked = rank(result.listings, matrix);
    await saveSearch(user, { source: "live", query }, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    const top = ranked.filter((r) => !r.grade.mustHaveFailed);
    return NextResponse.json({
      source: "rentcast",
      notice: `Pulled ${result.listings.length} live listings around ${matrix.searchArea}. ${top.length} pass must-haves.`,
      results: ranked,
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
    const ranked = rank(result.listings, matrix);
    await saveSearch(user, body, ranked.map((r) => r.listing.id));
    for (const row of ranked) await saveGrade(user, row.listing, row.grade);
    return NextResponse.json({ source: result.source, notice: result.notice, results: ranked });
  }

  const listings = body.source === "favorites" ? loadBundledRedfinFavorites() : getUserListings(user);
  if (body.source === "favorites") saveUserListings(user, listings);
  const city = body.city || (body.q && !parseAddressFromInput(body.q) && !/\d/.test(body.q) ? body.q : undefined);
  const ranked = rank(filterList(listings, { ...body, city, q: city ? undefined : body.q }), matrix);
  await saveSearch(user, body, ranked.map((r) => r.listing.id));
  for (const row of ranked) await saveGrade(user, row.listing, row.grade);
  return NextResponse.json({
    source: body.source === "favorites" ? "redfin-favorites" : "session",
    notice: `${listings.length} homes from ${body.source === "favorites" ? "the sample Valrico Redfin CSV" : "your current list"}. Garage, laundry, flood, and walkability are unknown until you fill them on a property.`,
    results: ranked,
  });
}
