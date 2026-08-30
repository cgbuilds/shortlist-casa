"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Fold } from "@/components/Fold";
import { ChatPanel } from "@/components/ChatPanel";
import { ChatFab, ChatSheet } from "@/components/ChatSheet";
import { MatrixPreview } from "@/components/MatrixPreview";
import { PropertyCard } from "@/components/PropertyCard";
import { RedfinUpload } from "@/components/RedfinUpload";
import type { GradeResult, PropertyListing, UserMatrix } from "@/lib/types";
import { defaultMatrix } from "@/kb/catalog";
import { takeTopListings } from "@/lib/grade";
import { postSearch } from "@/lib/search-client";
import { resultsHeadline, scoreStatusLabel, type RankProgress } from "@/lib/rank-presentation";

const ResultsMap = dynamic(() => import("@/components/ResultsMap").then((m) => m.ResultsMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Loading map…</div>,
});

type Row = { listing: PropertyListing; grade: GradeResult };
const BANNER_KEY = "homestead-starter-banner-dismissed";

export function Workspace({ initialMatrix }: { initialMatrix: UserMatrix }) {
  const [matrix, setMatrix] = useState(initialMatrix ?? defaultMatrix());
  const [rows, setRows] = useState<Row[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveSearch, setLiveSearch] = useState(false);
  const [signupUrl, setSignupUrl] = useState("https://www.rentcast.io/api");
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const [userLimit, setUserLimit] = useState(3);
  const [globalRemaining, setGlobalRemaining] = useState<number | undefined>(undefined);
  const [globalUsed, setGlobalUsed] = useState<number | undefined>(undefined);
  const [globalLimit, setGlobalLimit] = useState(50);
  const [cacheCount, setCacheCount] = useState(0);
  const [savedFilename, setSavedFilename] = useState<string | undefined>(undefined);
  const [savedCount, setSavedCount] = useState<number | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [regrading, setRegrading] = useState(false);
  const [scoreProgress, setScoreProgress] = useState<Pick<RankProgress, "analyzed" | "total" | "processing"> | null>(
    null
  );
  const [job, setJob] = useState<{ tone: "err"; text: string } | null>(null);
  const skipMatrixGrade = useRef(true);
  const scoreAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (window.sessionStorage.getItem(BANNER_KEY) === "1") setShowBanner(false);
  }, []);

  const persistMatrix = (m: UserMatrix) => {
    setMatrix(m);
    void fetch("/api/matrix", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matrix: m }),
    }).catch(() => undefined);
  };

  const applySaved = (saved?: { filename: string; count: number } | null) => {
    if (!saved) return;
    setSavedFilename(saved.filename);
    setSavedCount(saved.count);
  };

  const applyGrade = useCallback((data: {
    results?: Row[];
    totalMatched?: number;
    notice?: string;
    error?: string;
    quota?: { remaining: number; userLimit: number; globalRemaining?: number; globalUsed?: number; globalLimit?: number };
    cache?: { count: number };
    saved?: { filename: string; count: number } | null;
  }) => {
    if (Array.isArray(data.results)) {
      if (data.results.length || !data.error) {
        const top = takeTopListings(data.results);
        setRows(top);
        setTotalMatched(data.totalMatched ?? data.results.length);
        if (top[0]) setSelectedId(top[0].listing.id);
      }
    }
    if (data.quota) {
      setRemaining(data.quota.remaining);
      setUserLimit(data.quota.userLimit);
      if (data.quota.globalRemaining != null) setGlobalRemaining(data.quota.globalRemaining);
      if (data.quota.globalUsed != null) setGlobalUsed(data.quota.globalUsed);
      if (data.quota.globalLimit != null) setGlobalLimit(data.quota.globalLimit);
    }
    if (data.cache?.count != null) setCacheCount(data.cache.count);
    applySaved(data.saved);
  }, []);

  const onScoreProgress = useCallback(
    (p: RankProgress) => {
      setScoreProgress(p);
      applyGrade({ results: p.results, totalMatched: p.totalMatched });
    },
    [applyGrade]
  );

  async function runScoring(body: Record<string, unknown>) {
    scoreAbort.current?.abort();
    const ac = new AbortController();
    scoreAbort.current = ac;
    setScoreProgress({ analyzed: 0, total: totalMatched || 0, processing: 0 });
    try {
      const { ok, status, data } = await postSearch(body, { onProgress: onScoreProgress, signal: ac.signal });
      applyGrade(data);
      if (!ok) throw new Error(data.error ?? `Scoring failed (${status})`);
      return data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return undefined;
      throw err;
    } finally {
      if (scoreAbort.current === ac) {
        scoreAbort.current = null;
        setScoreProgress(null);
      }
    }
  }

  async function refreshGrades(m?: UserMatrix) {
    return runScoring({ source: "regrade", draft: m ?? matrix });
  }

  async function runLive(m: UserMatrix, force: boolean) {
    setRegrading(true);
    try {
      await runScoring({ source: "live", draft: m, force });
    } catch (err) {
      setJob({
        tone: "err",
        text: err instanceof Error ? err.message : "Live search failed.",
      });
    } finally {
      setRegrading(false);
    }
  }

  useEffect(() => {
    void fetch("/api/search")
      .then((r) => r.json())
      .then((data: {
        liveSearch?: boolean;
        signupUrl?: string;
        quota?: { remaining: number; userLimit: number; globalRemaining?: number; globalUsed?: number; globalLimit?: number };
        cache?: { count: number };
        saved?: { filename: string; count: number } | null;
      }) => {
        setLiveSearch(Boolean(data.liveSearch));
        if (data.signupUrl) setSignupUrl(data.signupUrl);
        if (data.quota) {
          setRemaining(data.quota.remaining);
          setUserLimit(data.quota.userLimit);
          if (data.quota.globalRemaining != null) setGlobalRemaining(data.quota.globalRemaining);
          if (data.quota.globalUsed != null) setGlobalUsed(data.quota.globalUsed);
          if (data.quota.globalLimit != null) setGlobalLimit(data.quota.globalLimit);
        }
        if (data.cache?.count != null) setCacheCount(data.cache.count);
        if (data.saved) {
          setSavedFilename(data.saved.filename);
          setSavedCount(data.saved.count);
        }
      })
      .catch(() => undefined);

    void (async () => {
      try {
        const data = await refreshGrades();
        if (data?.results?.length) return;
      } catch {
        /* no saved list yet */
      }
      try {
        await runScoring({ source: "favorites", draft: matrix });
      } catch (err) {
        setJob({
          tone: "err",
          text: err instanceof Error ? err.message : "Could not load starter homes.",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipMatrixGrade.current) {
      skipMatrixGrade.current = false;
      return;
    }
    const t = window.setTimeout(() => void refreshGrades(matrix).catch(() => undefined), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  const progressLine = scoreProgress && scoreProgress.total > 0 ? scoreStatusLabel(scoreProgress) : "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {showBanner ? (
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 text-sm">
          <p className="min-w-0 text-[var(--ink)]">
            Starter homes are on the map.{" "}
            <button type="button" className="font-medium underline" onClick={() => setChatOpen(true)}>
              Talk to the agent
            </button>{" "}
            to update this list and the scores.
            {progressLine ? <span className="mt-0.5 block text-xs text-[var(--muted)]">{progressLine}</span> : null}
          </p>
          <button
            type="button"
            className="shrink-0 text-xs text-[var(--muted)]"
            onClick={() => {
              setShowBanner(false);
              window.sessionStorage.setItem(BANNER_KEY, "1");
            }}
          >
            Dismiss
          </button>
        </div>
      ) : progressLine ? (
        <p className="shrink-0 border-b border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)]">{progressLine}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{resultsHeadline(rows.length, totalMatched)}</p>
        {regrading ? <span className="text-xs text-[var(--muted)]">Scoring…</span> : null}
      </div>
      {job?.tone === "err" ? (
        <p className="border-b border-[var(--line)] bg-red-50 px-3 py-2 text-sm text-red-800">{job.text}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-[12rem] min-w-0 flex-[1.2] overflow-hidden">
          <ResultsMap
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            layoutTick={chatOpen ? "chat" : "map"}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 md:w-[22rem] md:flex-none md:shrink-0 xl:w-[26rem]">
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
              Loading starter homes… If nothing appears, open chat and ask for a Tampa list.
            </p>
          ) : null}
        </div>
      </div>

      {chatOpen ? null : <ChatFab onClick={() => setChatOpen(true)} />}
      <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)}>
        <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel
          matrix={matrix}
          remaining={remaining}
          userLimit={userLimit}
          scoreProgress={scoreProgress}
          onMatrix={(m, _commit, extra) => {
            persistMatrix(m);
            if (extra?.livePull) void runLive(m, true);
            else if (extra?.liveSearch) void runLive(m, false);
          }}
        />
        </div>
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-[var(--line)]">
          <RedfinUpload
            compact
            heading="Actions"
            matrix={matrix}
            liveSearch={liveSearch}
            signupUrl={signupUrl}
            remaining={remaining}
            userLimit={userLimit}
            globalRemaining={globalRemaining}
            globalUsed={globalUsed}
            globalLimit={globalLimit}
            cacheCount={cacheCount}
            savedFilename={savedFilename}
            savedCount={savedCount}
            onGraded={(data) => {
              setScoreProgress(null);
              applyGrade(data as Parameters<typeof applyGrade>[0]);
            }}
            onScoreProgress={onScoreProgress}
          />
          <div className="border-t border-[var(--line)] px-3 pb-3">
            <Fold title="Your must-haves" titleClassName="text-sm text-[var(--muted)]">
              <div className="max-h-40 overflow-y-auto">
                <MatrixPreview matrix={matrix} />
              </div>
            </Fold>
          </div>
        </div>
      </ChatSheet>
    </div>
  );
}
