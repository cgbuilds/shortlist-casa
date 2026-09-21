import { applyTool } from "@/lib/matrix-tools";
import { cleanSearchArea, cleanSearchPoint } from "@/lib/search-location";
import type { ListingIntent, UserMatrix } from "@/lib/types";

/** Structured must-have changes. OpenRouter fills this; the catalog/tools are the only crib. */
export type ChatPatch = {
  searchArea?: string | null;
  searchZip?: string | null;
  searchPoint?: string | null;
  searchRadiusMiles?: number | null;
  locationAllowlist?: string[] | null;
  intent?: ListingIntent | null;
  maxPrice?: number | null;
};

export function applyChatPatch(matrix: UserMatrix, patch: ChatPatch): UserMatrix {
  const args: Record<string, unknown> = {};
  if (patch.searchArea != null) {
    const area = cleanSearchArea(String(patch.searchArea));
    if (area || patch.searchArea === "") args.searchArea = area;
  }
  if (patch.searchZip != null) args.searchZip = String(patch.searchZip);
  if (patch.searchPoint != null) {
    const point = cleanSearchPoint(String(patch.searchPoint));
    if (point || patch.searchPoint === "") args.searchPoint = point;
  }
  if (patch.searchRadiusMiles != null && Number.isFinite(Number(patch.searchRadiusMiles))) {
    args.searchRadiusMiles = Number(patch.searchRadiusMiles);
  }
  if (patch.locationAllowlist != null) args.locationAllowlist = patch.locationAllowlist;
  if (patch.intent === "buy" || patch.intent === "rent") args.intent = patch.intent;
  if (typeof patch.maxPrice === "number" && Number.isFinite(patch.maxPrice)) args.maxPrice = patch.maxPrice;
  if (!Object.keys(args).length) return matrix;
  return applyTool(matrix, "set_budget", args).matrix;
}

export function parseChatPatchJson(raw: string): { patch: ChatPatch; reply?: string } | null {
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
      searchArea?: string;
      searchZip?: string;
      searchPoint?: string;
      searchRadiusMiles?: number;
      locationAllowlist?: string[];
    };
    const patch = parsed.patch ?? {
      searchArea: parsed.searchArea,
      searchZip: parsed.searchZip,
      searchPoint: parsed.searchPoint,
      searchRadiusMiles: parsed.searchRadiusMiles,
      locationAllowlist: parsed.locationAllowlist,
    };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return { patch, reply: reply || undefined };
  } catch {
    return null;
  }
}
