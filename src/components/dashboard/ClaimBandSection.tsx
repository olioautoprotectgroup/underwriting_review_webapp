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
import {
  rollUpClaims,
  sharePct,
  sumClaimBases,
  UNKNOWN_BAND,
  type ClaimBases,
} from "../../lib/claimMeasures";
import type { ClaimFaultRow, DealerClaimRow } from "../../lib/types";
import SectionPanel, { type ViewMode } from "./SectionPanel";
import { DASH, fmtGbp, fmtInt, fmtPct } from "./format";

/** The measures a claim breakdown can plot. The table always shows all of them. */
const PLOTTABLE = {
  claimCount: { label: "Claims Count", get: (b: ClaimBases) => b.claimCount, fmt: fmtInt },
  claimValue: { label: "Claims Value", get: (b: ClaimBases) => b.claimValue, fmt: fmtGbp },
} as const;

type PlotKey = keyof typeof PLOTTABLE;

/**
 * One of the dashboard's claim-detail breakdowns — Analysis by Elapsed Time,
 * Analysis by Elapsed Mileage, or Claim Payee Analysis (sections 7, 8 and 9).
 *
 * All three are the same shape — group the claim rows by one dimension, show
 * Claims Count, Claims Value and each row's share — so they share this
 * component, exactly as `BreakdownSection` serves the four policy-side ones.
 *
 * Section 8 additionally pairs its mileage bands with a Fault Description
 * element. `fault_description` is documented as **free text** with no recorded
 * cardinality, so it is deliberately not a grouping dimension of its own:
 * charting an unbounded text column would produce a useless axis. Instead, pass
 * `faults` and clicking a band reveals that band's commonest faults, reusing
 * the click-to-pin interaction the policy-side sections already have.
 *
 * `order` fixes the band sequence. Sorting alphabetically works for the elapsed
 * bands (their "A: ".."F: " prefixes exist for that reason) but not for
 * mileage, where "Over 100k" would sort between "80k - 100k" and "0k - 20k".
 */
export default function ClaimBandSection({
  title,
  subtitle,
  rows,
  groupBy,
  order,
  faults,
}: {
  title: string;
  subtitle?: string;
  rows: DealerClaimRow[];
  groupBy: (row: DealerClaimRow) => string;
  /** Display order for the bands; anything unlisted is appended, sorted. */
  order?: readonly string[];
  /** Section 8 only: fault narratives, keyed by the same band as `groupBy`. */
  faults?: ClaimFaultRow[];
}) {
  const [plot, setPlot] = useState<PlotKey>("claimCount");
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const rolled = rollUpClaims(rows, groupBy, (r) => r);
    if (order) {
      const rank = new Map(order.map((label, i) => [label, i]));
      // Unlisted labels sort after the known ones rather than at position 0,
      // which is what `?? -1` would silently do.
      rolled.sort(
        (a, b) =>
          (rank.get(a.key) ?? order.length) - (rank.get(b.key) ?? order.length) ||
          a.key.localeCompare(b.key, "en-GB"),
      );
    } else {
      rolled.sort((a, b) => b.bases.claimCount - a.bases.claimCount);
    }
    const totalCount = sumClaimBases(rolled.map((g) => g.bases)).claimCount;
    return rolled.map((g) => ({ ...g, share: sharePct(g.bases.claimCount, totalCount) }));
  }, [rows, groupBy, order]);

  const total = useMemo(() => sumClaimBases(groups.map((g) => g.bases)), [groups]);

  if (groups.length === 0) {
    return (
      <SectionPanel title={title} subtitle={subtitle}>
        {() => (
          <p className="text-sm text-brand-400">
            No claims for this selection. A dealer with no claims has nothing to break down here
            — that is a genuine result, not missing data.
          </p>
        )}
      </SectionPanel>
    );
  }

  const chartData = groups.map((g) => ({
    name: g.key,
    value: PLOTTABLE[plot].get(g.bases),
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
                        // The Unknown band is muted even when nothing is pinned:
                        // it is a data-quality bucket, not a finding.
                        fill={
                          selected !== null && selected !== d.name
                            ? "#C3CBDC"
                            : d.name === UNKNOWN_BAND
                              ? "#98A4BE"
                              : "#0D2356"
                        }
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
                faults={faults?.filter((f) => f.mileageBand === selected)}
                onClear={() => setSelected(null)}
              />
            )}
            <p className="mt-2 text-xs text-brand-300">
              Click a bar to pin its detail{faults ? ", including its commonest faults" : ""}.
              Click again to clear.
            </p>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-4">{title.replace(/^(Analysis by|Claim) /i, "")}</th>
                  <th className="py-1.5 pr-4 text-right">Claims Count</th>
                  <th className="py-1.5 pr-4 text-right">% of Claims</th>
                  <th className="py-1.5 text-right">Claims Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {groups.map((g) => (
                  <tr key={g.key} className="hover:bg-brand-50/50">
                    <td className="py-1.5 pr-4">
                      {g.key === UNKNOWN_BAND ? (
                        <span className="text-brand-400" title="Value missing or outside a plausible range">
                          {g.key}
                        </span>
                      ) : (
                        g.key
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {fmtInt(g.bases.claimCount)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(g.share)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtGbp(g.bases.claimValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-brand-200 font-semibold text-brand-800">
                <tr>
                  <td className="py-1.5 pr-4">Total</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {fmtInt(total.claimCount)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{DASH}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtGbp(total.claimValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      }
    </SectionPanel>
  );
}

function SelectedDetail({
  name,
  group,
  faults,
  onClear,
}: {
  name: string;
  group?: { bases: ClaimBases; share: number | null };
  faults?: ClaimFaultRow[];
  onClear: () => void;
}) {
  if (!group) return null;
  const b = group.bases;
  return (
    <div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-brand-800">{name}</span>
        <button type="button" onClick={onClear} className="text-xs text-brand-500 hover:underline">
          clear
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {[
          ["Claims Count", fmtInt(b.claimCount)],
          ["% of Claims", fmtPct(group.share)],
          ["Claims Value", fmtGbp(b.claimValue)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-brand-400">{label}</dt>
            <dd className="font-medium tabular-nums text-brand-800">{value}</dd>
          </div>
        ))}
      </dl>

      {faults && faults.length > 0 && (
        <div className="mt-3 border-t border-brand-100 pt-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-400">
            Commonest faults in this band
          </p>
          <ul className="space-y-0.5">
            {faults.map((f) => (
              <li key={f.faultDescription} className="flex justify-between gap-4 text-xs">
                <span className="truncate text-brand-700" title={f.faultDescription}>
                  {f.faultDescription}
                </span>
                <span className="shrink-0 tabular-nums text-brand-500">
                  {fmtInt(f.claimCount)} · {fmtGbp(f.claimValue)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
