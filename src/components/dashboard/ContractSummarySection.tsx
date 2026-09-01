import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  addBases,
  deriveMeasures,
  sumBases,
  ZERO_BASES,
  type MeasureBases,
} from "../../lib/dealerMeasures";
import type { DealerPositionRow } from "../../lib/types";
import SectionPanel from "./SectionPanel";
import { fmtGbp, fmtInt, fmtPct } from "./format";

/**
 * "Dealer Summary by Contract" — the report's headline table, one row per
 * contract year x underwriting code, with a total.
 *
 * Every column here is derived from summed bases via `deriveMeasures`, so the
 * total row is `derive(sum(bases))` rather than an average of the row ratios.
 * That distinction is not cosmetic: for a dealer whose cohorts have different
 * maturities the two differ materially, and only the former matches the report.
 */
export default function ContractSummarySection({ rows }: { rows: DealerPositionRow[] }) {
  // Grouped by contract year + UW code. The composite key never round-trips
  // back through a string: the parts are kept on the accumulator, so no
  // separator character can collide with a value inside underwritingCode.
  const grouped = useMemo(() => {
    const acc = new Map<string, { year: number; uwCode: string; bases: MeasureBases }>();
    for (const r of rows) {
      const uwCode = r.underwritingCode ?? "\u2014";
      const key = `${r.contractYear}|${uwCode}`;
      const found = acc.get(key) ?? { year: r.contractYear, uwCode, bases: ZERO_BASES };
      found.bases = addBases(found.bases, r);
      acc.set(key, found);
    }
    return [...acc.values()]
      .map((g) => ({ year: g.year, uwCode: g.uwCode, m: deriveMeasures(g.bases) }))
      .sort((a, b) => a.year - b.year || a.uwCode.localeCompare(b.uwCode));
  }, [rows]);

  const total = useMemo(() => deriveMeasures(sumBases(grouped.map((g) => g.m))), [grouped]);

  if (grouped.length === 0) {
    return (
      <SectionPanel title="Dealer Summary by Contract">
        {() => <p className="text-sm text-brand-400">No data for this selection.</p>}
      </SectionPanel>
    );
  }

  const chartData = grouped.map((g) => ({
    name: `${g.year} ${g.uwCode}`,
    "UW Prem": g.m.uwPremium,
    "Earned Prem": g.m.earnedPremium,
    "Claim Value": g.m.claimsValue,
  }));

  return (
    <SectionPanel
      title="Dealer Summary by Contract"
      subtitle="By contract year and underwriting code. Totals recomputed from summed bases."
    >
      {(view) =>
        view === "chart" ? (
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF2" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5B6B8C" }} interval={0} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#5B6B8C" }}
                  width={80}
                  tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(v) => fmtGbp(v as number)}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#E6EAF2" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="UW Prem" fill="#0D2356" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Earned Prem" fill="#5E68CC" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Claim Value" fill="#CF043C" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-3">Contract / UW Code</th>
                  {[
                    "Units",
                    "Avg Dealer Net",
                    "Maturity %",
                    "UW Prem",
                    "Avg UW Prem",
                    "Claims",
                    "Claim Value",
                    "Avg Claim Value",
                    "Written LR",
                    "Earned LR",
                    "Claim Freq",
                    "Burn Cost",
                    "Earned P/L",
                  ].map((h) => (
                    <th key={h} className="py-1.5 pr-3 text-right">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {grouped.map((g) => (
                  <tr key={`${g.year}-${g.uwCode}`} className="hover:bg-brand-50/50">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="font-medium text-brand-800">{g.year}</span>{" "}
                      <span className="text-brand-400">{g.uwCode}</span>
                    </td>
                    <Cells m={g.m} />
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-brand-200 font-semibold text-brand-800">
                <tr>
                  <td className="py-1.5 pr-3">Total</td>
                  <Cells m={total} />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      }
    </SectionPanel>
  );
}

function Cells({ m }: { m: ReturnType<typeof deriveMeasures> }) {
  const cells = [
    fmtInt(m.soldPolicies),
    fmtGbp(m.avgDealerNet),
    fmtPct(m.maturityPct),
    fmtGbp(m.uwPremium),
    fmtGbp(m.avgUwPremium),
    fmtInt(m.claimCount),
    fmtGbp(m.claimsValue),
    fmtGbp(m.avgClaimValue),
    fmtPct(m.writtenLossRatioPct),
    fmtPct(m.earnedLossRatioPct),
    fmtPct(m.claimFrequencyPct),
    fmtGbp(m.burnCost),
    fmtGbp(m.earnedProfitLoss),
  ];
  return (
    <>
      {cells.map((c, i) => (
        <td key={i} className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
          {c}
        </td>
      ))}
    </>
  );
}
