"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Fold } from "@/components/Fold";
import { ChatPanel } from "@/components/ChatPanel";
import { MatrixPreview } from "@/components/MatrixPreview";
import { PropertyCard } from "@/components/PropertyCard";
import { RedfinUpload } from "@/components/RedfinUpload";
import type { GradeResult, PropertyListing, UserMatrix } from "@/lib/types";
import { defaultMatrix } from "@/kb/catalog";
import { takeTopListings } from "@/lib/grade";
import { postSearch } from "@/lib/search-client";
import { resultsHeadline, type RankProgress } from "@/lib/rank-presentation";

const ResultsMap = dynamic(() => import("@/components/ResultsMap").then((m) => m.ResultsMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Loading map…</div>,
});

type Row = { listing: PropertyListing; grade: GradeResult };
type View = "list" | "split";

export function Workspace({ initialMatrix }: { initialMatrix: UserMatrix }) {
  const [matrix, setMatrix] = useState(initialMatrix ?? defaultMatrix());
  const [rows, setRows] = useState<Row[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [view, setView] = useState<View>("split");
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
  const [chatH, setChatH] = useState(320);
  const [mobilePane, setMobilePane] = useState<"homes" | "chat">("homes");
  const [regrading, setRegrading] = useState(false);
  const [scoreProgress, setScoreProgress] = useState<Pick<RankProgress, "analyzed" | "total" | "processing"> | null>(
    null
  );
  const [job, setJob] = useState<{ tone: "busy" | "ok" | "err"; text: string } | null>(null);
  const skipMatrixGrade = useRef(true);
  const scoreAbort = useRef<AbortController | null>(null);
  const chatDrag = useRef<{ y: number; h: number } | null>(null);
  const chatHRef = useRef(chatH);
  chatHRef.current = chatH;

  useEffect(() => {
    const stored = Number(window.sessionStorage.getItem("homestead-chat-h"));
    if (Number.isFinite(stored) && stored >= 160) setChatH(stored);
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

  async function forceRegrade() {
    setRegrading(true);
    setJob(null);
    try {
      await refreshGrades();
    } catch (err) {
      setJob({
        tone: "err",
        text: err instanceof Error ? err.message : "Scoring failed.",
      });
    } finally {
      setRegrading(false);
    }
  }

  async function runLive(m: UserMatrix, force: boolean) {
    setRegrading(true);
    try {
      const data = await runScoring({ source: "live", draft: m, force });
      if (data?.results?.length) setMobilePane("homes");
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
    void refreshGrades().catch(() => undefined);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside
        className={`min-h-0 w-full flex-col border-[var(--line)] ${
          mobilePane === "chat" ? "flex flex-1" : "hidden"
        } lg:flex lg:h-full lg:w-[22rem] lg:flex-none lg:border-r xl:w-[26rem]`}
      >
        <div
          className="flex min-h-0 flex-1 flex-col lg:h-[var(--chat-h)] lg:flex-none lg:shrink-0"
          style={{ ["--chat-h" as string]: `${chatH}px` } as React.CSSProperties}
        >
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
        <div
          role="separator"
          aria-label="Drag to expand chat"
          title="Drag to expand chat"
          className="hidden h-3 shrink-0 cursor-ns-resize items-center justify-center border-y border-[var(--line)] bg-[var(--paper-2)] hover:bg-[var(--line)] lg:flex"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            chatDrag.current = { y: e.clientY, h: chatH };
          }}
          onPointerMove={(e) => {
            if (!chatDrag.current) return;
            const max = Math.round(window.innerHeight * 0.75);
            const next = Math.min(max, Math.max(160, chatDrag.current.h + (e.clientY - chatDrag.current.y)));
            setChatH(next);
          }}
          onPointerUp={() => {
            chatDrag.current = null;
            window.sessionStorage.setItem("homestead-chat-h", String(chatHRef.current));
          }}
        >
          <span className="block h-0.5 w-10 rounded-full bg-[var(--muted)]" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
            if (Array.isArray(data.results) && data.results.length) setMobilePane("homes");
          }}
          onScoreProgress={onScoreProgress}
        />
        <div className="border-t border-[var(--line)] px-3 pb-3">
          <Fold title="Your must-haves" titleClassName="text-sm text-[var(--muted)]">
            <div className="max-h-80 overflow-y-auto">
              <MatrixPreview matrix={matrix} />
            </div>
          </Fold>
        </div>
        </div>
      </aside>

      <section
        className={`min-h-0 min-w-0 flex-col ${
          mobilePane === "homes" ? "flex flex-1" : "hidden"
        } lg:flex lg:flex-1`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">
            {resultsHeadline(rows.length, totalMatched)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={regrading}
              title="Score the current list again. Does not spend a live search."
              onClick={() => void forceRegrade()}
            >
              {regrading ? "Scoring…" : "Run Scoring"}
            </button>
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
              <span className="lg:hidden">Map</span>
              <span className="hidden lg:inline">List + map</span>
            </button>
            </div>
          </div>
        </div>
        {job?.tone === "err" ? (
          <p className="border-b border-[var(--line)] bg-red-50 px-3 py-2 text-sm text-red-800">
            {job.text}
          </p>
        ) : null}

        <div className={`min-h-0 flex-1 ${view === "split" ? "flex flex-col md:flex-row" : "overflow-y-auto"}`}>
          {view === "split" ? (
            <div className="min-h-[11rem] min-w-0 flex-[1.15] md:h-auto md:flex-1">
              <ResultsMap
                rows={rows}
                selectedId={selectedId}
                onSelect={setSelectedId}
                layoutTick={`${mobilePane}-${view}`}
              />
            </div>
          ) : null}
          <div
            className={`space-y-3 overflow-y-auto p-3 ${
              view === "split" ? "min-h-0 flex-1 md:w-[22rem] md:flex-none md:shrink-0 xl:w-[26rem]" : ""
            }`}
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

      <nav className="grid shrink-0 grid-cols-2 border-t border-[var(--line)] bg-[var(--paper-2)] pb-[env(safe-area-inset-bottom)] lg:hidden">
        <button
          type="button"
          className={`px-3 py-2.5 text-sm ${mobilePane === "homes" ? "bg-[var(--ink)] text-[var(--paper)]" : ""}`}
          onClick={() => setMobilePane("homes")}
        >
          Homes
        </button>
        <button
          type="button"
          className={`px-3 py-2.5 text-sm ${mobilePane === "chat" ? "bg-[var(--ink)] text-[var(--paper)]" : ""}`}
          onClick={() => setMobilePane("chat")}
        >
          Chat
        </button>
      </nav>
    </div>
  );
}
