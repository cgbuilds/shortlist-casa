"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { MatrixPreview } from "@/components/MatrixPreview";
import { PropertyCard } from "@/components/PropertyCard";
import { RedfinUpload } from "@/components/RedfinUpload";
import type { GradeResult, PropertyListing, UserMatrix } from "@/lib/types";
import { defaultMatrix } from "@/kb/catalog";

const ResultsMap = dynamic(() => import("@/components/ResultsMap").then((m) => m.ResultsMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Loading map…</div>,
});

type Row = { listing: PropertyListing; grade: GradeResult };
type View = "list" | "split";

export function Workspace({ initialMatrix }: { initialMatrix: UserMatrix }) {
  const [matrix, setMatrix] = useState(initialMatrix ?? defaultMatrix());
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("split");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLevers, setShowLevers] = useState(true);
  const [liveSearch, setLiveSearch] = useState(false);
  const [signupUrl, setSignupUrl] = useState("https://www.rentcast.io/api");
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const [userLimit, setUserLimit] = useState(3);
  const [cacheCount, setCacheCount] = useState(0);
  const skipMatrixGrade = useRef(true);

  const applyGrade = useCallback((data: { results?: Row[]; notice?: string; error?: string; quota?: { remaining: number; userLimit: number }; cache?: { count: number } }) => {
    if (data.results) {
      setRows(data.results);
      if (data.results[0]) setSelectedId(data.results[0].listing.id);
    }
    setNotice(data.notice ?? data.error ?? "");
    if (data.quota) {
      setRemaining(data.quota.remaining);
      setUserLimit(data.quota.userLimit);
    }
    if (data.cache?.count != null) setCacheCount(data.cache.count);
  }, []);

  async function refreshGrades(m?: UserMatrix) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: m ?? matrix }),
    });
    applyGrade(await res.json());
  }

  async function runLive(m: UserMatrix, force: boolean) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "live", draft: m, force }),
    });
    applyGrade(await res.json());
  }

  useEffect(() => {
    void fetch("/api/search")
      .then((r) => r.json())
      .then((data: { liveSearch?: boolean; signupUrl?: string; quota?: { remaining: number; userLimit: number }; cache?: { count: number } }) => {
        setLiveSearch(Boolean(data.liveSearch));
        if (data.signupUrl) setSignupUrl(data.signupUrl);
        if (data.quota) {
          setRemaining(data.quota.remaining);
          setUserLimit(data.quota.userLimit);
        }
        if (data.cache?.count != null) setCacheCount(data.cache.count);
      })
      .catch(() => undefined);
    void refreshGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipMatrixGrade.current) {
      skipMatrixGrade.current = false;
      return;
    }
    const t = window.setTimeout(() => void refreshGrades(matrix), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex h-[42vh] min-h-0 w-full shrink-0 flex-col border-[var(--line)] lg:h-auto lg:w-[22rem] lg:border-r xl:w-[26rem]">
        <ChatPanel
          matrix={matrix}
          remaining={remaining}
          userLimit={userLimit}
          onMatrix={(m, _commit, extra) => {
            setMatrix(m);
            if (extra?.livePull) void runLive(m, true);
            else if (extra?.liveSearch) void runLive(m, false);
          }}
        />
        <RedfinUpload
          compact
          heading="Listings"
          matrix={matrix}
          liveSearch={liveSearch}
          signupUrl={signupUrl}
          remaining={remaining}
          userLimit={userLimit}
          cacheCount={cacheCount}
          onGraded={(data) => applyGrade(data as { results?: Row[]; notice?: string })}
        />
        <details
          className="border-t border-[var(--line)] text-sm"
          open={showLevers}
          onToggle={(e) => setShowLevers((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer px-3 py-2 text-[var(--muted)]">Scoring details</summary>
          <div className="max-h-80 overflow-y-auto px-3 pb-3">
            <MatrixPreview matrix={matrix} />
          </div>
        </details>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
          <p className="text-sm text-[var(--muted)]">
            {rows.length ? `${rows.length} homes` : "No homes yet"}
            {notice ? ` · ${notice}` : ""}
          </p>
          <div className="flex rounded-lg border border-[var(--line)] text-sm">
            <button
              type="button"
              className={`px-3 py-1.5 ${view === "list" ? "bg-[var(--ink)] text-[var(--paper)]" : ""}`}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 ${view === "split" ? "bg-[var(--ink)] text-[var(--paper)]" : ""}`}
              onClick={() => setView("split")}
            >
              List + map
            </button>
          </div>
        </div>

        <div className={`min-h-0 flex-1 ${view === "split" ? "flex flex-col md:flex-row" : "overflow-y-auto"}`}>
          {view === "split" ? (
            <div className="h-64 min-h-0 min-w-0 md:h-auto md:flex-1">
              <ResultsMap rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          ) : null}
          <div
            className={`space-y-3 overflow-y-auto p-3 ${view === "split" ? "md:w-[22rem] md:shrink-0 xl:w-[26rem]" : ""}`}
          >
            {rows.map((row) => (
              <div
                key={row.listing.id}
                onClick={() => setSelectedId(row.listing.id)}
                className={row.listing.id === selectedId ? "rounded-2xl ring-2 ring-[var(--accent)]" : ""}
              >
                <PropertyCard listing={row.listing} grade={row.grade} />
              </div>
            ))}
            {rows.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Set area, beds, baths, and type in chat, then Pull live listings — or upload a Redfin CSV.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
