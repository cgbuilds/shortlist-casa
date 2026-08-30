import { grade, takeTopListings } from "@/lib/grade";
import { enrichListingsForMatrix } from "@/lib/osm-amenities";
import { rememberListing } from "@/lib/rentcast";
import type { GradeResult, PropertyListing, UserMatrix } from "@/lib/types";

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

const BATCH = 3;

function sortRows(rows: RankRow[]) {
  return [...rows].sort((a, b) => {
    if (a.grade.mustHaveFailed !== b.grade.mustHaveFailed) return a.grade.mustHaveFailed ? 1 : -1;
    return (b.grade.total ?? -1) - (a.grade.total ?? -1);
  });
}

export async function rankListings(
  listings: PropertyListing[],
  matrix: UserMatrix,
  onProgress?: (p: RankProgress) => void
): Promise<RankRow[]> {
  const total = listings.length;
  const done: RankRow[] = [];
  const emit = (processing: number) => {
    const sorted = sortRows(done);
    onProgress?.({
      analyzed: done.length,
      total,
      processing,
      results: takeTopListings(sorted),
      totalMatched: total,
    });
  };
  emit(Math.min(BATCH, total));
  for (let i = 0; i < listings.length; i += BATCH) {
    const batch = listings.slice(i, i + BATCH);
    emit(batch.length);
    const part = await Promise.all(
      batch.map(async (listing) => {
        const [ready] = await enrichListingsForMatrix([listing], matrix);
        rememberListing(ready);
        return { listing: ready, grade: grade(ready, matrix) };
      })
    );
    done.push(...part);
  }
  const ranked = sortRows(done);
  onProgress?.({
    analyzed: total,
    total,
    processing: 0,
    results: takeTopListings(ranked),
    totalMatched: ranked.length,
  });
  return ranked;
}
