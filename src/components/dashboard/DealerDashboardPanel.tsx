import { useMemo, useState } from "react";
import type { DealerDashboard } from "../../lib/types";
import BreakdownSection from "./BreakdownSection";
import ContractSummarySection from "./ContractSummarySection";
import DevelopmentSection from "./DevelopmentSection";
import { DASH, fmtDate } from "./format";

const ALL_YEARS = "all";

/**
 * The Dealer Dashboard — a web rebuild of the Power BI paginated report.
 *
 * The contract-year filter is applied here, once, and every section re-derives
 * from the filtered rows. That works because the API ships base sums at a fine
 * grain rather than pre-aggregated sections: filtering and re-rolling-up is
 * pure arithmetic on data already in the browser, so switching years is instant
 * and costs no warehouse query.
 *
 * Sections deliberately absent, and why:
 *  - "Analysis by Contract by Product — Calculated Dealer Net Difference":
 *    "Calculated Dealer Net" and "Difference" are not defined anywhere in the
 *    platform or the metadata repo. Rather than guess at a governed financial
 *    measure, the section is held until underwriting supplies the definition.
 *  - Claim-detail sections (elapsed time, elapsed mileage, fault, payee,
 *    parts/labour/VAT split): the columns exist upstream in `fact_claim` but
 *    nothing in the platform extracts them yet. Phase 2.
 */
export default function DealerDashboardPanel({ dashboard }: { dashboard: DealerDashboard }) {
  const { header, position, development } = dashboard;
  const [year, setYear] = useState<string>(ALL_YEARS);

  const years = useMemo(
    () => [...new Set(position.map((r) => r.contractYear))].sort((a, b) => b - a),
    [position],
  );

  const rows = useMemo(
    () => (year === ALL_YEARS ? position : position.filter((r) => String(r.contractYear) === year)),
    [position, year],
  );

  const developmentRows = useMemo(
    () =>
      year === ALL_YEARS
        ? development
        : development.filter((r) => String(r.contractYear) === year),
    [development, year],
  );

  if (position.length === 0) {
    return (
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-400">
          Dealer Dashboard
        </h2>
        <p className="mt-2 text-sm text-brand-400">
          No warranty policy data for this dealer in <code>uwr_transformed_data</code>. This page
          covers the RSL warranty book only, so a dealer outside those underwriting codes will show
          nothing here.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-brand-800">
              {header.dealerName ?? header.dealerCode}
            </h2>
            <p className="text-sm text-brand-400">
              {header.agent ? `Agent: ${header.agent}` : "No agent recorded"} · Dealer code{" "}
              {header.dealerCode}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-brand-500">
            Contract year
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded border border-brand-200 bg-white px-2 py-1 text-xs text-brand-700"
            >
              <option value={ALL_YEARS}>All ({years.length})</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {[
            ["Contracts", years.length ? `${years[years.length - 1]} – ${years[0]}` : DASH],
            ["Earn Till", fmtDate(header.earnTill)],
            ["1st Sold On", fmtDate(header.firstSoldOn)],
            ["Last Sold On", fmtDate(header.lastSoldOn)],
            ["Last End Date", fmtDate(header.lastEndDate)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-brand-400">{label}</dt>
              <dd className="font-semibold text-brand-800">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ContractSummarySection rows={rows} />

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownSection
          title="Analysis by Inception Age"
          subtitle="Vehicle age band at policy inception."
          rows={rows}
          groupBy={(r) => r.vehicleAgeBand}
        />
        <BreakdownSection
          title="Analysis by Inception Mileage"
          subtitle="Vehicle mileage band at sale."
          rows={rows}
          groupBy={(r) => r.vehicleMileageBand}
        />
        <BreakdownSection
          title="Analysis by Product Term"
          subtitle="Product and term. Book % is each term's share of its own product."
          rows={rows}
          groupBy={(r) => `${r.productTypeName ?? "Unclassified"} · ${r.term ?? DASH}`}
        />
        <BreakdownSection
          title="Analysis by Make"
          subtitle="Vehicle make as recorded at sale."
          rows={rows}
          groupBy={(r) => r.vehicleMake}
        />
      </div>

      <DevelopmentSection rows={developmentRows} />

      <p className="text-xs text-brand-300">
        Two sections from the Power BI report are not shown yet: the Calculated Dealer Net
        Difference analysis, pending a definition of that measure, and the claim-detail sections
        (elapsed time, elapsed mileage, fault, payee, claims value split), which need a new
        extract from <code>fact_claim</code>.
      </p>
    </div>
  );
}
