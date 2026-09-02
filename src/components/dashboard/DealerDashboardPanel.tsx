import { useMemo, useState } from "react";
import {
  bandOrder,
  CLAIM_ELAPSED_BANDS,
  CLAIM_MILEAGE_BANDS,
} from "../../lib/claimMeasures";
import type { DealerClaims, DealerDashboard } from "../../lib/types";
import BreakdownSection from "./BreakdownSection";
import ClaimBandSection from "./ClaimBandSection";
import ClaimsValueSplitSection from "./ClaimsValueSplitSection";
import CausalPartSection from "./CausalPartSection";
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
 * The claim-detail sections (7-10) read a DIFFERENT SOURCE from everything
 * above them: `vw_fact_claim`, claim-grained, versus `uwr_transformed_data`,
 * policy-grained. Their claim values are on a different basis and do not tie —
 * see `claimMeasures.ts`. They take `claims`, not `dashboard`, so the two can
 * never be accidentally added together, and the page says so in as many words.
 *
 * One section is still deliberately absent: "Analysis by Contract by Product —
 * Calculated Dealer Net Difference". "Calculated Dealer Net" and "Difference"
 * are not defined anywhere in the platform or the metadata repo. Rather than
 * guess at a governed financial measure, it is held until underwriting supplies
 * the definition.
 */
export default function DealerDashboardPanel({
  dashboard,
  claims,
}: {
  dashboard: DealerDashboard;
  claims: DealerClaims;
}) {
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

  // The claim arrays need their own filter — the year selector is applied once
  // here, per array, and nothing propagates it automatically. Both carry
  // `policy_contract_year` from fact_claim, so the same cohort filter applies
  // even though the grain differs.
  const claimRows = useMemo(
    () =>
      year === ALL_YEARS
        ? claims.rows
        : claims.rows.filter((r) => String(r.contractYear) === year),
    [claims.rows, year],
  );

  const faultRows = useMemo(
    () =>
      year === ALL_YEARS
        ? claims.faults
        : claims.faults.filter((r) => String(r.contractYear) === year),
    [claims.faults, year],
  );

  const causalRows = useMemo(
    () =>
      year === ALL_YEARS
        ? claims.causalParts
        : claims.causalParts.filter((r) => String(r.contractYear) === year),
    [claims.causalParts, year],
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

      <section className="rounded-xl border border-brand-200 bg-brand-50 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-500">
          Claim detail — a different source
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-brand-700">
          The sections below read <code>vw_fact_claim</code>, one row per claim. Everything above
          reads <code>uwr_transformed_data</code>, whose claim figures are a monthly snapshot trued
          up against the same claims. They should normally agree — the live report has them
          matching exactly — but a policy that exists in <code>fact_claim</code> and not in the
          snapshot counts below and not above, so small differences are possible. The Claims Value
          Split is a further step removed: it uses the assessed cost columns, which are in the
          repairer's currency rather than the scheme currency used elsewhere.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ClaimBandSection
          title="Analysis by Elapsed Time"
          subtitle="Days from cover start to the loss."
          rows={claimRows}
          groupBy={(r) => r.elapsedBand}
          order={bandOrder(CLAIM_ELAPSED_BANDS)}
        />
        <ClaimBandSection
          title="Analysis by Elapsed Mileage"
          subtitle="Miles covered between sale and breakdown. Click a band for its commonest faults."
          rows={claimRows}
          groupBy={(r) => r.mileageBand}
          order={bandOrder(CLAIM_MILEAGE_BANDS)}
          faults={faultRows}
        />
        <ClaimBandSection
          title="Claim Payee Analysis"
          subtitle="Who was paid, by claim volume and value."
          rows={claimRows}
          groupBy={(r) => r.payeeType}
        />
        <ClaimsValueSplitSection rows={claimRows} />
      </div>

      <CausalPartSection rows={causalRows} />

      <p className="text-xs text-brand-300">
        One section from the Power BI report is still not shown: the Calculated Dealer Net
        Difference analysis, which is waiting on a definition of that measure. An{" "}
        <em>Unknown</em> band in the two banded sections above means the underlying date or
        odometer value was missing or outside a plausible range — those claims are surfaced
        rather than dropped, so the band totals still add up.
      </p>
    </div>
  );
}
