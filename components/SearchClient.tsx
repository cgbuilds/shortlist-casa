"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PropertyCard } from "@/components/PropertyCard";
import type { GradeResult, PropertyListing } from "@/lib/types";

type Row = { listing: PropertyListing; grade: GradeResult };

export function SearchClient() {
  const [q, setQ] = useState("");
  const [minBeds, setMinBeds] = useState("2");
  const [minSqft, setMinSqft] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("");
  const [pending, setPending] = useState(false);

  async function loadFavorites(extra?: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "favorites",
          q: q || undefined,
          minBeds: Number(minBeds) || undefined,
          minSqft: Number(minSqft) || undefined,
          maxPrice: Number(maxPrice) || undefined,
          ...extra,
        }),
      });
      const data = await res.json();
      setRows(data.results ?? []);
      setNotice(data.notice ?? data.error ?? "");
      setSource(data.source ?? "");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(e: FormEvent) {
    e.preventDefault();
    await loadFavorites();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const csv = await file.text();
    await loadFavorites({ csv, source: "upload" });
  }

  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-3xl">Grade Redfin favorites</h1>
      <p className="mt-2 mb-6 max-w-2xl text-sm text-[var(--muted)]">
        First pass uses your downloaded Redfin favorites CSV (Valrico-area search). Upload a new export
        anytime. Ranked by the matrix from chat — paste Mom’s gates there, then come back here.
      </p>
      <form onSubmit={(e) => void run(e)} className="mb-4 grid gap-3 sm:grid-cols-4">
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 sm:col-span-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter city or street (Valrico, Bloomingdale…)"
        />
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2"
          value={minBeds}
          onChange={(e) => setMinBeds(e.target.value)}
          placeholder="Min beds"
        />
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Max price"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-white sm:col-span-2" disabled={pending}>
          {pending ? "Grading…" : "Grade favorites"}
        </button>
        <label className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm sm:col-span-2">
          Upload Redfin CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="ml-2 text-xs"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </form>
      {source ? (
        <p className="mb-4 text-xs text-[var(--muted)]">
          Source: {source}
          {notice ? ` — ${notice}` : ""}
        </p>
      ) : null}
      <div className="grid gap-4">
        {rows.map((row) => (
          <PropertyCard key={row.listing.id} listing={row.listing} grade={row.grade} />
        ))}
      </div>
    </div>
  );
}
