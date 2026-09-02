/**
 * Display formatting for dashboard measures.
 *
 * The one rule that matters here: **null renders as an em dash, never as zero**.
 * A null measure means the denominator was zero — "we cannot compute this" —
 * which is a different statement from "this is zero". Oakmere Lotus has zero
 * claims, so its Written Loss Ratio is genuinely 0.00% while its Avg Claim
 * Value is blank. Printing £0.00 for the latter would assert that claims exist
 * and cost nothing. The Power BI report leaves it blank; so do we.
 */

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const int = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export const DASH = "—";

export function fmtGbp(v: number | null): string {
  return v === null ? DASH : gbp.format(v);
}

/** Values already scaled to percent (e.g. 18.55 renders "18.55%"). */
export function fmtPct(v: number | null, dp = 2): string {
  return v === null ? DASH : `${v.toFixed(dp)}%`;
}

export function fmtInt(v: number | null): string {
  return v === null ? DASH : int.format(v);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString("en-GB");
}

/**
 * A plain number — miles, hours, days. Same null rule as everything else here.
 * Separate from `fmtInt` because these carry decimals that matter: an effective
 * labour rate of 62.5 is not 63.
 */
export function fmtNum(v: number | null, dp = 1): string {
  return v === null ? DASH : v.toLocaleString("en-GB", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
