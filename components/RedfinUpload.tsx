"use client";

import { useRef, useState } from "react";
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
    globalUsed?: number;
    globalLimit?: number;
  };
  fromCache?: boolean;
  pulled?: boolean;
  needsConfirm?: boolean;
  advice?: { advice?: string; coveragePct?: number | null; used?: number; userLimit?: number };
  saved?: { filename: string; count: number; savedAt: number } | null;
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
  globalUsed,
  globalLimit,
  cacheCount,
  savedFilename,
  savedCount,
  onGraded,
}: {
  heading?: string;
  compact?: boolean;
  matrix: UserMatrix;
  liveSearch?: boolean;
  signupUrl?: string;
  remaining?: number;
  userLimit?: number;
  globalRemaining?: number;
  globalUsed?: number;
  globalLimit?: number;
  cacheCount?: number;
  savedFilename?: string;
  savedCount?: number;
  onGraded?: (data: GradePayload) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<"live" | "refresh" | "csv" | "sample" | "">("");

  async function grade(body: Record<string, unknown>, kind: "live" | "refresh" | "csv" | "sample") {
    setPending(kind);
    setStatus("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as GradePayload;
      if (!res.ok) {
        setStatus(data.error ?? "Could not load listings.");
        onGraded?.(data);
        return;
      }
      setStatus(data.notice ?? "Graded.");
      onGraded?.(data);
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
  const accountLeft = globalRemaining ?? globalLimit ?? 50;
  const accountLimit = globalLimit ?? 50;
  const accountUsed = globalUsed ?? Math.max(0, accountLimit - accountLeft);
  const canSpendPull = pullsLeft > 0 && accountLeft > 0;

  return (
    <section
      id="upload-csv"
      className={compact ? "border-t border-[var(--line)] p-3" : "rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"}
    >
      <p className="text-sm font-medium">{heading}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={Boolean(pending)}
          onClick={() =>
            void grade(
              savedCount
                ? { source: "saved", draft: matrix }
                : { source: "live", draft: matrix, force: false },
              "live"
            )
          }
        >
          {pending === "live" ? "Re-grading…" : "Re-grade"}
        </button>
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
          {pending === "csv" ? "Grading…" : "Upload CSV"}
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
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {savedFilename && savedCount ? (
        <p className="mt-2 text-sm text-[var(--accent)]">
          Saved {savedFilename} — {savedCount} home{savedCount === 1 ? "" : "s"} on file. It persists after
          refresh. Re-grade uses this list; live search will not replace it.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-[var(--muted)]">
        {liveSearch ? (
          <>
            Live searches {used}/{limit} used · {pullsLeft} left. RentCast account {accountUsed}/{accountLimit}{" "}
            this month (hard stop at 50 — no $0.20 overage). Cache stays until you confirm another pull or
            widen area/type/beds/price ({cacheCount ?? 0} cached). <strong>Re-grade</strong> (also on the homes
            bar) scores the current list for free. Coffee, vibe, and drainage never spend a pull. Ask chat
            before using another live search.
          </>
        ) : signupUrl ? (
          <>
            Fastest live path: free RentCast key (50 pulls/month) from{" "}
            <a href={signupUrl} target="_blank" rel="noreferrer" className="underline">
              rentcast.io/api
            </a>
            , then set <code>RENTCAST_API_KEY</code>. Or upload a Redfin Favorites CSV.
          </>
        ) : (
          "Upload a Redfin Favorites CSV, or add RENTCAST_API_KEY for live search."
        )}
      </p>
      {status ? <p className="mt-1 text-xs text-[var(--muted)]">{status}</p> : null}
    </section>
  );
}
