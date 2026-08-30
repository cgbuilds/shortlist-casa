import type { GradeResult } from "@/lib/types";

export function GradeBreakdown({ grade }: { grade: GradeResult }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        {grade.costKind === "rent"
          ? grade.estimatedPitia != null
            ? `Rent $${grade.estimatedPitia.toLocaleString()}/mo`
            : "Rent n/a"
          : grade.estimatedPitia != null
            ? `Est. PITIA $${grade.estimatedPitia.toLocaleString()}/mo`
            : "PITIA n/a"}
        {grade.monthlySlack != null ? ` · slack $${grade.monthlySlack.toLocaleString()}` : ""}
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--paper-2)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {grade.perDimension
              .filter((d) => d.enabled)
              .map((d) => (
                <tr key={d.id} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2">
                    {d.label}
                    {d.mustHaveFailed ? <span className="ml-2 text-xs text-red-700">must-have</span> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {d.unknown ? "unk" : d.score}
                    <span className="text-[var(--muted)]"> ×{d.weight}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--muted)]">{d.reason}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
