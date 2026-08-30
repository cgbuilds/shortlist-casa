import { scoreStatusLabel, type RankProgress } from "@/lib/rank-presentation";

export type SearchResponse = {
  error?: string;
  notice?: string;
  source?: string;
  results?: RankProgress["results"];
  totalMatched?: number;
  quota?: {
    remaining: number;
    userLimit: number;
    globalRemaining?: number;
    globalUsed?: number;
    globalLimit?: number;
  };
  cache?: { count: number };
  saved?: { filename: string; count: number; savedAt?: number } | null;
  fromCache?: boolean;
  pulled?: boolean;
  needsConfirm?: boolean;
  advice?: { advice?: string; coveragePct?: number | null; used?: number; userLimit?: number };
  matrixOn?: boolean;
};

type StreamLine = SearchResponse & {
  type?: string;
  analyzed?: number;
  total?: number;
  processing?: number;
};

function asProgress(msg: StreamLine): RankProgress | null {
  if (msg.type !== "progress") return null;
  if (typeof msg.analyzed !== "number" || typeof msg.total !== "number") return null;
  return {
    analyzed: msg.analyzed,
    total: msg.total,
    processing: Number(msg.processing ?? 0),
    results: msg.results ?? [],
    totalMatched: Number(msg.totalMatched ?? msg.analyzed),
  };
}

function consumeLine(line: string, onProgress?: (p: RankProgress) => void) {
  const trimmed = line.trim();
  if (!trimmed) return { done: null as SearchResponse | null, error: null as string | null };
  const msg = JSON.parse(trimmed) as StreamLine;
  if (msg.type === "progress") {
    const progress = asProgress(msg);
    if (progress) onProgress?.(progress);
    return { done: null, error: null };
  }
  if (msg.type === "error") {
    return { done: null, error: msg.error ?? "Scoring failed" };
  }
  if (msg.type === "done") {
    const rest = { ...msg };
    delete (rest as { type?: string }).type;
    return { done: rest, error: null };
  }
  return { done: null, error: null };
}

export async function postSearch(
  body: Record<string, unknown>,
  opts?: { onProgress?: (p: RankProgress) => void; signal?: AbortSignal }
): Promise<{ ok: boolean; status: number; data: SearchResponse }> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson, application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: opts?.signal,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("ndjson")) {
    const data = (await res.json()) as SearchResponse;
    return { ok: res.ok, status: res.status, data };
  }

  const reader = res.body?.getReader();
  if (!reader) return { ok: false, status: res.status, data: { error: "Score stream was empty." } };

  const decoder = new TextDecoder();
  let buf = "";
  let donePayload: SearchResponse | null = null;
  let streamError: string | null = null;

  const take = (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const next = consumeLine(line, opts?.onProgress);
      if (next.error) streamError = next.error;
      if (next.done) donePayload = next.done;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    take(decoder.decode(value, { stream: true }));
  }
  take(decoder.decode());
  if (buf.trim()) {
    const next = consumeLine(buf, opts?.onProgress);
    if (next.error) streamError = next.error;
    if (next.done) donePayload = next.done;
  }

  if (streamError) return { ok: false, status: 500, data: { error: streamError } };
  if (!donePayload) {
    return { ok: false, status: res.status, data: { error: "Scoring ended without results." } };
  }
  return { ok: true, status: 200, data: donePayload };
}

export { scoreStatusLabel };
