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
import { postSearch, type SearchResponse } from "@/lib/search-client";
import { resultsHeadline, scoreStatusLabel, type RankProgress } from "@/lib/rank-presentation";
import { sampleListingFits } from "@/lib/sample-fit";
import { readStoredPool, readStoredSession, writeStoredPool, writeStoredMatrix, writeStoredSession } from "@/lib/listings-payload";

const ResultsMap = dynamic(() => import("@/components/ResultsMap").then((m) => m.ResultsMap), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Loading map…</div>,
});

type Row = { listing: PropertyListing; grade: GradeResult };
const BANNER_KEY = "homestead-starter-banner-dismissed";

function isOwnListSource(source: string, filename?: string, pulled?: boolean) {
  if (source === "rentcast" || source === "upload") return true;
  if (source === "live" && pulled) return true;
  if (source === "saved" && filename && !/starter/i.test(filename) && filename !== "live-search.json") return true;
  return false;
}

function confirmScoring(kind: "live" | "cache" | "score", data?: SearchResponse) {
  if (!data) return "Could not finish that action.";
  if (data.error) return data.error;
  const shown = data.results?.length ?? 0;
  const total = data.totalMatched ?? shown;
  const head = resultsHeadline(shown, total);
  if (kind === "live" && data.pulled) {
    return `Done. Pulled live listings and scored them. ${head}.`;
  }
  if (kind === "live") return `Done. Scored the live cache. ${head}.`;
  if (kind === "cache") return `Done. Scored the current set. ${head}.`;
  return `Done. Rescored the list. ${head}.`;
}

export function Workspace({ initialMatrix }: { initialMatrix: UserMatrix }) {
  const [matrix, setMatrix] = useState(initialMatrix ?? defaultMatrix());
  const [rows, setRows] = useState<Row[]>([]);
  const [mapSetKey, setMapSetKey] = useState("empty");
  const [totalMatched, setTotalMatched] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveSearch, setLiveSearch] = useState(false);
  const [signupUrl, setSignupUrl] = useState("https://www.rentcast.io/api");
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const [userLimit, setUserLimit] = useState(3);
  const [globalRemaining, setGlobalRemaining] = useState<number | undefined>(undefined);
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
  const [actionNotice, setActionNotice] = useState<{ id: number; text: string } | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [needListHint, setNeedListHint] = useState(false);
  const [hasOwnList, setHasOwnList] = useState(false);
  const noticeId = useRef(0);
  const scoreAbort = useRef<AbortController | null>(null);
  const scoreGen = useRef(0);
  const leftStarter = useRef(false);
  const starterOnly = useRef(true);
  const criteriaSent = useRef(false);
  const poolRef = useRef<PropertyListing[]>([]);
  const matrixRef = useRef(matrix);
  matrixRef.current = matrix;

  useEffect(() => {
    if (window.sessionStorage.getItem(BANNER_KEY) === "1") setShowBanner(false);
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    html.style.height = "100%";
    body.style.height = "100%";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
      html.style.height = "";
      body.style.height = "";
    };
  }, []);

  const persistMatrix = (m: UserMatrix) => {
    setMatrix(m);
    writeStoredMatrix(m);
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
    listings?: PropertyListing[];
    totalMatched?: number;
    notice?: string;
    error?: string;
    source?: string;
    pulled?: boolean;
    quota?: { remaining: number; userLimit: number; globalRemaining?: number };
    cache?: { count: number };
    saved?: { filename: string; count: number } | null;
  }, gen = scoreGen.current, opts?: { partial?: boolean; allowStarter?: boolean }) => {
    if (gen !== scoreGen.current) return;
    const src = data.source ?? "";
    if (leftStarter.current && !opts?.allowStarter && (src === "redfin-favorites" || src === "favorites")) {
      return;
    }
    if (isOwnListSource(src, data.saved?.filename, data.pulled)) {
      starterOnly.current = false;
      setHasOwnList(true);
      setNeedListHint(false);
      writeStoredSession({ hasOwnList: true, awaitingSearch: false });
    }
    if (Array.isArray(data.listings) && data.listings.length && !opts?.partial) {
      poolRef.current = data.listings;
      writeStoredPool(data.listings);
      writeStoredMatrix(matrixRef.current);
    }
    if (Array.isArray(data.results)) {
      if (opts?.partial && data.results.length === 0) return;
      if (data.results.length || !data.error) {
        let top = takeTopListings(data.results);
        if (starterOnly.current && criteriaSent.current) {
          top = top.filter((row) => sampleListingFits(row.listing, matrixRef.current, row.grade));
          setNeedListHint(true);
          writeStoredSession({ awaitingSearch: true, hasOwnList: false, listings: top.map((r) => r.listing) });
        }
        setRows(top);
        setTotalMatched(starterOnly.current && criteriaSent.current ? top.length : (data.totalMatched ?? data.results.length));
        if (top[0]) setSelectedId(top[0].listing.id);
        else setSelectedId(null);
        if (!opts?.partial) setMapSetKey(top.map((r) => r.listing.id).join("|") || "empty");
        if (!opts?.partial && !data.listings?.length && top.length) {
          poolRef.current = top.map((r) => r.listing);
          writeStoredPool(poolRef.current);
          writeStoredMatrix(matrixRef.current);
        }
        if (starterOnly.current && criteriaSent.current && !top.length) {
          poolRef.current = [];
          writeStoredPool([]);
        }
        if (src === "rentcast" || src === "upload" || src === "live") {
          leftStarter.current = true;
        }
      }
    }
    if (data.quota) {
      setRemaining(data.quota.remaining);
      setUserLimit(data.quota.userLimit);
      if (data.quota.globalRemaining != null) setGlobalRemaining(data.quota.globalRemaining);
    }
    if (data.cache?.count != null) setCacheCount(data.cache.count);
    applySaved(data.saved);
  }, []);

  function beginScore() {
    scoreAbort.current?.abort();
    const ac = new AbortController();
    scoreAbort.current = ac;
    const gen = ++scoreGen.current;
    return { ac, gen };
  }

  async function runScoring(body: Record<string, unknown>) {
    const { ac, gen } = beginScore();
    setScoreProgress({ analyzed: 0, total: totalMatched || 0, processing: 0 });
    try {
      const { ok, status, data } = await postSearch(body, {
        onProgress: (p) => {
          if (gen !== scoreGen.current) return;
          setScoreProgress(p);
          applyGrade({ results: p.results, totalMatched: p.totalMatched }, gen, { partial: true });
        },
        signal: ac.signal,
      });
      applyGrade(data, gen);
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
    const listings = poolRef.current.length ? poolRef.current : readStoredPool();
    if (listings.length) poolRef.current = listings;
    return runScoring({ source: "regrade", draft: m ?? matrixRef.current, listings });
  }

  async function runLive(m: UserMatrix, force: boolean) {
    setRegrading(true);
    try {
      return await runScoring({ source: "live", draft: m, force });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Live search failed.";
      setJob({ tone: "err", text });
      return { error: text } as SearchResponse;
    } finally {
      setRegrading(false);
    }
  }

  async function onChatEvent(event: {
    matrix?: UserMatrix;
    livePull?: boolean;
    liveSearch?: boolean;
    rescore?: boolean;
  }) {
    const draft = event.matrix ?? matrixRef.current;
    if (event.matrix) persistMatrix(event.matrix);
    if (event.matrix || event.rescore) {
      criteriaSent.current = true;
      if (starterOnly.current) setNeedListHint(true);
    }
    if (event.livePull) {
      starterOnly.current = false;
      return confirmScoring("live", await runLive(draft, true));
    }
    if (event.liveSearch) {
      starterOnly.current = false;
      return confirmScoring("cache", await runLive(draft, false));
    }
    if (event.rescore || event.matrix) {
      const data = await refreshGrades(draft);
      if (starterOnly.current) {
        const shown = (data?.results ?? []).filter((r) =>
          sampleListingFits(r.listing, draft, r.grade)
        );
        if (!shown.length) {
          return "None of the sample homes fit those must-haves. Upload a Redfin Favorites CSV (Actions) or confirm a live search to load a matching list.";
        }
        return `Kept ${shown.length} sample home${shown.length === 1 ? "" : "s"} that still fit. Upload a Redfin Favorites CSV or run a live search for a real matching list.`;
      }
      return confirmScoring("score", data);
    }
  }

  useEffect(() => {
    void fetch("/api/search")
      .then((r) => r.json())
      .then((data: {
        liveSearch?: boolean;
        signupUrl?: string;
        quota?: { remaining: number; userLimit: number; globalRemaining?: number };
        cache?: { count: number };
        saved?: { filename: string; count: number } | null;
      }) => {
        setLiveSearch(Boolean(data.liveSearch));
        if (data.signupUrl) setSignupUrl(data.signupUrl);
        if (data.quota) {
          setRemaining(data.quota.remaining);
          setUserLimit(data.quota.userLimit);
          if (data.quota.globalRemaining != null) setGlobalRemaining(data.quota.globalRemaining);
        }
        if (data.cache?.count != null) setCacheCount(data.cache.count);
        if (data.saved) {
          setSavedFilename(data.saved.filename);
          setSavedCount(data.saved.count);
        }
      })
      .catch(() => undefined);

    const stored = readStoredSession();
    if (stored.listings.length) {
      poolRef.current = stored.listings;
      leftStarter.current = true;
    }
    if (stored.awaitingSearch) {
      criteriaSent.current = true;
      starterOnly.current = true;
      setNeedListHint(true);
    }
    const draft = stored.matrix?.searchArea?.trim() ? stored.matrix : matrix;
    if (stored.matrix?.searchArea?.trim()) {
      matrixRef.current = stored.matrix;
      persistMatrix(stored.matrix);
    }

    void (async () => {
      if (stored.awaitingSearch && !stored.hasOwnList && !stored.listings.length) {
        return;
      }
      try {
        const data = await runScoring({
          source: "regrade",
          draft,
          listings: poolRef.current,
        });
        if (data === undefined) return;
        if (data?.results?.length) return;
        if (poolRef.current.length) return;
      } catch {
        if (poolRef.current.length) return;
      }
      try {
        await runScoring({ source: "favorites", draft });
      } catch (err) {
        setJob({
          tone: "err",
          text: err instanceof Error ? err.message : "Could not load starter homes.",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressLine = scoreProgress && scoreProgress.total > 0 ? scoreStatusLabel(scoreProgress) : "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {needListHint && !hasOwnList ? (
        <div className="shrink-0 border-b border-[var(--line)] bg-[var(--paper-2)] px-3 py-3">
          <p className="text-sm text-[var(--ink)]">
            {rows.length
              ? "Only sample homes that still fit your must-haves are shown. This is not a live search yet."
              : "None of the sample homes fit those must-haves."}{" "}
            Upload a Redfin Favorites CSV or run a live search to load a matching list.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
              onClick={() => setChatOpen(true)}
            >
              Open chat to search or upload
            </button>
          </div>
          {progressLine ? <p className="mt-2 text-xs text-[var(--muted)]">{progressLine}</p> : null}
        </div>
      ) : showBanner ? (
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
        <div className="flex items-center gap-2">
          {regrading ? <span className="text-xs text-[var(--muted)]">Scoring…</span> : null}
          <button
            type="button"
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
            onClick={() => setChatOpen(true)}
          >
            Chat
          </button>
        </div>
      </div>
      {job?.tone === "err" ? (
        <p className="border-b border-[var(--line)] bg-red-50 px-3 py-2 text-sm text-red-800">{job.text}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1 basis-0 overflow-hidden">
          <ResultsMap
            key={mapSetKey}
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            layoutTick={chatOpen ? "chat" : "map"}
          />
          {chatOpen ? null : (
            <ChatFab className="absolute bottom-4 right-4 z-20" onClick={() => setChatOpen(true)} />
          )}
        </div>
        <div className="min-h-0 flex-1 basis-0 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain p-3 md:w-[22rem] md:flex-none md:basis-auto md:shrink-0 xl:w-[26rem]">
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
              {needListHint
                ? "No matching homes on the sample list. Open chat → Actions to upload a Redfin Favorites CSV or use a live search."
                : "Loading sample homes… If nothing appears, open chat and set your must-haves."}
            </p>
          ) : null}
        </div>
      </div>

      <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} onKeyboard={setKeyboardOpen}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatPanel
          matrix={matrix}
          remaining={remaining}
          userLimit={userLimit}
          scoreProgress={scoreProgress}
          actionNotice={actionNotice}
          onChatEvent={onChatEvent}
          onClose={() => setChatOpen(false)}
          extra={
            keyboardOpen ? null : (
              <div className="max-h-[min(10rem,28svh)] shrink-0 overflow-y-auto overscroll-contain border-t border-[var(--line)]">
                <RedfinUpload
                  compact
                  heading="Actions"
                  matrix={matrix}
                  liveSearch={liveSearch}
                  signupUrl={signupUrl}
                  remaining={remaining}
                  userLimit={userLimit}
                  globalRemaining={globalRemaining}
                  cacheCount={cacheCount}
                  savedFilename={savedFilename}
                  savedCount={savedCount}
                  onSearchStart={() => beginScore()}
                  onGraded={(data) => {
                    setScoreProgress(null);
                    applyGrade(data as Parameters<typeof applyGrade>[0], scoreGen.current, {
                      allowStarter: data.source === "redfin-favorites",
                    });
                    noticeId.current += 1;
                    const kind = data.pulled || data.source === "rentcast" ? "live" : "score";
                    setActionNotice({
                      id: noticeId.current,
                      text: data.error
                        ? data.error
                        : confirmScoring(kind, data as SearchResponse),
                    });
                    setChatOpen(true);
                  }}
                  onScoreProgress={(p) => {
                    setScoreProgress(p);
                    applyGrade({ results: p.results as Row[], totalMatched: p.totalMatched }, scoreGen.current, {
                      partial: true,
                    });
                  }}
                />
                <div className="border-t border-[var(--line)] px-3 pb-3">
                  <Fold title="Your must-haves" titleClassName="text-sm text-[var(--muted)]">
                    <div className="max-h-40 overflow-y-auto">
                      <MatrixPreview matrix={matrix} />
                    </div>
                  </Fold>
                </div>
              </div>
            )
          }
        />
        </div>
      </ChatSheet>
    </div>
  );
}
