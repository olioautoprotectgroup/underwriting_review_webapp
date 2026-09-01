/**
 * The Dealer Dashboard's measure arithmetic, as pure functions.
 *
 * This is a direct port of `_calculate_derived` in
 * `underwriting_reviews/notebooks/generate_agent_dealer_rag_pdf.py` (lines
 * ~90-119), which is what produces the live Agent-by-Dealer RAG report. It is
 * ported rather than re-derived on purpose: these figures are compared against
 * the Power BI report by the underwriting team, so "nearly right" is worse than
 * useless. If the notebook's definitions change, change them here too.
 *
 * Two rules that are easy to get wrong and that the tests pin down:
 *
 * 1. **Every ratio is computed from summed bases, never averaged.** A total row
 *    is `derive(sum(bases))`, NOT `average(derive(each row))`. Averaging ratios
 *    silently produces different numbers, and they look plausible.
 * 2. **A zero or non-finite denominator yields null, not zero.** The report
 *    renders those blank. Oakmere Lotus has no claims, so its Burn Cost is
 *    blank (0/0) while its Written Loss Ratio is 0.00% (0/8346) — a genuine
 *    distinction between "no data" and "zero", and collapsing it to 0 would
 *    misrepresent the dealer.
 */

/** The seven base sums every measure is derived from. */
export interface MeasureBases {
  soldPolicies: number;
  dealerNet: number;
  uwPremium: number;
  earnedPremium: number;
  claimCount: number;
  claimsValue: number;
  claimFund: number;
}

/** Bases plus every derived measure the dashboard displays. */
export interface DealerMeasures extends MeasureBases {
  /** Earned Premium / UW Premium, as a fraction (not %). */
  maturity: number | null;
  maturityPct: number | null;
  /** Units x Maturity. The denominator for burn cost and claim frequency. */
  earnedUnits: number | null;
  avgDealerNet: number | null;
  avgUwPremium: number | null;
  avgClaimValue: number | null;
  writtenLossRatioPct: number | null;
  earnedLossRatioPct: number | null;
  claimFrequencyPct: number | null;
  burnCost: number | null;
  uwFundPct: number | null;
  earnedProfitLoss: number;
  projectedProfitLoss: number | null;
}

/**
 * Division that yields null rather than Infinity/NaN/0. Mirrors the notebook's
 * `_safe_divide`: null when either side is non-finite or the denominator is 0.
 */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

const pct = (v: number | null): number | null => (v === null ? null : v * 100);

export function deriveMeasures(b: MeasureBases): DealerMeasures {
  const maturity = safeDivide(b.earnedPremium, b.uwPremium);
  const earnedUnits = maturity === null ? null : b.soldPolicies * maturity;

  return {
    ...b,
    maturity,
    maturityPct: pct(maturity),
    earnedUnits,
    avgDealerNet: safeDivide(b.dealerNet, b.soldPolicies),
    avgUwPremium: safeDivide(b.uwPremium, b.soldPolicies),
    avgClaimValue: safeDivide(b.claimsValue, b.claimCount),
    writtenLossRatioPct: pct(safeDivide(b.claimsValue, b.uwPremium)),
    earnedLossRatioPct: pct(safeDivide(b.claimsValue, b.earnedPremium)),
    claimFrequencyPct: pct(safeDivide(b.claimCount, earnedUnits)),
    burnCost: safeDivide(b.claimsValue, earnedUnits),
    uwFundPct: pct(safeDivide(b.claimFund, b.uwPremium)),
    earnedProfitLoss: b.earnedPremium - b.claimsValue,
    projectedProfitLoss:
      maturity === null || maturity === 0 ? null : b.uwPremium - b.claimsValue / maturity,
  };
}

export const ZERO_BASES: MeasureBases = {
  soldPolicies: 0,
  dealerNet: 0,
  uwPremium: 0,
  earnedPremium: 0,
  claimCount: 0,
  claimsValue: 0,
  claimFund: 0,
};

export function addBases(a: MeasureBases, b: MeasureBases): MeasureBases {
  return {
    soldPolicies: a.soldPolicies + b.soldPolicies,
    dealerNet: a.dealerNet + b.dealerNet,
    uwPremium: a.uwPremium + b.uwPremium,
    earnedPremium: a.earnedPremium + b.earnedPremium,
    claimCount: a.claimCount + b.claimCount,
    claimsValue: a.claimsValue + b.claimsValue,
    claimFund: a.claimFund + b.claimFund,
  };
}

export function sumBases(rows: readonly MeasureBases[]): MeasureBases {
  return rows.reduce(addBases, ZERO_BASES);
}

/**
 * Groups rows by a key, sums each group's bases, then derives once per group.
 *
 * This is the only correct way to build any of the dashboard's breakdown
 * sections — see rule 1 in the file header. Because every measure is a function
 * of sums, rolling up here gives byte-identical results to grouping in SQL,
 * which is why the API can issue one query at the finest grain and shape every
 * section from it rather than making a round trip per section.
 *
 * Insertion-ordered, so callers control row order by sorting their input.
 */
export function rollUp<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  basesOf: (row: T) => MeasureBases,
): { key: string; measures: DealerMeasures }[] {
  const grouped = new Map<string, MeasureBases>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, addBases(grouped.get(key) ?? ZERO_BASES, basesOf(row)));
  }
  return [...grouped].map(([key, bases]) => ({ key, measures: deriveMeasures(bases) }));
}

/**
 * "Book %" — a row's share of units within its enclosing group.
 *
 * Not defined in the metadata repo; confirmed arithmetically against the
 * published Oakmere Lotus dashboard (15/17 = 88.24%, 1/17 = 5.88%,
 * 14/17 = 82.35%). Note the denominator is the *enclosing* group, which
 * re-bases per section: the Product Term section divides by the product's own
 * total (6/15 = 40.00%), not the dealer's overall total.
 */
export function bookPct(rowUnits: number, groupUnits: number): number | null {
  return pct(safeDivide(rowUnits, groupUnits));
}
