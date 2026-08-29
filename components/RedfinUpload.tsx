"use client";

import { useRef, useState } from "react";

export type GradePayload = {
  results?: unknown[];
  notice?: string;
  source?: string;
  error?: string;
};

export function RedfinUpload({
  heading = "Grade a Redfin CSV",
  compact,
  onGraded,
}: {
  heading?: string;
  compact?: boolean;
  onGraded?: (data: GradePayload) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function grade(body: Record<string, unknown>) {
    setPending(true);
    setStatus("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as GradePayload;
      if (!res.ok) {
        setStatus(data.error ?? "Could not grade that file.");
        return;
      }
      setStatus(data.notice ?? "Graded.");
      onGraded?.(data);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPending(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const csv = await file.text();
    await grade({ csv, source: "upload" });
  }

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
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? "Grading…" : "Upload CSV"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          disabled={pending}
          onClick={() => void grade({ source: "favorites" })}
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
      {status ? <p className="mt-2 text-xs text-[var(--muted)]">{status}</p> : null}
    </section>
  );
}
