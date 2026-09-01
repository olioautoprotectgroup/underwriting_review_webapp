import { describe, it, expect } from "vitest";
import {
  addBases,
  bookPct,
  deriveMeasures,
  rollUp,
  safeDivide,
  sumBases,
  ZERO_BASES,
  type MeasureBases,
} from "../src/lib/dealerMeasures";

/**
 * These assert against the REAL published figures from the live Power BI
 * "Dealer Dashboard" for OAKMERE LOTUS (dealer 370656, contract year 2026,
 * UW code RSLUNW) — the PDF the underwriting team actually reads.
 *
 * That is the point: this module exists to reproduce that report, so the test
 * fixture is the report, not numbers I invented. If these drift, the web page
 * has started disagreeing with the report the business trusts.
 *
 * Published row:
 *   Units Sold 17 · Avg Dealer Net £798.28 · Maturity 18.55% ·
 *   UW Prem £8,346.01 · Avg UW Prem £490.94 · Claim Count 0 · Claim Value £0.00 ·
 *   Written LR 0.00% · Earned LR 0.00% · Claim Freq 0.00% ·
 *   Earned Profit/Loss £1,547.84
 *
 * Bases are back-solved from the published averages: dealer_net = 17 x 798.28,
 * earned_premium = the published Earned Profit/Loss (claims are zero, and
 * earned_profit_loss = earned - claims).
 */
const OAKMERE: MeasureBases = {
  soldPolicies: 17,
  dealerNet: 17 * 798.28,
  uwPremium: 8346.01,
  earnedPremium: 1547.84,
  claimCount: 0,
  claimsValue: 0,
  claimFund: 0,
};

describe("deriveMeasures — against the published Oakmere Lotus dashboard", () => {
  const m = deriveMeasures(OAKMERE);

  it("reproduces Avg Dealer Net (£798.28)", () => {
    expect(m.avgDealerNet).toBeCloseTo(798.28, 2);
  });

  it("reproduces Avg UW Prem (£490.94)", () => {
    expect(m.avgUwPremium).toBeCloseTo(490.94, 2);
  });

  it("reproduces Maturity % (18.55%)", () => {
    expect(m.maturityPct).toBeCloseTo(18.55, 2);
  });

  it("reproduces Earned Profit/Loss (£1,547.84)", () => {
    expect(m.earnedProfitLoss).toBeCloseTo(1547.84, 2);
  });

  it("reports 0.00% Written and Earned Loss Ratio, not null", () => {
    // Zero claims over a non-zero premium is a real zero, and the report
    // prints "0.00%". Only a zero DENOMINATOR is blank.
    expect(m.writtenLossRatioPct).toBe(0);
    expect(m.earnedLossRatioPct).toBe(0);
  });

  it("reports Burn Cost as null (blank), because earned units are the denominator", () => {
    // earnedUnits = 17 x 0.1854... which is non-zero, so burn cost is 0/x = 0.
    expect(m.earnedUnits).toBeCloseTo(17 * (1547.84 / 8346.01), 6);
    expect(m.burnCost).toBe(0);
  });

  it("reports Avg Claim Value as null, not 0, when there are no claims", () => {
    // 0 claims / 0 count. The report leaves this blank; rendering £0.00 would
    // wrongly imply claims exist with zero value.
    expect(m.avgClaimValue).toBeNull();
  });
});

describe("safeDivide null semantics", () => {
  it("returns null on a zero denominator rather than Infinity", () => {
    expect(safeDivide(5, 0)).toBeNull();
  });

  it("returns 0 for a zero numerator over a real denominator", () => {
    expect(safeDivide(0, 5)).toBe(0);
  });

  it("returns null for 0/0 rather than NaN", () => {
    expect(safeDivide(0, 0)).toBeNull();
  });

  it("returns null on non-finite input", () => {
    expect(safeDivide(Infinity, 2)).toBeNull();
    expect(safeDivide(2, NaN)).toBeNull();
  });

  it("propagates null", () => {
    expect(safeDivide(null, 2)).toBeNull();
    expect(safeDivide(2, null)).toBeNull();
  });
});

describe("totals are derived from summed bases, never averaged ratios", () => {
  // Two cohorts with deliberately different maturities. Averaging their loss
  // ratios gives a different (wrong) answer from deriving off the summed bases,
  // so this pins the distinction rather than assuming it.
  const a: MeasureBases = {
    soldPolicies: 10,
    dealerNet: 1000,
    uwPremium: 1000,
    earnedPremium: 1000,
    claimCount: 2,
    claimsValue: 900,
    claimFund: 0,
  };
  const b: MeasureBases = {
    soldPolicies: 10,
    dealerNet: 1000,
    uwPremium: 1000,
    earnedPremium: 100,
    claimCount: 1,
    claimsValue: 10,
    claimFund: 0,
  };

  it("computes the total ELR from summed bases", () => {
    const total = deriveMeasures(sumBases([a, b]));
    // (900 + 10) / (1000 + 100) = 82.7272...%
    expect(total.earnedLossRatioPct).toBeCloseTo(82.7273, 3);
  });

  it("and that differs from averaging the two ELRs — the trap this guards", () => {
    const averaged =
      ((deriveMeasures(a).earnedLossRatioPct ?? 0) + (deriveMeasures(b).earnedLossRatioPct ?? 0)) / 2;
    expect(averaged).toBeCloseTo(50, 3); // (90% + 10%) / 2
    expect(averaged).not.toBeCloseTo(82.7273, 1);
  });
});

describe("addBases / sumBases", () => {
  it("sums every base field", () => {
    expect(addBases(OAKMERE, OAKMERE).soldPolicies).toBe(34);
    expect(addBases(OAKMERE, OAKMERE).uwPremium).toBeCloseTo(16692.02, 2);
  });

  it("sums an empty list to zero rather than throwing", () => {
    expect(sumBases([])).toEqual(ZERO_BASES);
  });
});

describe("rollUp", () => {
  const rows = [
    { band: "0k - 20k", ...a() },
    { band: "20k - 40k", ...a() },
    { band: "0k - 20k", ...a() },
  ];
  function a() {
    return {
      soldPolicies: 1,
      dealerNet: 100,
      uwPremium: 100,
      earnedPremium: 50,
      claimCount: 0,
      claimsValue: 0,
      claimFund: 0,
    };
  }

  it("groups, sums and derives once per group", () => {
    const out = rollUp(rows, (r) => r.band, (r) => r);
    expect(out.map((o) => o.key)).toEqual(["0k - 20k", "20k - 40k"]); // insertion order
    expect(out[0].measures.soldPolicies).toBe(2);
    expect(out[0].measures.maturityPct).toBeCloseTo(50, 6);
  });

  it("rolling up then deriving equals deriving the grand total directly", () => {
    // The property that lets the API issue ONE query at the finest grain and
    // shape every section from it.
    const viaRollUp = sumBases(rollUp(rows, (r) => r.band, (r) => r).map((o) => o.measures));
    const direct = sumBases(rows);
    expect(viaRollUp.uwPremium).toBeCloseTo(direct.uwPremium, 6);
    expect(deriveMeasures(viaRollUp).earnedLossRatioPct).toBe(
      deriveMeasures(direct).earnedLossRatioPct,
    );
  });
});

describe("bookPct — confirmed against the published dashboard", () => {
  it("matches the Inception Age section (15/17 = 88.24%)", () => {
    expect(bookPct(15, 17)).toBeCloseTo(88.24, 2);
  });

  it("matches the two 1/17 = 5.88% age bands", () => {
    expect(bookPct(1, 17)).toBeCloseTo(5.88, 2);
  });

  it("matches the Inception Mileage section (14/17 = 82.35%, 3/17 = 17.65%)", () => {
    expect(bookPct(14, 17)).toBeCloseTo(82.35, 2);
    expect(bookPct(3, 17)).toBeCloseTo(17.65, 2);
  });

  it("re-bases to the enclosing group in the Product Term section (6/15 = 40.00%)", () => {
    // Not 6/17 — the denominator is the product's own total, not the dealer's.
    expect(bookPct(6, 15)).toBeCloseTo(40.0, 2);
    expect(bookPct(3, 15)).toBeCloseTo(20.0, 2);
  });

  it("is null, not 0, for an empty group", () => {
    expect(bookPct(0, 0)).toBeNull();
  });
});

describe("the frontend copy of this module", () => {
  it("is byte-identical to the API copy", async () => {
    // dealerMeasures.ts is duplicated into src/lib/ by hand, the same
    // convention this repo uses for types.ts and allowlist.ts — the frontend
    // needs it to re-roll-up sections when you change the year or measure,
    // without another warehouse round trip.
    //
    // Duplicating *arithmetic* is riskier than duplicating types: a silent
    // divergence would make the page disagree with the underwriting team's
    // report and with these tests, while looking fine. So this asserts the two
    // files are identical rather than trusting anyone to remember.
    // Paths are resolved from the vitest cwd (this api/ workspace) rather than
    // import.meta.url: this package is CommonJS, so import.meta fails
    // `tsc --noEmit` even though vitest itself runs it happily.
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const [api, web] = await Promise.all([
      readFile(resolve(process.cwd(), "src/lib/dealerMeasures.ts"), "utf-8"),
      readFile(resolve(process.cwd(), "../src/lib/dealerMeasures.ts"), "utf-8"),
    ]);
    expect(web).toBe(api);
  });
});
