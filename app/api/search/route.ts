import { NextResponse } from "next/server";
import { grade } from "@/lib/grade";
import { parseAddressFromInput } from "@/lib/parse-address";
import { rememberListing, searchListings } from "@/lib/rentcast";
import { getSessionUser, loadActiveMatrix, saveGrade, saveSearch } from "@/lib/session";

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
  };

  const parsed = body.q ? parseAddressFromInput(body.q) : null;
  const looksLikePlace = body.q && !parsed && !/\d/.test(body.q);
  const result = await searchListings({
    city: body.city || (looksLikePlace ? body.q : undefined),
    state: body.state || (looksLikePlace ? "FL" : undefined),
    zip: body.zip,
    minBeds: body.minBeds,
    minSqft: body.minSqft,
    maxPrice: body.maxPrice,
    address: parsed || undefined,
  });

  const matrix = await loadActiveMatrix(user);
  const ranked = result.listings
    .map((listing) => {
      rememberListing(listing);
      const g = grade(listing, matrix);
      return { listing, grade: g };
    })
    .sort((a, b) => {
      if (a.grade.mustHaveFailed !== b.grade.mustHaveFailed) return a.grade.mustHaveFailed ? 1 : -1;
      return (b.grade.total ?? -1) - (a.grade.total ?? -1);
    });

  await saveSearch(
    user,
    body,
    ranked.map((r) => r.listing.id)
  );
  for (const row of ranked) await saveGrade(user, row.listing, row.grade);

  return NextResponse.json({
    source: result.source,
    notice: result.notice,
    results: ranked,
  });
}
