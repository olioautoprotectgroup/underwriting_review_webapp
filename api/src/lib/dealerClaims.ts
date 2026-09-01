import { executeStatement, type SqlParam } from "./databricks";
import {
  CLAIM_ELAPSED_BANDS,
  CLAIM_MILEAGE_BANDS,
  MAX_PLAUSIBLE_MILEAGE,
  UNKNOWN_BAND,
  UNRECORDED_PAYEE,
  type Band,
  type ClaimBases,
} from "./claimMeasures";
import { DASHBOARD_UNDERWRITING_CODES } from "./dealerDashboard";

/**
 * Live reads for the Dealer Dashboard's claim-detail sections (7-10 of the
 * Power BI report): Analysis by Elapsed Time, by Elapsed Mileage, Claim Payee
 * Analysis, and the Claims Value Split.
 *
 * Reads `vw_fact_claim` rather than `uwr_transformed_data`, because these are
 * claim-grained and the transformed model is policy-grained. The view selects
 * `fc.*`, so every column here comes free; `start_date` comes from its
 * `fact_policy` join, added to the view on 2026-09-01 specifically to make the
 * elapsed-time band possible.
 *
 * 🚩 **These sections do not tie to sections 1-6.** See the note at the top of
 * `claimMeasures.ts` for why (the true-up's inner join and period allocation).
 * Choosing `authorised_amount_scheme_currency` — the column the true-up itself
 * feeds from — makes them as close as they can be, per underwriting's
 * 2026-09-01 decision. The page says so explicitly.
 *
 * Per-dealer, so read live rather than shipped in the snapshot — README.md's
 * "Two data paths" rule, and the same reason claim mix moved live.
 */

/** Warranty only — the platform's scope. Mirrors `PRODUCT_SCOPE` in _config.py. */
const PRODUCT_SCOPE = "WARRANTY";

const CLAIM_TABLE = "vw_fact_claim";

/**
 * The confirmed "authorised or paid" lifecycle set — the 8 statuses that make a
 * claim count. Mirrors `DIFF_CLAIM_STATUSES` in
 * `underwriting_reviews/notebooks/transformed_data_port.py:240-247`.
 *
 * Deliberately the 8-status set, not the live Power BI model's narrower 4
 * (`Paid`, `Authorised`, `Amended`, `Processed`). Both platform notebooks were
 * widened to 8 on 2026-08-10 after measuring the difference: ~0.22% of claim
 * value across all products, and exactly 1 claim / £0 within Warranty. So this
 * agrees with the platform, and the Warranty impact against the live report is
 * nil.
 */
const CLAIM_STATUS_SCOPE = [
  "Authorised",
  "Authorised for dealer held ADMIN scheme",
  "Pro-rata credit note; Authorised",
  "Paid",
  "Pro-rata credit note; Paid",
  "Processed",
  "Amended",
  "Pre-Approved",
] as const;

/**
 * Sentinel dates to treat as null before any date arithmetic. `1899-12-30` and
 * year-1900 dates mean "not set"; `2099-12-31` means "not yet occurred"
 * (INDEX convention #1). `fact_policy.start_date` carries a different problem
 * again — genuine garbage ranging from `0104` to `2927` — so it is also bounded
 * to a plausible window. Without both guards an unfiltered subtraction yields
 * century-scale elapsed times that land silently in the top band.
 */
const MIN_PLAUSIBLE_YEAR = 1990;
const MAX_PLAUSIBLE_YEAR = 2100;

/** One row of the claim breakdown, at the union grain of sections 7, 9 and 10. */
export interface DealerClaimRow extends ClaimBases {
  contractYear: number;
  elapsedBand: string;
  mileageBand: string;
  payeeType: string;
}

/** One fault narrative within a mileage band, for the section 8 drill-down. */
export interface ClaimFaultRow {
  contractYear: number;
  mileageBand: string;
  faultDescription: string;
  claimCount: number;
  claimValue: number;
}

export interface DealerClaims {
  rows: DealerClaimRow[];
  faults: ClaimFaultRow[];
}

function num(v: string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds a SQL CASE expression for a band table, binding every threshold.
 *
 * The bands are constants, not user input, but the repo's rule is that no value
 * is interpolated into SQL text — only placeholder names are generated. Same
 * discipline as the 13 underwriting codes in dealerDashboard.ts.
 *
 * Driving this off the exported band table rather than hand-writing the CASE is
 * the point: the browser bands with `bandFor` against the same table, so the
 * warehouse and the client cannot drift into disagreeing about where a value
 * falls. A test asserts the generated SQL against the table.
 */
export function buildBandCase(
  valueExpr: string,
  bands: readonly Band[],
  prefix: string,
): { sql: string; params: SqlParam[] } {
  const params: SqlParam[] = [];
  const whens: string[] = [];

  bands.forEach((band, i) => {
    if (band.upperExclusive === null) return;
    const boundName = `${prefix}_b${i}`;
    const labelName = `${prefix}_l${i}`;
    params.push({ name: boundName, value: band.upperExclusive, type: "DOUBLE" });
    params.push({ name: labelName, value: band.label, type: "STRING" });
    whens.push(`WHEN ${valueExpr} < :${boundName} THEN :${labelName}`);
  });

  const last = bands[bands.length - 1];
  const lastName = `${prefix}_last`;
  params.push({ name: lastName, value: last.label, type: "STRING" });

  const unknownName = `${prefix}_unknown`;
  params.push({ name: unknownName, value: UNKNOWN_BAND, type: "STRING" });

  // A null or negative value is Unknown, never the lowest band — the deliberate
  // departure from transformed_data_port.py documented in claimMeasures.ts.
  const sql = `CASE
          WHEN ${valueExpr} IS NULL OR ${valueExpr} < 0 THEN :${unknownName}
          ${whens.join("\n          ")}
          ELSE :${lastName}
        END`;

  return { sql, params };
}

/**
 * The shared WHERE clause. Every value bound, including the constants.
 *
 * The underwriting-code filter is imported from dealerDashboard.ts rather than
 * re-declared: if the RSL book is ever redefined, the claim sections must move
 * with the policy sections or the page starts contradicting itself.
 */
function claimFilter(dealerCode: string) {
  const uwParams: SqlParam[] = DASHBOARD_UNDERWRITING_CODES.map((code, i) => ({
    name: `uw${i}`,
    value: code,
    type: "STRING" as const,
  }));
  const statusParams: SqlParam[] = CLAIM_STATUS_SCOPE.map((status, i) => ({
    name: `cs${i}`,
    value: status,
    type: "STRING" as const,
  }));

  const params: SqlParam[] = [
    { name: "dealer_code", value: dealerCode, type: "STRING" },
    { name: "product", value: PRODUCT_SCOPE, type: "STRING" },
    ...uwParams,
    ...statusParams,
  ];

  const where = `
    WHERE c.dealer_code = :dealer_code
      AND c.product = :product
      AND c.underwriting_code IN (${uwParams.map((p) => `:${p.name}`).join(", ")})
      AND c.claim_status IN (${statusParams.map((p) => `:${p.name}`).join(", ")})`;

  return { where, params };
}

/**
 * Normalised date expressions. Applied inline rather than in a view so the
 * sentinel handling is visible next to the arithmetic that depends on it.
 */
function dateGuards() {
  const params: SqlParam[] = [
    { name: "min_year", value: MIN_PLAUSIBLE_YEAR, type: "INT" },
    { name: "max_year", value: MAX_PLAUSIBLE_YEAR, type: "INT" },
  ];
  const safeDate = (col: string) =>
    `CASE WHEN YEAR(${col}) BETWEEN :min_year AND :max_year THEN ${col} END`;
  return { params, safeDate };
}

/**
 * Section 7, 9 and 10's data, plus the mileage half of section 8, in one query.
 *
 * One aggregate at the union grain feeds all four, exactly as `fetchPosition`
 * does for the policy-side sections: the measures are sums, so rolling up in
 * the browser is identical to grouping in SQL, and the contract-year filter
 * then costs no warehouse round trip. Bounded at roughly 7 bands x 7 bands x
 * ~13 payee types x contract years, so a few thousand rows at worst.
 */
async function fetchClaimBreakdown(dealerCode: string): Promise<DealerClaimRow[]> {
  const { where, params } = claimFilter(dealerCode);
  const { params: dateParams, safeDate } = dateGuards();

  const elapsedExpr = `months_between(${safeDate("c.loss_date")}, ${safeDate("c.start_date")})`;
  const elapsed = buildBandCase(elapsedExpr, CLAIM_ELAPSED_BANDS, "el");

  // Bound-filter above the plausible ceiling as well as below zero: the column
  // carries "absurd maxima (billions)" garbage that would otherwise all land in
  // "Over 100k" and make that band meaningless.
  const mileageExpr = `CASE WHEN c.breakdown_mileage <= :max_mileage THEN c.breakdown_mileage END`;
  const mileage = buildBandCase(mileageExpr, CLAIM_MILEAGE_BANDS, "mi");

  const rows = await executeStatement(
    `SELECT c.policy_contract_year                        AS contract_year,
            ${elapsed.sql}                                AS elapsed_band,
            ${mileage.sql}                                AS mileage_band,
            COALESCE(c.payee_type, :unrecorded_payee)     AS payee_type,
            COUNT(DISTINCT c.claim_id)                    AS claim_count,
            SUM(c.authorised_amount_scheme_currency)      AS claim_value,
            SUM(c.parts_cost_excluding_tax)               AS parts_cost,
            SUM(c.labour_cost_excluding_tax)              AS labour_cost,
            SUM(c.parts_tax)                              AS parts_tax,
            SUM(c.labour_tax)                             AS labour_tax,
            SUM(c.repair_time)                            AS repair_time
     FROM ${CLAIM_TABLE} c${where}
     GROUP BY c.policy_contract_year, ${elapsed.sql}, ${mileage.sql},
              COALESCE(c.payee_type, :unrecorded_payee)
     ORDER BY c.policy_contract_year`,
    [
      ...params,
      ...dateParams,
      ...elapsed.params,
      ...mileage.params,
      { name: "max_mileage", value: MAX_PLAUSIBLE_MILEAGE, type: "DOUBLE" },
      { name: "unrecorded_payee", value: UNRECORDED_PAYEE, type: "STRING" },
    ],
  );

  return rows.map((r) => ({
    contractYear: num(r.contract_year),
    elapsedBand: r.elapsed_band ?? UNKNOWN_BAND,
    mileageBand: r.mileage_band ?? UNKNOWN_BAND,
    payeeType: r.payee_type ?? UNRECORDED_PAYEE,
    claimCount: num(r.claim_count),
    claimValue: num(r.claim_value),
    partsCost: num(r.parts_cost),
    labourCost: num(r.labour_cost),
    partsTax: num(r.parts_tax),
    labourTax: num(r.labour_tax),
    repairTime: num(r.repair_time),
  }));
}

/** How many fault narratives to keep per mileage band. */
const FAULTS_PER_BAND = 10;

/**
 * Section 8's fault drill-down: the commonest fault narratives within each
 * mileage band.
 *
 * Ranked and capped in SQL rather than grouped and trimmed in the browser,
 * because `fault_description` is documented as **free text** with no recorded
 * cardinality — a plain GROUP BY could return one row per claim. The window
 * function bounds this at bands x years x 10 regardless of how dirty the column
 * turns out to be.
 */
async function fetchClaimFaults(dealerCode: string): Promise<ClaimFaultRow[]> {
  const { where, params } = claimFilter(dealerCode);

  const mileageExpr = `CASE WHEN c.breakdown_mileage <= :max_mileage THEN c.breakdown_mileage END`;
  const mileage = buildBandCase(mileageExpr, CLAIM_MILEAGE_BANDS, "mi");

  const rows = await executeStatement(
    `WITH ranked AS (
       SELECT c.policy_contract_year                   AS contract_year,
              ${mileage.sql}                           AS mileage_band,
              COALESCE(c.fault_description, :no_fault) AS fault_description,
              COUNT(DISTINCT c.claim_id)               AS claim_count,
              SUM(c.authorised_amount_scheme_currency) AS claim_value,
              ROW_NUMBER() OVER (
                PARTITION BY c.policy_contract_year, ${mileage.sql}
                ORDER BY COUNT(DISTINCT c.claim_id) DESC
              ) AS rn
       FROM ${CLAIM_TABLE} c${where}
       GROUP BY c.policy_contract_year, ${mileage.sql},
                COALESCE(c.fault_description, :no_fault)
     )
     SELECT contract_year, mileage_band, fault_description, claim_count, claim_value
     FROM ranked
     WHERE rn <= :fault_limit
     ORDER BY contract_year, mileage_band, claim_count DESC`,
    [
      ...params,
      ...mileage.params,
      { name: "max_mileage", value: MAX_PLAUSIBLE_MILEAGE, type: "DOUBLE" },
      { name: "no_fault", value: "Not recorded", type: "STRING" },
      { name: "fault_limit", value: FAULTS_PER_BAND, type: "INT" },
    ],
  );

  return rows.map((r) => ({
    contractYear: num(r.contract_year),
    mileageBand: r.mileage_band ?? UNKNOWN_BAND,
    faultDescription: r.fault_description ?? "Not recorded",
    claimCount: num(r.claim_count),
    claimValue: num(r.claim_value),
  }));
}

/** Both claim queries, concurrently — neither depends on the other. */
export async function fetchDealerClaims(dealerCode: string): Promise<DealerClaims> {
  const [rows, faults] = await Promise.all([
    fetchClaimBreakdown(dealerCode),
    fetchClaimFaults(dealerCode),
  ]);
  return { rows, faults };
}
