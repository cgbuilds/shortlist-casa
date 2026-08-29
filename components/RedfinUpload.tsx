"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function RedfinUpload({
  heading = "Next: grade a Redfin CSV",
  autoFocus,
}: {
  heading?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
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
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Could not grade that file.");
        return;
      }
      setStatus(data.notice ?? "Graded. Opening results…");
      router.push("/search");
      router.refresh();
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
      className="rounded-2xl border-2 border-[var(--accent)] bg-[var(--paper)] p-4 shadow-sm"
    >
      <h2 className="font-[family-name:var(--font-display)] text-xl">{heading}</h2>
      <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
        Redfin → Favorites (or a saved search) → Download CSV. We’ll score every row with the matrix you
        just built.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="rounded-xl bg-[var(--accent)] px-4 py-3 text-sm text-white disabled:opacity-50"
          disabled={pending}
          autoFocus={autoFocus}
          onClick={() => input.current?.click()}
        >
          {pending ? "Grading…" : "Upload Redfin CSV"}
        </button>
        <button
          type="button"
          className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm disabled:opacity-50"
          disabled={pending}
          onClick={() => void grade({ source: "favorites" })}
        >
          Use sample Valrico favorites
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {status ? <p className="mt-3 text-sm">{status}</p> : null}
    </section>
  );
}
