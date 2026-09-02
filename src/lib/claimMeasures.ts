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
 * Parts / Labour / VAT on the **assessed** (authorised) basis, per the
 * confirmed glossary row: Parts = `parts_cost_excluding_tax`, Labour =
 * `labour_cost_excluding_tax`, VAT = `parts_tax + labour_tax`, and the three
 * sum to `authorised_amount`.
 *
 * 🚩 These are the **bare** cost columns, which INDEX convention #4 documents as
 * proforma/repairer currency — a different basis from the
 * `authorised_amount_scheme_currency` used for Claim Value in sections 7-9. So
 * `total` here is NOT the same quantity as `claimValue` on the same rows, and
 * the two will differ for any non-GBP claim. Confirmed deliberately on
 * 2026-09-01 as matching the live report; flagged on the page.
 */
export interface ClaimValueSplit {
  parts: number;
  labour: number;
  vat: number;
  /** Parts + Labour + VAT. Sums to the bare `authorised_amount`. */
  total: number;
  partsPct: number | null;
  labourPct: number | null;
  vatPct: number | null;
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
  const total = parts + labour + vat;
  return {
    parts,
    labour,
    vat,
    total,
    // A zero total yields null, not 0% — the same null-vs-zero rule as
    // dealerMeasures.ts. A dealer with no claims has no split, which is a
    // different statement from a split of 0%.
    partsPct: pct(safeDivide(parts, total)),
    labourPct: pct(safeDivide(labour, total)),
    vatPct: pct(safeDivide(vat, total)),
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
// Both bands reuse the boundaries and labels `transformed_data_port.py:294-321`
// already uses for `Vehicle_Age_Grouping` and `Vehicle_Mileage_Group`, per
// underwriting's 2026-09-01 decision to keep the dashboard's bandings
// consistent. Semantics preserved exactly: lower-inclusive, upper-exclusive, so
// exactly 36 months lands in "B: 3 - 5 Years" and exactly 20000 miles in
// "20k - 40k".
//
// These tables are the single source of truth. `dealerClaims.ts` builds its SQL
// CASE expression from them and binds every threshold, so the warehouse and the
// browser cannot drift into disagreeing about which band a value falls in — a
// test asserts the generated SQL matches this table.
//
// 🚩 One deliberate difference from the notebook. The port dumps INT_MIN and
// negative garbage into the LOWEST band, to match the live model exactly — a
// decision taken for policy data. The glossary requires bound-filtering for the
// claim bands, so unusable values route to an explicit UNKNOWN_BAND instead.
// Dropping them would make these sections' totals disagree with each other;
// hiding them in "0k - 20k" would misstate the best band. Neither is acceptable
// when the reader is judging a dealer.
// ---------------------------------------------------------------------------

/** Where a value that cannot be banded goes. Visible, never silently dropped. */
export const UNKNOWN_BAND = "Unknown";

/** Where a claim with no recorded payee type goes. */
export const UNRECORDED_PAYEE = "Unrecorded";

export interface Band {
  /** Exclusive upper bound; null for the final catch-all band. */
  upperExclusive: number | null;
  label: string;
}

/** Elapsed months between cover start and loss. Thresholds are months. */
export const CLAIM_ELAPSED_BANDS: readonly Band[] = [
  { upperExclusive: 36, label: "A: 0 - 3 Years" },
  { upperExclusive: 60, label: "B: 3 - 5 Years" },
  { upperExclusive: 84, label: "C: 5 - 7 Years" },
  { upperExclusive: 120, label: "D: 7 - 10 Years" },
  { upperExclusive: 144, label: "E: 10 - 12 Years" },
  { upperExclusive: null, label: "F: Over 12 Years" },
];

/** Absolute odometer reading at breakdown. NOT miles since sale. */
export const CLAIM_MILEAGE_BANDS: readonly Band[] = [
  { upperExclusive: 20000, label: "0k - 20k" },
  { upperExclusive: 40000, label: "20k - 40k" },
  { upperExclusive: 60000, label: "40k - 60k" },
  { upperExclusive: 80000, label: "60k - 80k" },
  { upperExclusive: 100000, label: "80k - 100k" },
  { upperExclusive: null, label: "Over 100k" },
];

/**
 * The largest odometer reading treated as real. Above this, `breakdown_mileage`
 * is the documented "absurd maxima (billions)" garbage.
 *
 * 🚩 This threshold is NOT documented anywhere — `01_fact_claim_context.md` says
 * "bound-filter INT_MIN / billions" and gives no number, and no profiled range
 * for the column exists. 500,000 is a judgement call: comfortably above any
 * genuine vehicle covered by a used-car warranty, far below the garbage.
 * Recorded here rather than buried in SQL so it can be argued with.
 */
export const MAX_PLAUSIBLE_MILEAGE = 500_000;

/**
 * Bands a value, returning `UNKNOWN_BAND` for null or negative input.
 *
 * Negative matters for elapsed time: a loss dated before cover start is either
 * a sentinel date that escaped normalisation or a genuine data problem. Either
 * way it is not "0 - 3 years", so it is surfaced rather than absorbed.
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
 * Order comes from the band table, never from sorting the labels. As it happens
 * en-GB collation orders today's labels correctly — "0k - 20k" … "Over 100k",
 * and the age labels carry "A: ".."F: " prefixes precisely to make that work —
 * but that is a coincidence of these particular strings, not a property to rely
 * on. Rename a band to "5k - 10k" and it would collate before "0k - 20k" with
 * nothing to signal the reordering. Taking the order from the table means the
 * labels are free to change.
 */
export function bandOrder(bands: readonly Band[]): string[] {
  return [...bands.map((b) => b.label), UNKNOWN_BAND];
}
