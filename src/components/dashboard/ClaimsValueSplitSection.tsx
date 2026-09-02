import { useMemo } from "react";
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
import { splitClaimValue, sumClaimBases } from "../../lib/claimMeasures";
import type { DealerClaimRow } from "../../lib/types";
import SectionPanel from "./SectionPanel";
import { fmtGbp, fmtNum, fmtPct } from "./format";

const SLICE_COLOURS = ["#0D2356", "#5E68CC", "#B8860B", "#98A4BE"];

/**
 * "Claims Value Split" — section 10.
 *
 * Splits claim value on the **assessed** (authorised) basis: Parts =
 * `parts_cost_excluding_tax`, Labour = `labour_cost_excluding_tax`, VAT =
 * `parts_tax + labour_tax`. Plus Labour per Hour, the effective assessed rate.
 *
 * Every percentage is over **Claims Value**, matching the published Redgate
 * Lodge dashboard (Parts £191,530.44 of £265,399.64 = 72.17%). Dividing by the
 * components' own sum would give 74.47% — which is what this section did until
 * that report showed otherwise.
 *
 * 🚩 The three components do not add up to Claims Value: on Redgate Lodge they
 * cover 96.91%. The live report shows only the three and leaves the remainder
 * unexplained; this section adds an "Other" row so the column reaches 100% and
 * the gap is visible rather than being a puzzle for anyone who adds it up.
 *
 * 🚩 `repair_time`'s units are undocumented. "Per hour" is what the confirmed
 * formula implies, not something the warehouse states.
 */
export default function ClaimsValueSplitSection({ rows }: { rows: DealerClaimRow[] }) {
  const split = useMemo(() => splitClaimValue(sumClaimBases(rows)), [rows]);

  if (rows.length === 0 || split.claimValue === 0) {
    return (
      <SectionPanel title="Claims Value Split">
        {() => (
          <p className="text-sm text-brand-400">
            No assessed claim costs for this selection. With no claims there is nothing to split —
            a genuine result, not missing data.
          </p>
        )}
      </SectionPanel>
    );
  }

  const slices = [
    { name: "Parts", value: split.parts, pct: split.partsPct },
    { name: "Labour", value: split.labour, pct: split.labourPct },
    { name: "VAT", value: split.vat, pct: split.vatPct },
    // Not in the live report. Shown because the three above stop short of
    // Claims Value and a reader is entitled to know by how much.
    { name: "Other", value: split.other, pct: split.otherPct },
  ];

  return (
    <SectionPanel
      title="Claims Value Split"
      subtitle="Assessed basis, as a share of Claims Value. Parts and labour excluding tax, plus their tax as VAT."
    >
      {(view) =>
        view === "chart" ? (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={slices} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF2" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5B6B8C" }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#5B6B8C" }}
                    width={80}
                    tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(v) => fmtGbp(v as number)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#E6EAF2" }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {slices.map((s, i) => (
                      <Cell key={s.name} fill={SLICE_COLOURS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-brand-300">
              Labour per hour: {fmtGbp(split.labourPerHour)}
            </p>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-4">Component</th>
                  <th className="py-1.5 pr-4 text-right">Value</th>
                  <th className="py-1.5 text-right">Split %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {slices.map((s) => (
                  <tr key={s.name} className="hover:bg-brand-50/50">
                    <td className="py-1.5 pr-4">{s.name}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtGbp(s.value)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(s.pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-brand-200 font-semibold text-brand-800">
                <tr>
                  <td className="py-1.5 pr-4">Claims Value</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {fmtGbp(split.claimValue)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmtPct(100)}</td>
                </tr>
              </tfoot>
            </table>

            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-brand-100 pt-3 text-sm">
              <div>
                <dt className="text-xs text-brand-400">Labour per Hour</dt>
                <dd className="font-medium tabular-nums text-brand-800">
                  {fmtGbp(split.labourPerHour)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-brand-400">Repair Time (total)</dt>
                <dd className="font-medium tabular-nums text-brand-800">
                  {fmtNum(sumClaimBases(rows).repairTime)}
                </dd>
              </div>
            </dl>
          </div>
        )
      }
    </SectionPanel>
  );
}
