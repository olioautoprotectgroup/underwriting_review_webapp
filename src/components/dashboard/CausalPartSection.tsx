import { useMemo, useState } from "react";
import type { CausalPartRow } from "../../lib/types";
import SectionPanel from "./SectionPanel";
import { fmtGbp, fmtInt } from "./format";

/** Rows shown before the rest collapse into a single "other faults" line. */
const VISIBLE_ROWS = 15;

/**
 * "Claim Causal Part Analysis" — fault narrative by contract year.
 *
 * A matrix: one row per fault description, one Claim Count / Claim Value pair
 * per contract year. That is how the live report lays it out, so a reader can
 * see a fault appearing or receding across cohorts rather than only in total.
 *
 * There is no chart. `fault_description` is free text with no controlled
 * vocabulary — the published Redgate Lodge dashboard has a row whose "label" is
 * an entire paragraph of technician notes — so any axis built from it would be
 * unreadable. The section is table-only and `SectionPanel`'s toggle is not
 * used; a bar chart of a hundred paragraph-length categories would be worse
 * than no chart.
 *
 * The API already caps this at the top 25 faults per year. This collapses
 * further to the top rows by total claim count, rolling the remainder into one
 * "other faults" line so the column totals still reconcile with the sections
 * above rather than silently falling short.
 */
export default function CausalPartSection({ rows }: { rows: CausalPartRow[] }) {
  const [expanded, setExpanded] = useState(false);

  const { years, faults, total } = useMemo(() => {
    const yearSet = [...new Set(rows.map((r) => r.contractYear))].sort((a, b) => a - b);

    // Keyed by fault; each entry holds a per-year cell plus a running total, so
    // the composite key never round-trips through a delimiter that a free-text
    // fault description could itself contain.
    const byFault = new Map<
      string,
      { fault: string; cells: Map<number, { count: number; value: number }>; count: number }
    >();

    for (const r of rows) {
      const entry = byFault.get(r.faultDescription) ?? {
        fault: r.faultDescription,
        cells: new Map(),
        count: 0,
      };
      const cell = entry.cells.get(r.contractYear) ?? { count: 0, value: 0 };
      cell.count += r.claimCount;
      cell.value += r.claimValue;
      entry.cells.set(r.contractYear, cell);
      entry.count += r.claimCount;
      byFault.set(r.faultDescription, entry);
    }

    const sorted = [...byFault.values()].sort((a, b) => b.count - a.count);

    const totals = new Map<number, { count: number; value: number }>();
    for (const entry of sorted) {
      for (const [year, cell] of entry.cells) {
        const t = totals.get(year) ?? { count: 0, value: 0 };
        t.count += cell.count;
        t.value += cell.value;
        totals.set(year, t);
      }
    }

    return { years: yearSet, faults: sorted, total: totals };
  }, [rows]);

  if (faults.length === 0) {
    return (
      <SectionPanel title="Claim Causal Part Analysis">
        {() => (
          <p className="text-sm text-brand-400">
            No claims for this selection, so no causal parts to analyse.
          </p>
        )}
      </SectionPanel>
    );
  }

  const shown = expanded ? faults : faults.slice(0, VISIBLE_ROWS);
  const hidden = faults.slice(shown.length);

  // Rolled up rather than dropped: the column totals must still tie to the
  // claim counts shown elsewhere on the page.
  const remainder = hidden.reduce((acc, entry) => {
    for (const [year, cell] of entry.cells) {
      const t = acc.get(year) ?? { count: 0, value: 0 };
      t.count += cell.count;
      t.value += cell.value;
      acc.set(year, t);
    }
    return acc;
  }, new Map<number, { count: number; value: number }>());

  return (
    <SectionPanel
      title="Claim Causal Part Analysis"
      subtitle="Fault description by contract year. Free text as recorded by the handler, so wording varies."
    >
      {() => (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-4">Fault Description</th>
                  {years.map((y) => (
                    <th key={y} colSpan={2} className="py-1.5 pr-4 text-right">
                      {y}
                    </th>
                  ))}
                </tr>
                <tr className="text-[10px]">
                  <th />
                  {years.map((y) => (
                    <FragmentHeader key={y} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {shown.map((entry) => (
                  <tr key={entry.fault} className="align-top hover:bg-brand-50/50">
                    <td className="max-w-md py-1.5 pr-4">
                      <span className="line-clamp-2 text-brand-700" title={entry.fault}>
                        {entry.fault}
                      </span>
                    </td>
                    {years.map((y) => (
                      <Cells key={y} cell={entry.cells.get(y)} />
                    ))}
                  </tr>
                ))}
                {hidden.length > 0 && (
                  <tr className="text-brand-400 hover:bg-brand-50/50">
                    <td className="py-1.5 pr-4 italic">
                      {hidden.length} other fault{hidden.length === 1 ? "" : "s"}
                    </td>
                    {years.map((y) => (
                      <Cells key={y} cell={remainder.get(y)} />
                    ))}
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-brand-200 font-semibold text-brand-800">
                <tr>
                  <td className="py-1.5 pr-4">Total</td>
                  {years.map((y) => (
                    <Cells key={y} cell={total.get(y)} />
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {faults.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs text-brand-500 hover:underline"
            >
              {expanded ? "Show top faults only" : `Show all ${faults.length} faults`}
            </button>
          )}

          <p className="mt-2 text-xs text-brand-300">
            The API returns the 25 commonest faults per contract year, so a dealer with a very long
            tail may have claims outside this table.
          </p>
        </>
      )}
    </SectionPanel>
  );
}

/** The Count / Value sub-header under each year. */
function FragmentHeader() {
  return (
    <>
      <th className="py-1 pr-4 text-right font-medium text-brand-300">Count</th>
      <th className="py-1 pr-4 text-right font-medium text-brand-300">Value</th>
    </>
  );
}

function Cells({ cell }: { cell?: { count: number; value: number } }) {
  return (
    <>
      <td className="py-1.5 pr-4 text-right tabular-nums">{fmtInt(cell?.count ?? 0)}</td>
      <td className="py-1.5 pr-4 text-right tabular-nums">{fmtGbp(cell?.value ?? 0)}</td>
    </>
  );
}
