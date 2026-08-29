import { CATALOG } from "@/kb/catalog";
import type { UserMatrix } from "@/lib/types";

const clusters = ["must_haves", "structure", "motivation", "money", "location", "deal"] as const;

export function MatrixPreview({ matrix }: { matrix: UserMatrix }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Max price" value={fmtMoney(matrix.budget.maxPrice)} />
        <Stat label="Max PITIA" value={matrix.budget.maxPitia ? `$${matrix.budget.maxPitia}/mo` : "—"} />
        <Stat label="Min slack" value={matrix.budget.minMonthlySlack ? `$${matrix.budget.minMonthlySlack}` : "—"} />
      </div>
      <p className="text-sm text-[var(--muted)]">
        Areas: {matrix.locationAllowlist.join(" · ") || "any"} · Unknown fields: {matrix.unknownPolicy}
      </p>
      {clusters.map((cluster) => {
        const rows = CATALOG.filter((d) => d.cluster === cluster);
        return (
          <section key={cluster}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {cluster.replace("_", " ")}
            </h3>
            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((d) => {
                    const knobs = matrix.dimensions[d.id];
                    return (
                      <tr key={d.id} className="border-t border-[var(--line)] first:border-t-0">
                        <td className="px-3 py-2">{knobs?.label || d.defaultLabel}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">
                          {knobs?.enabled ? "on" : "off"}
                          {knobs?.mustHave ? " · must" : ""}
                          {knobs?.min != null ? ` · min ${knobs.min}` : ""}
                          {knobs?.max != null ? ` · max ${knobs.max}` : ""}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{knobs?.weight ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {matrix.manualRubrics.length > 0 ? (
        <p className="text-sm">
          Manual: {matrix.manualRubrics.map((r) => `${r.label} (${r.weight})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="font-[family-name:var(--font-display)] text-xl">{value}</div>
    </div>
  );
}

function fmtMoney(n?: number) {
  return n ? `$${n.toLocaleString()}` : "—";
}
