import { CATALOG, baselineStatus } from "@/kb/catalog";
import type { UserMatrix } from "@/lib/types";

export function MatrixPreview({ matrix }: { matrix: UserMatrix }) {
  const baseline = baselineStatus(matrix);
  const addons = CATALOG.filter((d) => {
    if (["beds", "baths", "property_type", "school_area"].includes(d.id)) return false;
    return matrix.dimensions[d.id]?.enabled;
  });
  const neighborhoods = matrix.locationAllowlist;

  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Baseline must-haves
        </h3>
        <p className="mb-2 text-xs font-medium">
          Looking to {matrix.intent === "rent" ? "rent" : "buy"}
        </p>
        <ul className="space-y-1">
          {baseline.gaps.map((g) => (
            <li key={g.id} className="flex justify-between gap-2">
              <span>
                {g.done ? "✓" : "○"} {g.label}
              </span>
              <span className={g.done ? "text-[var(--ink)]" : "text-[var(--muted)]"}>{g.value}</span>
            </li>
          ))}
        </ul>
        {neighborhoods.length ? (
          <p className="mt-2 text-xs text-[var(--muted)]">Neighborhoods: {neighborhoods.join(" · ")}</p>
        ) : matrix.searchArea ? (
          <p className="mt-2 text-xs text-[var(--muted)]">Anywhere in {matrix.searchArea}</p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--muted)]">
          {baseline.complete
            ? "Baseline complete. Custom must-haves can be added in chat."
            : "Answer these in chat before custom gates."}
        </p>
      </section>
      {addons.length ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Custom must-haves
          </h3>
          <ul className="space-y-1">
            {addons.map((d) => {
              const knobs = matrix.dimensions[d.id];
              return (
                <li key={d.id} className="flex justify-between gap-2">
                  <span>{knobs?.label || d.defaultLabel}</span>
                  <span className="text-[var(--muted)]">
                    {knobs?.mustHave ? "must" : "prefer"}
                    {knobs?.prefs?.prefer ? ` · ${String(knobs.prefs.prefer).replace(/_/g, " ")}` : ""}
                    {knobs?.prefs?.requireCoffee ? " · coffee nearby" : ""}
                    {knobs?.prefs?.requireShops ? " · shops" : ""}
                    {knobs?.prefs?.acceptSfha ? " · FEMA AE OK" : ""}
                    {knobs?.min != null ? ` · min ${knobs.min}` : ""}
                    {knobs?.max != null ? ` · max ${knobs.max}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-xs text-[var(--muted)]">No custom must-haves yet.</p>
      )}
      {matrix.budget.maxPrice ? (
        <p className="text-xs text-[var(--muted)]">Budget cap ${matrix.budget.maxPrice.toLocaleString()}</p>
      ) : null}
      {matrix.manualRubrics.length > 0 ? (
        <p className="text-xs">Manual: {matrix.manualRubrics.map((r) => r.label).join(", ")}</p>
      ) : null}
    </div>
  );
}
