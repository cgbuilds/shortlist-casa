import { NextResponse } from "next/server";
import { applyFactOverrides, grade } from "@/lib/grade";
import { rememberListing } from "@/lib/rentcast";
import { getSessionUser, loadActiveMatrix, loadListing, saveGrade } from "@/lib/session";
import type { PropertyListing } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const listing = await loadListing(user, id);
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const matrix = await loadActiveMatrix(user);
  return NextResponse.json({ listing, grade: grade(listing, matrix) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const existing = await loadListing(user, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const patch = (await request.json()) as Partial<PropertyListing> & PropertyListing["facts"];
  const listing = applyFactOverrides(existing, patch);
  rememberListing(listing);
  const matrix = await loadActiveMatrix(user);
  const g = grade(listing, matrix);
  await saveGrade(user, listing, g);
  return NextResponse.json({ listing, grade: g });
}
