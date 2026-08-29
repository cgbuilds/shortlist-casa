"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { PropertyListing } from "@/lib/types";

export function FactsForm({
  listing,
  onSaved,
}: {
  listing: PropertyListing;
  onSaved: (listing: PropertyListing, grade: unknown) => void;
}) {
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    construction: listing.facts.construction ?? "",
    stories: listing.facts.stories?.toString() ?? "",
    roofAgeYears: listing.facts.roofAgeYears?.toString() ?? "",
    hvacAgeYears: listing.facts.hvacAgeYears?.toString() ?? "",
    impactGlass: listing.facts.impactGlass ? "yes" : listing.facts.impactGlass === false ? "no" : "",
    schoolArea: listing.facts.schoolArea ?? "",
    countyJustValue: listing.facts.countyJustValue?.toString() ?? "",
    hoa: listing.facts.hoa ? "yes" : listing.facts.hoa === false ? "no" : "",
    cdd: listing.facts.cdd ? "yes" : listing.facts.cdd === false ? "no" : "",
    garage: listing.facts.garage ? "yes" : listing.facts.garage === false ? "no" : "",
    endUnit: listing.facts.endUnit ? "yes" : listing.facts.endUnit === false ? "no" : "",
    inUnitLaundry: listing.facts.inUnitLaundry ? "yes" : listing.facts.inUnitLaundry === false ? "no" : "",
    walkable: listing.facts.walkable ? "yes" : listing.facts.walkable === false ? "no" : "",
    floodZone: listing.facts.floodZone ?? "",
    neighborhoodVibe: listing.facts.neighborhoodVibe ?? "",
    drainageQuality: listing.facts.drainageQuality ?? "",
    streetFlooding: listing.facts.streetFlooding ? "yes" : listing.facts.streetFlooding === false ? "no" : "",
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(`/api/property/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          construction: form.construction || null,
          stories: num(form.stories),
          roofAgeYears: num(form.roofAgeYears),
          hvacAgeYears: num(form.hvacAgeYears),
          impactGlass: boolish(form.impactGlass),
          schoolArea: form.schoolArea || null,
          countyJustValue: num(form.countyJustValue),
          hoa: boolish(form.hoa),
          cdd: boolish(form.cdd),
          garage: boolish(form.garage),
          endUnit: boolish(form.endUnit),
          inUnitLaundry: boolish(form.inUnitLaundry),
          walkable: boolish(form.walkable),
          floodZone: form.floodZone || null,
          sfha: form.floodZone ? /^(A|AE|AH|AO|VE|V)/i.test(form.floodZone) : null,
          neighborhoodVibe: form.neighborhoodVibe || null,
          drainageQuality: form.drainageQuality || null,
          streetFlooding: boolish(form.streetFlooding),
        }),
      });
      const data = await res.json();
      onSaved(data.listing, data.grade);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Construction">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.construction}
          onChange={(e) => setForm({ ...form, construction: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="block">Block</option>
          <option value="frame">Frame</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Stories">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.stories}
          onChange={(e) => setForm({ ...form, stories: e.target.value })}
        />
      </Field>
      <Field label="Roof age (years)">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.roofAgeYears}
          onChange={(e) => setForm({ ...form, roofAgeYears: e.target.value })}
        />
      </Field>
      <Field label="HVAC age (years)">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.hvacAgeYears}
          onChange={(e) => setForm({ ...form, hvacAgeYears: e.target.value })}
        />
      </Field>
      <Field label="Impact glass">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.impactGlass}
          onChange={(e) => setForm({ ...form, impactGlass: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="School / area">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.schoolArea}
          onChange={(e) => setForm({ ...form, schoolArea: e.target.value })}
        />
      </Field>
      <Field label="County just value">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.countyJustValue}
          onChange={(e) => setForm({ ...form, countyJustValue: e.target.value })}
        />
      </Field>
      <Field label="HOA">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.hoa}
          onChange={(e) => setForm({ ...form, hoa: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Garage">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.garage}
          onChange={(e) => setForm({ ...form, garage: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="End unit">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.endUnit}
          onChange={(e) => setForm({ ...form, endUnit: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="In-unit washer / dryer">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.inUnitLaundry}
          onChange={(e) => setForm({ ...form, inUnitLaundry: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Neighborhood feel">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.neighborhoodVibe}
          onChange={(e) => setForm({ ...form, neighborhoodVibe: e.target.value })}
        >
          <option value="">Unknown / from map</option>
          <option value="sleepy">Laid-back / sleepy</option>
          <option value="local_center">Local city-center</option>
          <option value="busy">Busy / high-traffic</option>
        </select>
      </Field>
      <Field label="Walkable">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.walkable}
          onChange={(e) => setForm({ ...form, walkable: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Flood zone (X, AE, VE…)">
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.floodZone}
          onChange={(e) => setForm({ ...form, floodZone: e.target.value })}
          placeholder="X"
        />
      </Field>
      <Field label="Drainage after rain">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.drainageQuality}
          onChange={(e) => setForm({ ...form, drainageQuality: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="high">Drains well</option>
          <option value="mixed">Mixed</option>
          <option value="poor">Ponds / backs up</option>
        </select>
      </Field>
      <Field label="Street / sewage flooding">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-2"
          value={form.streetFlooding}
          onChange={(e) => setForm({ ...form, streetFlooding: e.target.value })}
        >
          <option value="">Unknown</option>
          <option value="no">Rare</option>
          <option value="yes">Regular after rain</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white" disabled={pending}>
          {pending ? "Regrading…" : "Save facts and regrade"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function num(v: string) {
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function boolish(v: string) {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}
