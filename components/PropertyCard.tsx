import Link from "next/link";
import type { GradeResult, PropertyListing } from "@/lib/types";
import { outboundListingLinks } from "@/lib/outbound-links";

export function PropertyCard({
  listing,
  grade,
}: {
  listing: PropertyListing;
  grade: GradeResult;
}) {
  const links = outboundListingLinks(listing);
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--paper-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/property/${listing.id}`} className="font-[family-name:var(--font-display)] text-lg hover:underline">
            {listing.address}
          </Link>
          <p className="text-sm text-[var(--muted)]">
            {listing.city}, {listing.state} {listing.zip}
          </p>
        </div>
        <ScorePill grade={grade} />
      </div>
      <p className="mt-3 text-sm">
        {listing.facts.propertyType ?? "home"} · {listing.beds ?? "—"} bd · {listing.baths ?? "—"} ba ·{" "}
        {listing.sqft?.toLocaleString() ?? "—"} sf
        {listing.listPrice ? ` · $${listing.listPrice.toLocaleString()}` : ""}
        {listing.daysOnMarket != null ? ` · ${listing.daysOnMarket} DOM` : ""}
        {listing.status ? ` · ${listing.status}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {links.map((l) => (
          <a key={l.name} href={l.href} target="_blank" rel="noreferrer" className="rounded-full border border-[var(--line)] px-2 py-1 hover:bg-[var(--paper)]">
            {l.name}
          </a>
        ))}
      </div>
    </article>
  );
}

export function ScorePill({ grade }: { grade: GradeResult }) {
  const label = grade.mustHaveFailed ? "pass" : grade.total == null ? "—" : String(grade.total);
  return (
    <div className="rounded-full bg-[var(--ink)] px-3 py-1 text-sm text-[var(--paper)]">
      {label} <span className="text-[var(--paper)]/70">{grade.band}</span>
    </div>
  );
}
