import { NextResponse } from "next/server";
import { grade } from "@/lib/grade";
import { parseAddressFromInput } from "@/lib/parse-address";
import { loadBundledRedfinFavorites, parseRedfinCsv } from "@/lib/redfin-csv";
import { rememberListing, searchListings } from "@/lib/rentcast";
import { getSessionUser, getUserListings, loadActiveMatrix, saveGrade, saveSearch, saveUserListings } from "@/lib/session";
import type { PropertyListing } from "@/lib/types";
import type { UserMatrix } from "@/lib/types";

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
    source?: "favorites" | "rentcast" | "upload";
  };

  const matrix = await loadActiveMatrix(user);

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
