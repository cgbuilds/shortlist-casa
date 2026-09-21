import { applyTool } from "@/lib/matrix-tools";
import type { ListingIntent, UserMatrix } from "@/lib/types";

/** Structured must-have changes. OpenRouter fills this; the catalog/tools are the only crib. */
export type ChatPatch = {
  searchArea?: string | null;
  searchZip?: string | null;
  searchPoint?: string | null;
  locationAllowlist?: string[] | null;
  intent?: ListingIntent | null;
  maxPrice?: number | null;
};

export function applyChatPatch(matrix: UserMatrix, patch: ChatPatch): UserMatrix {
  const args: Record<string, unknown> = {};
  if (patch.searchArea != null) args.searchArea = patch.searchArea;
  if (patch.searchZip != null) args.searchZip = String(patch.searchZip);
  if (patch.searchPoint != null) args.searchPoint = patch.searchPoint;
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
      locationAllowlist?: string[];
    };
    const patch = parsed.patch ?? {
      searchArea: parsed.searchArea,
      searchZip: parsed.searchZip,
      searchPoint: parsed.searchPoint,
      locationAllowlist: parsed.locationAllowlist,
    };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return { patch, reply: reply || undefined };
  } catch {
    return null;
  }
}
