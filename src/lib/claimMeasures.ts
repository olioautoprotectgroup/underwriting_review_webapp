import { safeDivide } from "./dealerMeasures";

/**
 * The claim-detail sections' arithmetic and banding, as pure functions.
 *
 * These are sections 7-10 of the Power BI "Dealer Dashboard" — Analysis by
 * Elapsed Time, by Elapsed Mileage, Claim Payee Analysis, and the Claims Value
 * Split. Their measures were undefined until underwriting confirmed them on
 * 2026-09-01; the definitions live in the metadata repo's
 * `08_underwriting_metrics_glossary.md`.
 *
 * Kept separate from `dealerMeasures.ts` because the grain is different. That
 * module's `MeasureBases` are policy-side sums off `uwr_transformed_data`;
 * these are claim-side sums off `vw_fact_claim`. They are not interchangeable
 * and must not be added together — see the basis warning below.
 *
 * **These figures do not tie to sections 1-6, and that is expected.** Those
 * read `uwr_transformed_data`, whose `Claim_Value` is a snapshot figure trued
 * up against `fact_claim`. The true-up joins the two positions with an INNER
 * join and allocates the whole correction to each policy's latest period, so a
 * policy present in `fact_claim` but absent from `fact_monthly_snapshot`
 * contributes here and not there. Using the same value column
 * (`authorised_amount_scheme_currency`) narrows the gap; nothing closes it.
 * The page states this rather than letting a reader assume the totals should
 * match.
 */

/** The claim-side sums every measure below is derived from. */
export interface ClaimBases {
  claimCount: number;
  claimValue: number;
  /** `parts_cost_excluding_tax` — bare column, see the currency note below. */
  partsCost: number;
  labourCost: number;
  partsTax: number;
  labourTax: number;
  /** `repair_time`. Units are undocumented; hours are implied by Labour per Hour. */
  repairTime: number;
}

export const ZERO_CLAIM_BASES: ClaimBases = {
  claimCount: 0,
  claimValue: 0,
  partsCost: 0,
  labourCost: 0,
  partsTax: 0,
  labourTax: 0,
  repairTime: 0,
};

/**
 * The Claims Value Split — section 10.
 *
 * Parts / Labour / VAT on the **assessed** (authorised) basis: Parts =
 * `parts_cost_excluding_tax`, Labour = `labour_cost_excluding_tax`, VAT =
 * `parts_tax + labour_tax`.
 *
 * **Every percentage is over Claims Value, not over the three components' own
 * sum.** Verified against the published Redgate Lodge dashboard: Parts
 * £191,530.44 of Claims Value £265,399.64 prints as 72.17%, which is
 * parts ÷ claim value. Dividing by the components' sum would give 74.47% —
 * plausible-looking and wrong.
 *
 * 🚩 **The three components do not add up to Claims Value.** On Redgate Lodge
 * they cover 96.91%, leaving £8,191.17 unaccounted for. The live report simply
 * does not show that remainder. `other` exposes it so the column reaches 100%
 * and the gap is visible rather than being a puzzle for whoever adds the
 * percentages up. What it consists of is not documented anywhere.
 *
 * 🚩 These are also the **bare** cost columns, which INDEX convention #4
 * documents as proforma/repairer currency, whereas `claimValue` is
 * `authorised_amount_scheme_currency`. For a mixed-currency book that alone
 * would make the percentages wrong; it is how the live report computes them.
 */
export interface ClaimValueSplit {
  parts: number;
  labour: number;
  vat: number;
  /**
   * The denominator every percentage below uses: the section's Claims Value,
   * the same figure the other claim sections total to.
   */
  claimValue: number;
  /** Claims Value − (Parts + Labour + VAT). See the 🚩 below. */
  other: number;
  partsPct: number | null;
  labourPct: number | null;
  vatPct: number | null;
  otherPct: number | null;
  /** `labour_cost_excluding_tax / repair_time` — the effective assessed rate. */
  labourPerHour: number | null;
}

function pct(fraction: number | null): number | null {
  return fraction === null ? null : fraction * 100;
}

export function splitClaimValue(b: ClaimBases): ClaimValueSplit {
  const parts = b.partsCost;
  const labour = b.labourCost;
  const vat = b.partsTax + b.labourTax;
  const claimValue = b.claimValue;
  return {
    parts,
    labour,
    vat,
    claimValue,
    other: claimValue - (parts + labour + vat),
    // A zero denominator yields null, not 0% — the same null-vs-zero rule as
    // dealerMeasures.ts. A dealer with no claims has no split, which is a
    // different statement from a split of 0%.
    partsPct: pct(safeDivide(parts, claimValue)),
    labourPct: pct(safeDivide(labour, claimValue)),
    vatPct: pct(safeDivide(vat, claimValue)),
    otherPct: pct(safeDivide(claimValue - (parts + labour + vat), claimValue)),
    labourPerHour: safeDivide(labour, b.repairTime),
  };
}

export function addClaimBases(a: ClaimBases, b: ClaimBases): ClaimBases {
  return {
    claimCount: a.claimCount + b.claimCount,
    claimValue: a.claimValue + b.claimValue,
    partsCost: a.partsCost + b.partsCost,
    labourCost: a.labourCost + b.labourCost,
    partsTax: a.partsTax + b.partsTax,
    labourTax: a.labourTax + b.labourTax,
    repairTime: a.repairTime + b.repairTime,
  };
}

export function sumClaimBases(rows: readonly ClaimBases[]): ClaimBases {
  return rows.reduce(addClaimBases, ZERO_CLAIM_BASES);
}

/**
 * Group claim rows and sum each group's bases. The claim-side analogue of
 * `rollUp` in dealerMeasures.ts, and insertion-ordered for the same reason:
 * callers control row order by sorting their input.
 */
export function rollUpClaims<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  basesOf: (row: T) => ClaimBases,
): { key: string; bases: ClaimBases }[] {
  const grouped = new Map<string, ClaimBases>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, addClaimBases(grouped.get(key) ?? ZERO_CLAIM_BASES, basesOf(row)));
  }
  return [...grouped].map(([key, bases]) => ({ key, bases }));
}

/** A row's share of its enclosing group's claim count, as a %. */
export function sharePct(rowCount: number, groupCount: number): number | null {
  return pct(safeDivide(rowCount, groupCount));
}

// ---------------------------------------------------------------------------
// Banding
//
// Both band tables are taken from the LIVE REPORT'S OWN LABELS, read off the
// published Redgate Lodge dashboard (dealer 12299132, contracts 2023-2026).
//
// They are NOT the `Vehicle_Age_Grouping` / `Vehicle_Mileage_Group` bands from
// transformed_data_port.py. An earlier version of this file reused those, which
// was wrong on both counts: the report bands claim age in DAYS, not vehicle
// years, and its mileage bands top out at "Over 15 K" — impossible for an
// odometer reading on a used car, and proof that Elapsed Mileage really is
// mileage *since sale* rather than the absolute reading.
//
// Semantics follow the rest of the platform: lower-inclusive, upper-exclusive.
// The report's own labels overlap at the boundaries ("A: 0 - 500" then
// "B: 500 - 1000"), so exactly 500 lands in B.
//
// These tables are the single source of truth. `dealerClaims.ts` builds its SQL
// CASE expression from them and binds every threshold, so the warehouse and the
// browser cannot drift into disagreeing about which band a value falls in — a
// test asserts the generated SQL matches this table.
//
// 🚩 Unusable values route to an explicit UNKNOWN_BAND rather than the lowest
// band. transformed_data_port.py deliberately does the opposite for policy data,
// to match the live model. Here, dropping them would make these sections' totals
// disagree with each other, and hiding them in the best band would misstate it
// on a page used to judge a dealer.
// ---------------------------------------------------------------------------

/** Where a value that cannot be banded goes. Visible, never silently dropped. */
export const UNKNOWN_BAND = "Unknown";

/**
 * Where a claim with a NULL `payee_type` goes.
 *
 * Deliberately not "Unknown": the report shows a literal `UNKNOWN` payee type
 * in the data (2 claims on Redgate Lodge), and conflating a real category with
 * a missing value would merge two different things into one row.
 */
export const UNRECORDED_PAYEE = "Not recorded";

export interface Band {
  /** Exclusive upper bound; null for the final catch-all band. */
  upperExclusive: number | null;
  label: string;
}

/**
 * "Claim Age" — whole DAYS between cover start and the loss.
 *
 * Eleven bands: a tight 0-14 and 15-30 at the front, then 30-day steps to 270,
 * then a catch-all. That shape is why the vehicle-age bands were the wrong
 * reuse — on Redgate Lodge's 2023 cohort, 159 of 265 claims fall in
 * "K: Over 270 Days", and every one of them would have collapsed into a single
 * "A: 0 - 3 Years" bucket under the old banding.
 */
export const CLAIM_ELAPSED_BANDS: readonly Band[] = [
  { upperExclusive: 15, label: "A: 0 - 14" },
  { upperExclusive: 31, label: "B: 15 - 30" },
  { upperExclusive: 61, label: "C: 31 - 60" },
  { upperExclusive: 91, label: "D: 61 - 90" },
  { upperExclusive: 121, label: "E: 91 - 120" },
  { upperExclusive: 151, label: "F: 121 - 150" },
  { upperExclusive: 181, label: "G: 151 - 180" },
  { upperExclusive: 211, label: "H: 181 - 210" },
  { upperExclusive: 241, label: "I: 211 - 240" },
  { upperExclusive: 271, label: "J: 241 - 270" },
  { upperExclusive: null, label: "K: Over 270 Days" },
];

/**
 * "Claim Mileage" — miles covered between sale and breakdown.
 *
 * Fine at the bottom (0-500, 500-1000) because an early-life failure is the
 * signal underwriting cares about, then widening to a 15k catch-all.
 */
export const CLAIM_MILEAGE_BANDS: readonly Band[] = [
  { upperExclusive: 500, label: "A: 0 - 500" },
  { upperExclusive: 1000, label: "B: 500 - 1000" },
  { upperExclusive: 2500, label: "C: 1000 - 2500" },
  { upperExclusive: 5000, label: "D: 2500 - 5000" },
  { upperExclusive: 10000, label: "E: 5 K - 10 K" },
  { upperExclusive: 15000, label: "F: 10 K - 15 K" },
  { upperExclusive: null, label: "G: Over 15 K" },
];

/**
 * The largest elapsed mileage treated as real.
 *
 * 🚩 NOT a documented threshold. `01_fact_claim_context.md` says to bound-filter
 * "INT_MIN / billions" and gives no number, and the column has never been
 * profiled. 500,000 is a judgement call: far above any genuine miles-since-sale
 * on a used-car warranty, far below the garbage. Recorded here rather than
 * buried in SQL so it can be argued with.
 */
export const MAX_PLAUSIBLE_MILEAGE = 500_000;

/**
 * Bands a value, returning `UNKNOWN_BAND` for null, non-finite or negative
 * input.
 *
 * Negative matters for both sections: a loss dated before cover start, or a
 * breakdown odometer below the sale reading, is either a sentinel that escaped
 * normalisation or a genuine data problem. Either way it is not "0 - 14 days"
 * or "0 - 500 miles", so it is surfaced rather than absorbed into the band that
 * makes the dealer look best.
 */
export function bandFor(value: number | null, bands: readonly Band[]): string {
  if (value === null || !Number.isFinite(value) || value < 0) return UNKNOWN_BAND;
  for (const band of bands) {
    if (band.upperExclusive === null || value < band.upperExclusive) return band.label;
  }
  return UNKNOWN_BAND;
}

/**
 * Display order for a banded section: the bands in their natural order, with
 * `UNKNOWN_BAND` last.
 *
 * Order comes from the band table, never from sorting the labels. The "A: ".."K: "
 * prefixes are the report's own and would mostly collate correctly, but relying
 * on that is fragile — the mileage labels alone contain "5 K - 10 K" and
 * "10 K - 15 K", which collate in the wrong order. Taking the order from the
 * table means the labels are free to change.
 */
export function bandOrder(bands: readonly Band[]): string[] {
  return [...bands.map((b) => b.label), UNKNOWN_BAND];
}
