import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { ensureMatrix } from "@/lib/matrix-tools";
import { findRedfinListing, loadBundledRedfinFavorites } from "@/lib/redfin-csv";
import { recallListing, rememberListing } from "@/lib/rentcast";
import type { PropertyListing, UserMatrix } from "@/lib/types";

export const DEMO_COOKIE = "pm_demo";

export type SessionUser = { id: string; email: string; demo: boolean };

const memoryMatrices = new Map<string, UserMatrix>();
const memoryGrades = new Map<string, { listing: PropertyListing; facts: PropertyListing["facts"] }[]>();
const memoryUploads = new Map<string, PropertyListing[]>();

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
      if (data?.payload) return ensureMatrix(data.payload as UserMatrix);
    }
  }
  return ensureMatrix(memoryMatrices.get(user.id));
}

export async function saveActiveMatrix(user: SessionUser, matrix: UserMatrix) {
  memoryMatrices.set(user.id, matrix);
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

export function saveUserListings(user: SessionUser, listings: PropertyListing[]) {
  memoryUploads.set(user.id, listings);
  listings.forEach(rememberListing);
}

export function getUserListings(user: SessionUser): PropertyListing[] {
  return memoryUploads.get(user.id) ?? loadBundledRedfinFavorites();
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
