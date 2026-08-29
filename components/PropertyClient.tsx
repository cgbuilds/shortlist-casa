"use client";

import { useState } from "react";
import { FactsForm } from "@/components/FactsForm";
import { GradeBreakdown } from "@/components/GradeBreakdown";
import { ScorePill } from "@/components/PropertyCard";
import { outboundListingLinks } from "@/lib/outbound-links";
import type { GradeResult, PropertyListing } from "@/lib/types";

export function PropertyClient({
  initialListing,
  initialGrade,
}: {
  initialListing: PropertyListing;
  initialGrade: GradeResult;
}) {
  const [listing, setListing] = useState(initialListing);
  const [g, setG] = useState(initialGrade);
  const links = outboundListingLinks(listing);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl">{listing.address}</h1>
          <p className="text-[var(--muted)]">
            {listing.city}, {listing.state} {listing.zip}
          </p>
        </div>
        <ScorePill grade={g} />
      </div>
      <p>
        {listing.beds ?? "—"} bd · {listing.baths ?? "—"} ba · {listing.sqft?.toLocaleString() ?? "—"} sf ·{" "}
        {listing.listPrice ? `$${listing.listPrice.toLocaleString()}` : "price n/a"}
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        {links.map((l) => (
          <a
            key={l.name}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--line)] px-3 py-1 hover:bg-[var(--paper-2)]"
          >
            Open on {l.name}
          </a>
        ))}
      </div>
      <GradeBreakdown grade={g} />
      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl">Fill gaps the feed missed</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Redfin CSV does not include garage, laundry, flood zone, walkability, or drainage.
          Nearby cafés and shops are counted from the map when we have coordinates. Override feel and
          drainage here.
        </p>
        <FactsForm
          listing={listing}
          onSaved={(next, grade) => {
            setListing(next);
            setG(grade as GradeResult);
          }}
        />
      </section>
    </div>
  );
}
