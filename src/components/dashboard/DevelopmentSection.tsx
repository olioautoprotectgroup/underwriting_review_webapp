import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { safeDivide } from "../../lib/dealerMeasures";
import type { DealerDevelopmentRow } from "../../lib/types";
import SectionPanel from "./SectionPanel";
import { DASH, fmtPct } from "./format";

/** Line colours per contract year, cycling. Brand navy first. */
const SERIES_COLOURS = ["#0D2356", "#5E68CC", "#CF043C", "#1E8E3E", "#B8860B", "#6B7280"];

/**
 * "Earned Loss Development Data" — the report's development triangle.
 *
 * Each contract year is a cohort; `period` is a 30-day development bucket since
 * policy inception (the `Period` column in `uwr_transformed_data`, 1–65). The
 * plotted value is the **cumulative** earned loss ratio: claims to date over
 * earned premium to date, both accumulated across periods 1..n.
 *
 * Cumulative rather than per-period is what makes it a development triangle —
 * it shows how each cohort's loss ratio matures as more premium earns, which is
 * the whole point. A per-period ratio would be far noisier and would not be
 * comparable across cohorts at different ages.
 */
export default function DevelopmentSection({ rows }: { rows: DealerDevelopmentRow[] }) {
  const { years, data } = useMemo(() => {
    const byYear = new Map<number, DealerDevelopmentRow[]>();
    for (const r of rows) {
      const list = byYear.get(r.contractYear) ?? [];
      list.push(r);
      byYear.set(r.contractYear, list);
    }

    const yearList = [...byYear.keys()].sort((a, b) => a - b);
    // Cumulative ELR per cohort, keyed by period so the chart can align years.
    const byPeriod = new Map<number, Record<string, number | null> & { period: number }>();

    for (const year of yearList) {
      const series = (byYear.get(year) ?? []).sort((a, b) => a.period - b.period);
      let claims = 0;
      let earned = 0;
      for (const point of series) {
        claims += point.claimsValue;
        earned += point.earnedPremium;
        const ratio = safeDivide(claims, earned);
        const row = byPeriod.get(point.period) ?? { period: point.period };
        row[String(year)] = ratio === null ? null : ratio * 100;
        byPeriod.set(point.period, row);
      }
    }

    return {
      years: yearList,
      data: [...byPeriod.values()].sort((a, b) => a.period - b.period),
    };
  }, [rows]);

  if (data.length === 0) {
    return (
      <SectionPanel title="Earned Loss Development">
        {() => (
          <p className="text-sm text-brand-400">
            No development data for this dealer. Development periods come from the policy's
            maturity, so a dealer with no earned premium yet will have none.
          </p>
        )}
      </SectionPanel>
    );
  }

  return (
    <SectionPanel
      title="Earned Loss Development"
      subtitle="Cumulative earned loss ratio by 30-day development period since inception, one line per contract year."
      defaultView="chart"
    >
      {(view) =>
        view === "chart" ? (
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF2" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: "#5B6B8C" }}
                  label={{
                    value: "Development period",
                    position: "insideBottom",
                    offset: -2,
                    style: { fontSize: 11, fill: "#5B6B8C" },
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#5B6B8C" }}
                  width={60}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                />
                <Tooltip
                  formatter={(v, name) => [fmtPct(v as number), `Contract ${name}`]}
                  labelFormatter={(p) => `Period ${p}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#E6EAF2" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {years.map((year, i) => (
                  <Line
                    key={year}
                    type="monotone"
                    dataKey={String(year)}
                    name={String(year)}
                    stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
                <tr>
                  <th className="py-1.5 pr-4">Period</th>
                  {years.map((y) => (
                    <th key={y} className="py-1.5 pr-4 text-right">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {data.map((row) => (
                  <tr key={row.period} className="hover:bg-brand-50/50">
                    <td className="py-1.5 pr-4">{row.period}</td>
                    {years.map((y) => {
                      const v = row[String(y)];
                      return (
                        <td key={y} className="py-1.5 pr-4 text-right tabular-nums">
                          {v === undefined || v === null ? DASH : fmtPct(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </SectionPanel>
  );
}
