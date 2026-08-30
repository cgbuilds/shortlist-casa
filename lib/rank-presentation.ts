import type { GradeResult, PropertyListing } from "@/lib/types";

export type RankRow = { listing: PropertyListing; grade: GradeResult };

export type RankProgress = {
  analyzed: number;
  total: number;
  processing: number;
  results: RankRow[];
  totalMatched: number;
};

export function scoreStatusLabel(p: Pick<RankProgress, "analyzed" | "total" | "processing">) {
  if (p.total <= 0) return "";
  if (p.processing > 0) return `${p.analyzed}/${p.total} scored, ${p.processing} processing…`;
  return `${p.analyzed}/${p.total} scored`;
}

export function resultsHeadline(shown: number, total: number) {
  if (!shown) return "No homes yet";
  if (total > shown) return `Showing the top ${shown} of ${total} by score`;
  return `Showing ${shown} by score`;
}
