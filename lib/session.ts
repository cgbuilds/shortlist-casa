import { cookies } from "next/headers";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { dataDir, writeJsonFile } from "@/lib/data-dir";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { ensureMatrix } from "@/lib/matrix-tools";
import { findRedfinListing } from "@/lib/redfin-csv";
import { recallListing, rememberListing } from "@/lib/rentcast";
import type { PropertyListing, UserMatrix } from "@/lib/types";

export const DEMO_COOKIE = "pm_demo";

export type SessionUser = { id: string; email: string; demo: boolean };

const memoryMatrices = new Map<string, UserMatrix>();
const memoryGrades = new Map<string, { listing: PropertyListing; facts: PropertyListing["facts"] }[]>();
const memoryCsv = new Map<string, SavedCsv>();

export type SavedCsvMeta = {
  filename: string;
  count: number;
  savedAt: number;
};

type SavedCsv = SavedCsvMeta & { listings: PropertyListing[] };

function csvFile(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "user";
  return join(dataDir(), `csv-${safe}.json`);
}

function hydrateCsv(userId: string): SavedCsv | null {
  const mem = memoryCsv.get(userId);
  if (mem) return mem;
  try {
    const file = csvFile(userId);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8")) as SavedCsv;
    if (!Array.isArray(raw.listings) || !raw.listings.length) return null;
    memoryCsv.set(userId, raw);
    return raw;
  } catch {
    return null;
  }
}

function persistCsv(userId: string, row: SavedCsv) {
  memoryCsv.set(userId, row);
  writeJsonFile(csvFile(userId), row);
}

export function saveCsvListings(user: SessionUser, listings: PropertyListing[], filename: string) {
  listings.forEach(rememberListing);
  persistCsv(user.id, {
    filename: filename.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "favorites.csv",
    count: listings.length,
    savedAt: Date.now(),
    listings,
  });
}

/** Keep regrade on the pulled set. Do not overwrite a user-uploaded Redfin CSV. */
export function adoptLiveListings(user: SessionUser, listings: PropertyListing[]) {
  if (!listings.length) return;
  const name = getCsvMeta(user)?.filename ?? "";
  if (name && name !== "starter-tampa.csv" && !name.startsWith("live-")) return;
  saveCsvListings(user, listings, "live-search.json");
}

export function getCsvListings(user: SessionUser): PropertyListing[] {
  return hydrateCsv(user.id)?.listings ?? [];
}

export function getCsvMeta(user: SessionUser): SavedCsvMeta | null {
  const row = hydrateCsv(user.id);
  if (!row) return null;
  return { filename: row.filename, count: row.count, savedAt: row.savedAt };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      return { id: data.user.id, email: data.user.email ?? "", demo: false };
    }
  }
  const jar = await cookies();
  if (jar.get(DEMO_COOKIE)?.value === "1") {
    return { id: "demo-user", email: "family@demo.local", demo: true };
  }
  return null;
}

function matrixFile(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "user";
  return join(dataDir(), `matrix-${safe}.json`);
}

function hydrateMatrix(userId: string): UserMatrix | undefined {
  const mem = memoryMatrices.get(userId);
  if (mem) return mem;
  try {
    const file = matrixFile(userId);
    if (!existsSync(file)) return undefined;
    const raw = JSON.parse(readFileSync(file, "utf8")) as UserMatrix;
    const matrix = ensureMatrix(raw);
    memoryMatrices.set(userId, matrix);
    return matrix;
  } catch {
    return undefined;
  }
}

function persistMatrix(userId: string, matrix: UserMatrix) {
  memoryMatrices.set(userId, matrix);
  writeJsonFile(matrixFile(userId), matrix);
}

export async function loadActiveMatrix(user: SessionUser): Promise<UserMatrix> {
  if (!user.demo && isSupabaseConfigured()) {
    const supabase = await createSupabaseServer();
    if (supabase) {
      const { data } = await supabase
        .from("matrices")
        .select("payload")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (data?.payload) {
        const matrix = ensureMatrix(data.payload as UserMatrix);
        memoryMatrices.set(user.id, matrix);
        return matrix;
      }
    }
  }
  return ensureMatrix(hydrateMatrix(user.id));
}

export async function saveActiveMatrix(user: SessionUser, matrix: UserMatrix) {
  persistMatrix(user.id, matrix);
  if (user.demo || !isSupabaseConfigured()) return;
  const supabase = await createSupabaseServer();
  if (!supabase) return;
  await supabase.from("matrices").update({ is_active: false }).eq("user_id", user.id);
  await supabase.from("matrices").insert({
    user_id: user.id,
    catalog_version: matrix.catalogVersion,
    payload: matrix,
    is_active: true,
  });
}

export async function saveSearch(user: SessionUser, query: unknown, listingIds: string[]) {
  if (user.demo || !isSupabaseConfigured()) return;
  const supabase = await createSupabaseServer();
  if (!supabase) return;
  await supabase.from("searches").insert({ user_id: user.id, query, listing_ids: listingIds });
}

export async function saveGrade(user: SessionUser, listing: PropertyListing, scores: unknown) {
  rememberListing(listing);
  const prev = memoryGrades.get(user.id) ?? [];
  memoryGrades.set(user.id, [{ listing, facts: listing.facts }, ...prev].slice(0, 200));
  if (user.demo || !isSupabaseConfigured()) return;
  const supabase = await createSupabaseServer();
  if (!supabase) return;
  await supabase.from("graded_listings").insert({
    user_id: user.id,
    listing_id: listing.id,
    property: listing,
    scores,
  });
}

export function getUserListings(user: SessionUser): PropertyListing[] {
  const csv = getCsvListings(user);
  if (csv.length) return csv;
  return [];
}

export function memoryListingFor(userId: string, listingId: string): PropertyListing | undefined {
  const rows = memoryGrades.get(userId) ?? [];
  return rows.find((r) => r.listing.id === listingId)?.listing;
}

export async function loadListing(user: SessionUser, listingId: string): Promise<PropertyListing | null> {
  const mem = memoryListingFor(user.id, listingId);
  if (mem) return mem;
  if (!user.demo && isSupabaseConfigured()) {
    const supabase = await createSupabaseServer();
    if (supabase) {
      const { data } = await supabase
        .from("graded_listings")
        .select("property")
        .eq("user_id", user.id)
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.property) return data.property as PropertyListing;
    }
  }
  return recallListing(listingId) ?? findRedfinListing(listingId) ?? null;
}
