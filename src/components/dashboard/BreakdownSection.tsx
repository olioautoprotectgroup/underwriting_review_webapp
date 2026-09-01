import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bookPct, rollUp, sumBases, type DealerMeasures } from "../../lib/dealerMeasures";
import type { DealerPositionRow } from "../../lib/types";
import SectionPanel, { type ViewMode } from "./SectionPanel";
import { DASH, fmtGbp, fmtInt, fmtPct } from "./format";

/** The measures a breakdown chart can plot. Table always shows all of them. */
const PLOTTABLE = {
  soldPolicies: { label: "Units Sold", get: (m: DealerMeasures) => m.soldPolicies, fmt: fmtInt },
  bookPct: { label: "Book %", get: () => null, fmt: (v: number | null) => fmtPct(v) },
  writtenLossRatioPct: {
    label: "Written LR",
    get: (m: DealerMeasures) => m.writtenLossRatioPct,
    fmt: (v: number | null) => fmtPct(v),
  },
  earnedLossRatioPct: {
    label: "Earned LR",
    get: (m: DealerMeasures) => m.earnedLossRatioPct,
    fmt: (v: number | null) => fmtPct(v),
  },
  claimsValue: { label: "Claim Value", get: (m: DealerMeasures) => m.claimsValue, fmt: fmtGbp },
} as const;

type PlotKey = keyof typeof PLOTTABLE;

/**
 * One of the dashboard's "Analysis by ..." sections (inception age, inception
 * mileage, product term, make).
 *
 * All four are the same shape — group the position rows by one dimension, show
 * Units Sold, Book %, Written LR, Earned LR — so they share this component
 * rather than being four near-identical files.
 *
 * Book % is the row's share of units within *this section's* total, which is
 * how the report computes it (verified against the published dashboard: the
 * Product Term section re-bases to the product's own total, not the dealer's).
 * Because `groupBy` here can nest (product → term), the caller decides the
 * grouping key and therefore the denominator.
 */
export default function BreakdownSection({
  title,
  subtitle,
  rows,
  groupBy,
  emptyLabel = "Unclassified",
}: {
  title: string;
  subtitle?: string;
  rows: DealerPositionRow[];
  groupBy: (row: DealerPositionRow) => string | null;
  emptyLabel?: string;
}) {
  const [plot, setPlot] = useState<PlotKey>("soldPolicies");
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const rolled = rollUp(rows, (r) => groupBy(r) ?? emptyLabel, (r) => r);
    rolled.sort((a, b) => a.key.localeCompare(b.key, "en-GB"));
    const totalUnits = sumBases(rolled.map((g) => g.measures)).soldPolicies;
    return rolled.map((g) => ({
      ...g,
      book: bookPct(g.measures.soldPolicies, totalUnits),
    }));
  }, [rows, groupBy, emptyLabel]);

  const total = useMemo(() => sumBases(groups.map((g) => g.measures)), [groups]);

  if (groups.length === 0) {
    return (
      <SectionPanel title={title} subtitle={subtitle}>
        {() => <p className="text-sm text-brand-400">No data for this selection.</p>}
      </SectionPanel>
    );
  }

  const chartData = groups.map((g) => ({
    name: g.key,
    value: plot === "bookPct" ? g.book : PLOTTABLE[plot].get(g.measures),
  }));

  return (
    <SectionPanel
      title={title}
      subtitle={subtitle}
      toolbar={(view: ViewMode) =>
        view === "chart" ? (
          <select
            value={plot}
            onChange={(e) => setPlot(e.target.value as PlotKey)}
            aria-label={`${title} measure`}
            className="rounded border border-brand-200 bg-white px-2 py-1 text-xs text-brand-700"
          >
            {Object.entries(PLOTTABLE).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      {(view) =>
        view === "chart" ? (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF2" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5B6B8C" }} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: "#5B6B8C" }} width={70} />
                  <Tooltip
                    formatter={(v) => PLOTTABLE[plot].fmt(v as number)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#E6EAF2" }}
                  />
                  <Bar
                    dataKey="value"
                    radius={[4, 4, 0, 0]}
                    onClick={(d: { name?: string }) =>
                      setSelected((cur) => (cur === d.name ? null : (d.name ?? null)))
                    }
                    className="cursor-pointer"
                  >
                    {chartData.map((d) => (
                      <Cell
                        key={d.name}
                        fill={selected === null || selected === d.name ? "#0D2356" : "#C3CBDC"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {selected && (
              <SelectedDetail
                name={selected}
                group={groups.find((g) => g.key === selected)}
                onClear={() => setSelected(null)}
              />
            )}
            <p className="mt-2 text-xs text-brand-300">
              Click a bar to pin its detail. Click again to clear.
            </p>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-4">{title.replace(/^Analysis by /i, "")}</th>
                  <th className="py-1.5 pr-4 text-right">Units Sold</th>
                  <th className="py-1.5 pr-4 text-right">Book %</th>
                  <th className="py-1.5 pr-4 text-right">Written LR</th>
                  <th className="py-1.5 text-right">Earned LR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {groups.map((g) => (
                  <tr key={g.key} className="hover:bg-brand-50/50">
                    <td className="py-1.5 pr-4">{g.key}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {fmtInt(g.measures.soldPolicies)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(g.book)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {fmtPct(g.measures.writtenLossRatioPct)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtPct(g.measures.earnedLossRatioPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-brand-200 font-semibold text-brand-800">
                <tr>
                  <td className="py-1.5 pr-4">Total</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {fmtInt(total.soldPolicies)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{DASH}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {fmtPct(deriveTotalPct(total.claimsValue, total.uwPremium))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtPct(deriveTotalPct(total.claimsValue, total.earnedPremium))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      }
    </SectionPanel>
  );
}

/** Totals recompute from summed bases — never average the per-row ratios. */
function deriveTotalPct(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

function SelectedDetail({
  name,
  group,
  onClear,
}: {
  name: string;
  group?: { measures: DealerMeasures; book: number | null };
  onClear: () => void;
}) {
  if (!group) return null;
  const m = group.measures;
  return (
    <div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-brand-800">{name}</span>
        <button type="button" onClick={onClear} className="text-xs text-brand-500 hover:underline">
          clear
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {[
          ["Units Sold", fmtInt(m.soldPolicies)],
          ["Book %", fmtPct(group.book)],
          ["UW Prem", fmtGbp(m.uwPremium)],
          ["Earned Prem", fmtGbp(m.earnedPremium)],
          ["Claim Count", fmtInt(m.claimCount)],
          ["Claim Value", fmtGbp(m.claimsValue)],
          ["Written LR", fmtPct(m.writtenLossRatioPct)],
          ["Earned LR", fmtPct(m.earnedLossRatioPct)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-brand-400">{label}</dt>
            <dd className="font-medium tabular-nums text-brand-800">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
