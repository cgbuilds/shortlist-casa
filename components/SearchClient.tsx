"use client";

import { useState, type FormEvent } from "react";
import { PropertyCard } from "@/components/PropertyCard";
import type { GradeResult, PropertyListing } from "@/lib/types";

type Row = { listing: PropertyListing; grade: GradeResult };

export function SearchClient() {
  const [q, setQ] = useState("Lithia");
  const [minBeds, setMinBeds] = useState("4");
  const [minSqft, setMinSqft] = useState("2500");
  const [maxPrice, setMaxPrice] = useState("550000");
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("");
  const [pending, setPending] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          state: "FL",
          minBeds: Number(minBeds) || undefined,
          minSqft: Number(minSqft) || undefined,
          maxPrice: Number(maxPrice) || undefined,
        }),
      });
      const data = await res.json();
      setRows(data.results ?? []);
      setNotice(data.notice ?? "");
      setSource(data.source ?? "");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-3xl">Search and grade</h1>
      <p className="mt-2 mb-6 max-w-2xl text-sm text-[var(--muted)]">
        City, zip, or paste an address / listing URL (we only parse the street). Results rank with your
        active matrix. Live photos stay on Zillow, Redfin, and Realtor.com.
      </p>
      <form onSubmit={(e) => void run(e)} className="mb-6 grid gap-3 sm:grid-cols-4">
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 sm:col-span-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Lithia, 33547, or a pasted listing URL"
        />
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2"
          value={minBeds}
          onChange={(e) => setMinBeds(e.target.value)}
          placeholder="Min beds"
        />
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2"
          value={minSqft}
          onChange={(e) => setMinSqft(e.target.value)}
          placeholder="Min sqft"
        />
        <input
          className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Max price"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-white sm:col-span-3" disabled={pending}>
          {pending ? "Grading…" : "Search"}
        </button>
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
