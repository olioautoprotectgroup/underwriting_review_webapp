import { executeStatement, type SqlParam } from "./databricks";
import type { MeasureBases } from "./dealerMeasures";

/**
 * Live reads for the Dealer Dashboard page — the web rebuild of the Power BI
 * "Dealer Dashboard" paginated report.
 *
 * Reads `uwr_transformed_data`, the persisted port of the same Power BI
 * `Transformed_Data` semantic model the original report is built on, so the
 * figures reconcile. Filters mirror
 * `underwriting_reviews/notebooks/generate_agent_dealer_rag_pdf.py:456-468`.
 *
 * Per-dealer, so read live rather than shipped in the snapshot — the rule set
 * out in README.md's "Two data paths". This data could never live in the
 * snapshot anyway: it is one row per dealer x contract year x UW code x
 * vehicle-age band x mileage band x product x term x make x period.
 *
 * Deliberately reads `uwr_transformed_data` directly with a product filter,
 * rather than the `uwr_power_bi_warranty_source` view that wraps it, so this
 * page does not also depend on `presentation_contract.py` having run.
 */

/** Warranty only — the platform's scope. Mirrors `PRODUCT_SCOPE` in _config.py. */
const PRODUCT_SCOPE = "WARRANTY";

/**
 * The RSL warranty book, exactly as the live report defines it (the
 * `underwriting_codes` widget default in generate_agent_dealer_rag_pdf.py).
 * Dropping this filter would pull in other underwriting codes and the totals
 * would stop reconciling with the report.
 */
export const DASHBOARD_UNDERWRITING_CODES = [
  "RSLUNW",
  "RSLUNWTRUC",
  "RSLVAN",
  "RSLUNWMTH",
  "APVP",
  "RSL",
  "RSLUNWBIKE",
  "RSLUNWTAXI",
  "RSLBIKE",
  "RSLUNWIM",
  "RSLUNWMC",
  "RSLMOTHOME",
  "RSLCARAVAN",
] as const;

const SOURCE_TABLE = "uwr_transformed_data";

/** One row of the position query: the grain, plus the seven base sums. */
export interface DealerPositionRow extends MeasureBases {
  contractYear: number;
  underwritingCode: string | null;
  vehicleAgeBand: string | null;
  vehicleMileageBand: string | null;
  productTypeName: string | null;
  term: string | null;
  vehicleMake: string | null;
}

/** One development-period point, for the earned-loss triangle. */
export interface DealerDevelopmentRow {
  contractYear: number;
  period: number;
  claimsValue: number;
  earnedPremium: number;
}

/** The dashboard's header block. */
export interface DealerDashboardHeader {
  dealerCode: string;
  dealerName: string | null;
  agent: string | null;
  firstSoldOn: string | null;
  lastSoldOn: string | null;
  lastEndDate: string | null;
  /** The as-at date the position is earned to — the report's "Earn Till". */
  earnTill: string | null;
  firstContractYear: number | null;
  lastContractYear: number | null;
}

export interface DealerDashboard {
  header: DealerDashboardHeader;
  position: DealerPositionRow[];
  development: DealerDevelopmentRow[];
}

function num(v: string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function intOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the shared WHERE clause and its bound parameters.
 *
 * Every value is bound, including the underwriting codes — they are a
 * hardcoded constant here, not user input, but the repo's rule is that no
 * value is ever interpolated into SQL text (see databricks.ts). A rule with
 * "obviously safe" exceptions stops being a rule you can rely on. Only the
 * placeholder *names* are generated.
 */
function dealerFilter(dealerCode: string, earnedTill?: string) {
  const uwParams: SqlParam[] = DASHBOARD_UNDERWRITING_CODES.map((code, i) => ({
    name: `uw${i}`,
    value: code,
    type: "STRING" as const,
  }));
  const uwPlaceholders = uwParams.map((p) => `:${p.name}`).join(", ");

  // Structural, not a value: when the caller gives no as-at date we earn to the
  // latest period the table holds, which is what the report does when its
  // `earned_till` widget is blank.
  const earnedTillPredicate = earnedTill
    ? "t.financial_period_end_date <= :earned_till"
    : `t.financial_period_end_date <= (SELECT MAX(financial_period_end_date) FROM ${SOURCE_TABLE})`;

  const params: SqlParam[] = [
    { name: "dealer_code", value: dealerCode, type: "STRING" },
    { name: "product", value: PRODUCT_SCOPE, type: "STRING" },
    ...uwParams,
  ];
  if (earnedTill) params.push({ name: "earned_till", value: earnedTill, type: "DATE" });

  const where = `
    WHERE t.dealer_code = :dealer_code
      AND UPPER(t.product) = :product
      AND t.underwriting_code IN (${uwPlaceholders})
      AND ${earnedTillPredicate}`;

  return { where, params };
}

/**
 * The position aggregate, at the union of every grain the page's breakdown
 * sections need. One query serves all of them: because every displayed measure
 * is a function of sums, the API rolls this up per section in TypeScript
 * (dealerMeasures.rollUp) and gets results identical to grouping in SQL —
 * without a warehouse round trip per section.
 *
 * Contract years are NOT restricted here, unlike the report's 3-year widget
 * default: a dealer review wants the dealer's whole history available, and the
 * page filters by year client-side. Narrow to one year in the UI to reconcile
 * against a report run for that year.
 */
async function fetchPosition(dealerCode: string, earnedTill?: string): Promise<DealerPositionRow[]> {
  const { where, params } = dealerFilter(dealerCode, earnedTill);
  const rows = await executeStatement(
    `SELECT t.policy_contract_year        AS contract_year,
            t.underwriting_code           AS underwriting_code,
            t.Vehicle_Age_Grouping        AS vehicle_age_band,
            t.Vehicle_Mileage_Group       AS vehicle_mileage_band,
            t.product_type_name           AS product_type_name,
            t.term                        AS term,
            t.vehicle_make                AS vehicle_make,
            SUM(t.Units_Sold)             AS sold_policies,
            SUM(t.Dealer_Net)             AS dealer_net,
            SUM(t.Underwriting_Premium)   AS uw_premium,
            SUM(t.Earned_Premium)         AS earned_premium,
            SUM(t.Claim_Count)            AS claim_count,
            SUM(t.Claim_Value)            AS claims_value,
            SUM(t.Claim_Fund)             AS claim_fund
     FROM ${SOURCE_TABLE} t${where}
     GROUP BY t.policy_contract_year, t.underwriting_code, t.Vehicle_Age_Grouping,
              t.Vehicle_Mileage_Group, t.product_type_name, t.term, t.vehicle_make
     ORDER BY t.policy_contract_year, t.underwriting_code`,
    params,
  );
  return rows.map((r) => ({
    contractYear: num(r.contract_year),
    underwritingCode: r.underwriting_code,
    vehicleAgeBand: r.vehicle_age_band,
    vehicleMileageBand: r.vehicle_mileage_band,
    productTypeName: r.product_type_name,
    term: r.term,
    vehicleMake: r.vehicle_make,
    soldPolicies: num(r.sold_policies),
    dealerNet: num(r.dealer_net),
    uwPremium: num(r.uw_premium),
    earnedPremium: num(r.earned_premium),
    claimCount: num(r.claim_count),
    claimsValue: num(r.claims_value),
    claimFund: num(r.claim_fund),
  }));
}

/**
 * The earned-loss development series.
 *
 * `Period` is already a development index in `uwr_transformed_data` — 30-day
 * buckets since policy inception, 1 to 65 (transformed_data_port.py:327-333) —
 * so no derivation is needed here, only the per-period sums. The running total
 * that turns this into a cumulative triangle is done on the client, which lets
 * it re-cut the triangle by contract year without another query.
 */
async function fetchDevelopment(
  dealerCode: string,
  earnedTill?: string,
): Promise<DealerDevelopmentRow[]> {
  const { where, params } = dealerFilter(dealerCode, earnedTill);
  const rows = await executeStatement(
    `SELECT t.policy_contract_year AS contract_year,
            t.Period               AS period,
            SUM(t.Claim_Value)     AS claims_value,
            SUM(t.Earned_Premium)  AS earned_premium
     FROM ${SOURCE_TABLE} t${where}
       AND t.Period IS NOT NULL
     GROUP BY t.policy_contract_year, t.Period
     ORDER BY t.policy_contract_year, t.Period`,
    params,
  );
  return rows.map((r) => ({
    contractYear: num(r.contract_year),
    period: num(r.period),
    claimsValue: num(r.claims_value),
    earnedPremium: num(r.earned_premium),
  }));
}

/**
 * The header block. `master_agent.Agent_Code_Username` is the dotted lookup
 * column carried through the port and is what produces the report's
 * "RMORRIS 055" agent format; dotted names must be backtick-quoted in Spark.
 */
async function fetchHeader(
  dealerCode: string,
  earnedTill?: string,
): Promise<DealerDashboardHeader> {
  const { where, params } = dealerFilter(dealerCode, earnedTill);
  const rows = await executeStatement(
    `SELECT MAX(t.\`master_dealer.dealer_name\`)         AS dealer_name,
            MAX(t.\`master_agent.Agent_Code_Username\`)  AS agent,
            MIN(t.Min_Policy_Sold_Date)                  AS first_sold_on,
            MAX(t.Max_Policy_Sold_Date)                  AS last_sold_on,
            MAX(t.Max_End_Date)                          AS last_end_date,
            MAX(t.financial_period_end_date)             AS earn_till,
            MIN(t.policy_contract_year)                  AS first_contract_year,
            MAX(t.policy_contract_year)                  AS last_contract_year
     FROM ${SOURCE_TABLE} t${where}`,
    params,
  );
  const r = rows[0] ?? {};
  return {
    dealerCode,
    dealerName: r.dealer_name ?? null,
    agent: r.agent ?? null,
    firstSoldOn: r.first_sold_on ?? null,
    lastSoldOn: r.last_sold_on ?? null,
    lastEndDate: r.last_end_date ?? null,
    earnTill: r.earn_till ?? null,
    firstContractYear: intOrNull(r.first_contract_year ?? null),
    lastContractYear: intOrNull(r.last_contract_year ?? null),
  };
}

/**
 * Everything the Dealer Dashboard page needs, in three concurrent warehouse
 * round trips. None depends on another, so serialising them would triple the
 * page's latency for no reason.
 */
export async function fetchDealerDashboard(
  dealerCode: string,
  earnedTill?: string,
): Promise<DealerDashboard> {
  const [header, position, development] = await Promise.all([
    fetchHeader(dealerCode, earnedTill),
    fetchPosition(dealerCode, earnedTill),
    fetchDevelopment(dealerCode, earnedTill),
  ]);
  return { header, position, development };
}
