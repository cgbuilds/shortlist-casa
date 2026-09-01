"use client";

import { useEffect, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { decodeShare } from "@/lib/share";
import { writeStoredSession } from "@/lib/listings-payload";

export function OpenShare() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = window.location.hash.replace(/^#/, "");
      const payload = token ? await decodeShare(token) : null;
      if (cancelled) return;
      if (!payload) {
        setError("This share link is missing its list. Ask them to tap Copy link again.");
        return;
      }
      writeStoredSession({
        listings: payload.listings,
        matrix: payload.matrix,
        hasOwnList: true,
        awaitingSearch: false,
      });
      try {
        await fetch("/api/demo", { method: "POST" });
      } catch {
        /* still try /app — they may already have a session */
      }
      if (!cancelled) window.location.replace("/app?shared=1");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">{BRAND_NAME}</p>
      {error ? (
        <>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl">Couldn’t open that shortlist</h1>
          <p className="mt-3 text-[var(--muted)]">{error}</p>
          <a href="/" className="mt-6 text-[var(--accent)] underline">
            Go to Shortlist
          </a>
        </>
      ) : (
        <>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl">Opening a shared shortlist…</h1>
          <p className="mt-3 text-[var(--muted)]">Scoring those homes against the must-haves they set.</p>
        </>
      )}
    </div>
  );
}
