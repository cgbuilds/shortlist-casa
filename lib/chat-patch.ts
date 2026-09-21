import { applyTool } from "@/lib/matrix-tools";
import type { ListingIntent, PropertyType, UserMatrix } from "@/lib/types";

/** Structured must-haves. OpenRouter fills this from raw chat + the interpret template. */
export type ChatPatch = {
  searchArea?: string | null;
  searchZip?: string | null;
  searchPoint?: string | null;
  searchRadiusMiles?: number | null;
  locationAllowlist?: string[] | null;
  intent?: ListingIntent | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  minBaths?: number | null;
  minSqft?: number | null;
  propertyType?: string | null;
  schoolRatingMin?: number | null;
};

const PLACE_WORDS = 6;

function clipPlace(raw: string, maxWords = PLACE_WORDS): string | undefined {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t === "") return "";
  const words = t.split(" ");
  if (words.length > maxWords) return undefined;
  return t.slice(0, 80);
}

function clipZip(raw: string): string | undefined {
  const t = raw.trim();
  if (t === "") return "";
  const m = t.match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1] : undefined;
}

export function applyChatPatch(matrix: UserMatrix, patch: ChatPatch): UserMatrix {
  const args: Record<string, unknown> = {};
  if (patch.searchArea != null) {
    const area = clipPlace(String(patch.searchArea), 6);
    if (area !== undefined) args.searchArea = area;
  }
  if (patch.searchZip != null) {
    const zip = clipZip(String(patch.searchZip));
    if (zip !== undefined) args.searchZip = zip;
  }
  if (patch.searchPoint != null) {
    const point = clipPlace(String(patch.searchPoint), 5);
    if (point !== undefined) args.searchPoint = point;
  }
  if (patch.searchRadiusMiles != null && Number.isFinite(Number(patch.searchRadiusMiles))) {
    args.searchRadiusMiles = Number(patch.searchRadiusMiles);
  }
  if (patch.locationAllowlist != null) args.locationAllowlist = patch.locationAllowlist;
  if (patch.intent === "buy" || patch.intent === "rent") args.intent = patch.intent;
  if (typeof patch.maxPrice === "number" && Number.isFinite(patch.maxPrice)) args.maxPrice = patch.maxPrice;
  let next = Object.keys(args).length ? applyTool(matrix, "set_budget", args).matrix : matrix;

  if (typeof patch.minBeds === "number" && patch.minBeds > 0) {
    next = applyTool(next, "set_dimension", { id: "beds", enabled: true, min: patch.minBeds, mustHave: true }).matrix;
  }
  if (typeof patch.minBaths === "number" && patch.minBaths > 0) {
    next = applyTool(next, "set_dimension", { id: "baths", enabled: true, min: patch.minBaths, mustHave: true }).matrix;
  }
  if (typeof patch.minSqft === "number" && patch.minSqft > 0) {
    next = applyTool(next, "set_dimension", { id: "sqft", enabled: true, min: patch.minSqft }).matrix;
  }
  const ptype = patch.propertyType as PropertyType | null | undefined;
  if (ptype && ["sfr", "townhouse", "condo", "multi"].includes(ptype)) {
    next = applyTool(next, "set_dimension", { id: "property_type", enabled: true, prefs: { prefer: ptype } }).matrix;
  }
  if (typeof patch.schoolRatingMin === "number" && patch.schoolRatingMin > 0) {
    next = applyTool(next, "set_dimension", {
      id: "school_rating",
      enabled: true,
      min: patch.schoolRatingMin,
      mustHave: true,
    }).matrix;
  }
  return next;
}

export function parseChatPatchJson(raw: string): { patch: ChatPatch; reply?: string; commit?: boolean; livePull?: boolean } | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      patch?: ChatPatch;
      reply?: string;
      commit?: boolean;
      livePull?: boolean;
    } & ChatPatch;
    const patch = parsed.patch ?? parsed;
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return {
      patch,
      reply: reply || undefined,
      commit: Boolean(parsed.commit),
      livePull: Boolean(parsed.livePull),
    };
  } catch {
    return null;
  }
}
