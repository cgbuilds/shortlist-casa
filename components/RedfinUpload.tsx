"use client";

import { useRef, useState } from "react";
import { Fold } from "@/components/Fold";
import { postSearch } from "@/lib/search-client";
import type { RankProgress } from "@/lib/rank-presentation";
import type { UserMatrix } from "@/lib/types";

export type GradePayload = {
  results?: unknown[];
  notice?: string;
  source?: string;
  error?: string;
  signupUrl?: string;
  quota?: {
    remaining: number;
    userLimit: number;
    globalRemaining?: number;
  };
  fromCache?: boolean;
  pulled?: boolean;
  needsConfirm?: boolean;
  advice?: { advice?: string; coveragePct?: number | null; used?: number; userLimit?: number };
  saved?: { filename: string; count: number; savedAt: number } | null;
  listings?: unknown[];
};

export function RedfinUpload({
  heading = "Actions",
  compact,
  matrix,
  liveSearch,
  signupUrl,
  remaining,
  userLimit,
  globalRemaining,
  cacheCount,
  savedFilename,
  savedCount,
  onGraded,
  onScoreProgress,
  onSearchStart,
}: {
  heading?: string;
  compact?: boolean;
  matrix: UserMatrix;
  liveSearch?: boolean;
  signupUrl?: string;
  remaining?: number;
  userLimit?: number;
  globalRemaining?: number;
  cacheCount?: number;
  savedFilename?: string;
  savedCount?: number;
  onGraded?: (data: GradePayload) => void;
  onScoreProgress?: (p: RankProgress) => void;
  onSearchStart?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<"refresh" | "csv" | "sample" | "">("");

  async function grade(body: Record<string, unknown>, kind: "refresh" | "csv" | "sample") {
    setPending(kind);
    setStatus("");
    onSearchStart?.();
    try {
      const { ok, data } = await postSearch(body, { onProgress: onScoreProgress });
      if (!ok) {
        setStatus(data.error ?? "Could not load listings.");
        onGraded?.(data as GradePayload);
        return;
      }
      setStatus(data.notice ?? "Scored.");
      onGraded?.(data as GradePayload);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending("");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const csv = await file.text();
    await grade({ csv, source: "upload", draft: matrix, filename: file.name }, "csv");
  }

  const pullsLeft = remaining ?? userLimit ?? 3;
  const limit = userLimit ?? 3;
  const used = Math.max(0, limit - pullsLeft);
  const canSpendPull = pullsLeft > 0 && (globalRemaining == null || globalRemaining > 0);

  return (
    <section
      id="upload-csv"
      className={compact ? "border-t border-[var(--line)] p-3" : "rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"}
    >
      <p className="text-sm font-medium">{heading}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          disabled={Boolean(pending) || !canSpendPull}
          title="Spends 1 of 3 live searches. Cache never resets unless you confirm this or widen area/type/budget."
          onClick={() => void grade({ source: "live", draft: matrix, force: true }, "refresh")}
        >
          {pending === "refresh" ? "Pulling…" : `Use 1 live search (${used}/${limit})`}
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          disabled={Boolean(pending)}
          onClick={() => input.current?.click()}
        >
          {pending === "csv" ? "Scoring…" : "Upload CSV"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          disabled={Boolean(pending)}
          onClick={() => void grade({ source: "favorites", draft: matrix }, "sample")}
        >
          Sample list
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          suppressHydrationWarning
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {savedFilename && savedCount ? (
        <Fold title={`Saved file · ${savedCount} home${savedCount === 1 ? "" : "s"}`} titleClassName="text-[var(--accent)]">
          {savedFilename} stays on this account. Ask chat to rescore after you change must-haves. A live
          search will not replace this file.
        </Fold>
      ) : null}
      {liveSearch ? (
        <Fold title={`Live searches · ${used}/${limit} used`}>
          {pullsLeft} left this month. Cache stays until you confirm another pull or widen
          area/type/beds/price ({cacheCount ?? 0} cached). Coffee, vibe, and drainage never spend a
          pull. Ask chat before using another live search.
        </Fold>
      ) : signupUrl ? (
        <Fold title="Live search setup">
          Fastest live path: free RentCast key from{" "}
          <a href={signupUrl} target="_blank" rel="noreferrer" className="underline">
            rentcast.io/api
          </a>
          , then set <code>RENTCAST_API_KEY</code>. Or upload a Redfin Favorites CSV.
        </Fold>
      ) : (
        <Fold title="Live search setup">
          Upload a Redfin Favorites CSV, or add RENTCAST_API_KEY for live search.
        </Fold>
      )}
      {status ? (
        <Fold title={status.split(/[.!?]/)[0] || "Last result"}>
          {status}
        </Fold>
      ) : null}
    </section>
  );
}
