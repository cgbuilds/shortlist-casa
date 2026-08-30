import Link from "next/link";
import { formatAskPrice, marketLabel, listingMarket } from "@/lib/listing-market";
import type { GradeResult, PropertyListing } from "@/lib/types";
import { outboundListingLinks } from "@/lib/outbound-links";
import { gradeCaption } from "@/lib/grade";

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
      {grade.why ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{grade.why}</p>
      ) : grade.incompleteReason ? (
        <p className="mt-2 text-xs text-[var(--muted)]">{grade.incompleteReason}</p>
      ) : null}
      <p className="mt-3 text-sm">
        {listing.facts.propertyType ?? "home"} · {listing.beds ?? "—"} bd · {listing.baths ?? "—"} ba ·{" "}
        {listing.sqft?.toLocaleString() ?? "—"} sf
        {listing.listPrice ? ` · ${formatAskPrice(listing)}` : ""}
        {listing.daysOnMarket != null ? ` · ${listing.daysOnMarket} DOM` : ""}
        {` · ${marketLabel(listingMarket(listing))}`}
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
  const { score, word } = gradeCaption(grade);
  return (
    <div className="rounded-full bg-[var(--ink)] px-3 py-1 text-right text-sm text-[var(--paper)]">
      <span className="font-semibold">{score}</span>
      <span className="ml-1.5 text-[var(--paper)]/80">{word}</span>
    </div>
  );
}
