import { describe, it, expect } from "vitest";
import {
  addClaimBases,
  bandFor,
  bandOrder,
  CLAIM_ELAPSED_BANDS,
  CLAIM_MILEAGE_BANDS,
  rollUpClaims,
  sharePct,
  splitClaimValue,
  sumClaimBases,
  UNKNOWN_BAND,
  ZERO_CLAIM_BASES,
  type ClaimBases,
} from "../src/lib/claimMeasures";
import { buildBandCase } from "../src/lib/dealerClaims";

function bases(overrides: Partial<ClaimBases> = {}): ClaimBases {
  return { ...ZERO_CLAIM_BASES, ...overrides };
}

/**
 * These assert the REAL published figures from the live Power BI "Dealer
 * Dashboard" for REDGATE LODGE (dealer 12299132, contracts 2023-2026) — a
 * claims-heavy dealer, chosen precisely because the earlier Oakmere sample has
 * zero claims and exercised none of this.
 *
 * Published Claims Value Split:
 *   Claims Value £265,399.64
 *   Parts Value  £191,530.44   72.17%
 *   Labour        £55,048.55   20.74%
 *   VAT           £10,629.48    4.01%
 *   Labour/Hour       £49.78
 */
const REDGATE: ClaimBases = {
  claimCount: 680,
  claimValue: 265399.64,
  partsCost: 191530.44,
  labourCost: 55048.55,
  // The report prints VAT as one figure; only the two-column sum is observable.
  partsTax: 10629.48,
  labourTax: 0,
  // Back-solved from the published Labour/Hour: 55048.55 / 49.78.
  repairTime: 55048.55 / 49.78,
};

describe("splitClaimValue — against the published Redgate Lodge dashboard", () => {
  const s = splitClaimValue(REDGATE);

  it("reproduces the published Parts split of 72.17%", () => {
    expect(s.partsPct).toBeCloseTo(72.17, 2);
  });

  it("reproduces the published Labour split of 20.74%", () => {
    expect(s.labourPct).toBeCloseTo(20.74, 2);
  });

  it("reproduces the published VAT split of 4.01%", () => {
    expect(s.vatPct).toBeCloseTo(4.01, 2);
  });

  it("reproduces the published Labour/Hour of £49.78", () => {
    expect(s.labourPerHour).toBeCloseTo(49.78, 2);
  });

  it("divides by Claims Value, NOT by the components' own sum", () => {
    // This is the bug the published report caught. Dividing Parts by
    // (parts + labour + vat) gives 74.47% — plausible-looking, and wrong by
    // more than two points. Only the Claims Value denominator reproduces the
    // report, so this pins the denominator rather than the arithmetic.
    const componentSum = s.parts + s.labour + s.vat;
    expect((s.parts / componentSum) * 100).toBeCloseTo(74.47, 2);
    expect(s.partsPct).not.toBeCloseTo(74.47, 1);
  });

  it("surfaces the 3.09% of Claims Value the components do not explain", () => {
    // Parts + Labour + VAT cover only 96.91% of Redgate's Claims Value. The
    // live report simply omits the remainder; the web page shows it so the
    // column reaches 100% instead of quietly falling short.
    expect(s.other).toBeCloseTo(8191.17, 2);
    expect(s.otherPct).toBeCloseTo(3.09, 2);
    expect(
      (s.partsPct ?? 0) + (s.labourPct ?? 0) + (s.vatPct ?? 0) + (s.otherPct ?? 0),
    ).toBeCloseTo(100, 6);
  });
});

describe("splitClaimValue — null and zero semantics", () => {
  it("sums VAT from both tax columns, not just one", () => {
    const s = splitClaimValue(bases({ claimValue: 100, partsTax: 30, labourTax: 20 }));
    expect(s.vat).toBe(50);
  });

  it("computes Labour per Hour from labour excluding tax, not labour plus VAT", () => {
    // 300 / 4 = 75. Using 360 (labour + its tax) would give 90 and silently
    // overstate the effective rate by the VAT rate.
    const s = splitClaimValue(bases({ claimValue: 1000, labourCost: 300, labourTax: 60, repairTime: 4 }));
    expect(s.labourPerHour).toBe(75);
  });

  it("reports Labour per Hour as null, not zero or Infinity, when repair time is zero", () => {
    const s = splitClaimValue(bases({ claimValue: 500, labourCost: 300, repairTime: 0 }));
    expect(s.labourPerHour).toBeNull();
  });

  it("reports every split percentage as null when there is no claim value at all", () => {
    // A dealer with no claims has no split. Rendering 0% would assert the
    // claims exist and cost nothing — the same null-vs-zero rule as the
    // policy-side measures.
    const s = splitClaimValue(ZERO_CLAIM_BASES);
    expect(s.partsPct).toBeNull();
    expect(s.labourPct).toBeNull();
    expect(s.vatPct).toBeNull();
    expect(s.otherPct).toBeNull();
    expect(s.labourPerHour).toBeNull();
  });

  it("keeps a genuine zero component as 0%, not blank, when there is claim value", () => {
    // No parts on any claim is a real finding (labour-only repairs), and
    // distinct from "no claims".
    const s = splitClaimValue(bases({ claimValue: 120, labourCost: 100, labourTax: 20 }));
    expect(s.partsPct).toBe(0);
    expect(s.labourPct).toBeCloseTo(83.3333, 4);
  });
});

describe("bandFor — the report's real bands, lower-inclusive/upper-exclusive", () => {
  // Bands read off the published Redgate Lodge dashboard. An earlier version of
  // this module reused transformed_data_port.py's vehicle-age and 20k-mile
  // bands, which the report disproves: claim age is banded in DAYS, and the
  // mileage bands top out at "Over 15 K" — impossible for an odometer reading.
  it("bands claim age in days, not vehicle years", () => {
    expect(bandFor(0, CLAIM_ELAPSED_BANDS)).toBe("A: 0 - 14");
    expect(bandFor(14, CLAIM_ELAPSED_BANDS)).toBe("A: 0 - 14");
    expect(bandFor(15, CLAIM_ELAPSED_BANDS)).toBe("B: 15 - 30");
    expect(bandFor(270, CLAIM_ELAPSED_BANDS)).toBe("J: 241 - 270");
    expect(bandFor(271, CLAIM_ELAPSED_BANDS)).toBe("K: Over 270 Days");
  });

  it("keeps every boundary day on the side the labels say", () => {
    const boundaries: [number, string][] = [
      [30, "B: 15 - 30"], [31, "C: 31 - 60"],
      [60, "C: 31 - 60"], [61, "D: 61 - 90"],
      [90, "D: 61 - 90"], [91, "E: 91 - 120"],
      [120, "E: 91 - 120"], [121, "F: 121 - 150"],
      [150, "F: 121 - 150"], [151, "G: 151 - 180"],
      [180, "G: 151 - 180"], [181, "H: 181 - 210"],
      [210, "H: 181 - 210"], [211, "I: 211 - 240"],
      [240, "I: 211 - 240"], [241, "J: 241 - 270"],
    ];
    for (const [days, label] of boundaries) {
      expect(bandFor(days, CLAIM_ELAPSED_BANDS)).toBe(label);
    }
  });

  it("bands claim mileage as miles since sale, 0-500 up to Over 15 K", () => {
    expect(bandFor(0, CLAIM_MILEAGE_BANDS)).toBe("A: 0 - 500");
    expect(bandFor(499, CLAIM_MILEAGE_BANDS)).toBe("A: 0 - 500");
    // The labels overlap at the boundary ("A: 0 - 500", "B: 500 - 1000"), so
    // the platform's lower-inclusive convention decides: 500 is in B.
    expect(bandFor(500, CLAIM_MILEAGE_BANDS)).toBe("B: 500 - 1000");
    expect(bandFor(2500, CLAIM_MILEAGE_BANDS)).toBe("D: 2500 - 5000");
    expect(bandFor(9999, CLAIM_MILEAGE_BANDS)).toBe("E: 5 K - 10 K");
    expect(bandFor(15000, CLAIM_MILEAGE_BANDS)).toBe("G: Over 15 K");
  });

  it("has the eleven age bands and seven mileage bands the report prints", () => {
    expect(CLAIM_ELAPSED_BANDS).toHaveLength(11);
    expect(CLAIM_MILEAGE_BANDS).toHaveLength(7);
  });

  it("routes null and negative values to Unknown, NOT to the lowest band", () => {
    // Dropping them would make these sections' totals disagree with each other;
    // absorbing them into "A: 0 - 14" or "A: 0 - 500" would misstate the best
    // band on a page used to judge a dealer.
    expect(bandFor(null, CLAIM_MILEAGE_BANDS)).toBe(UNKNOWN_BAND);
    expect(bandFor(-1, CLAIM_MILEAGE_BANDS)).toBe(UNKNOWN_BAND);
    expect(bandFor(-2147483648, CLAIM_MILEAGE_BANDS)).toBe(UNKNOWN_BAND);
    expect(bandFor(-5, CLAIM_ELAPSED_BANDS)).toBe(UNKNOWN_BAND);
  });

  it("routes non-finite values to Unknown", () => {
    expect(bandFor(NaN, CLAIM_MILEAGE_BANDS)).toBe(UNKNOWN_BAND);
    expect(bandFor(Infinity, CLAIM_MILEAGE_BANDS)).toBe(UNKNOWN_BAND);
  });
});

describe("bandOrder", () => {
  it("lists the report's bands in order, Unknown last", () => {
    expect(bandOrder(CLAIM_MILEAGE_BANDS)).toEqual([
      "A: 0 - 500",
      "B: 500 - 1000",
      "C: 1000 - 2500",
      "D: 2500 - 5000",
      "E: 5 K - 10 K",
      "F: 10 K - 15 K",
      "G: Over 15 K",
      UNKNOWN_BAND,
    ]);
    expect(bandOrder(CLAIM_ELAPSED_BANDS).at(-1)).toBe(UNKNOWN_BAND);
  });

  it("takes order from the table, not from collating the labels", () => {
    // The report's own labels carry "A: ".."K: " prefixes, so collating them
    // happens to give the right order and a sort-based implementation would
    // look correct today. That is a property of the prefixes, not of the
    // ordering logic. Strip them — as any relabelling would — and collation
    // immediately puts "10 K - 15 K" before "5 K - 10 K".
    const unprefixed = CLAIM_MILEAGE_BANDS.map((b) => ({
      ...b,
      label: b.label.replace(/^[A-Z]: /, ""),
    }));
    const order = bandOrder(unprefixed);
    expect(order[4]).toBe("5 K - 10 K");
    expect(order[5]).toBe("10 K - 15 K");
    expect([...order].sort((a, b) => a.localeCompare(b, "en-GB"))).not.toEqual(order);
  });
});

describe("the SQL band CASE agrees with the TypeScript band table", () => {
  // The warehouse bands the rows and the browser orders and re-rolls them up.
  // If the two ever disagreed about where a boundary sits, the page would show
  // bands that quietly contained the wrong claims — with no error anywhere. So
  // the CASE is generated from the same table `bandFor` reads, and this asserts
  // the generation rather than trusting it.
  it("emits one WHEN per bounded band, in table order, with every bound and label bound", () => {
    const { sql, params } = buildBandCase("m", CLAIM_MILEAGE_BANDS, "mi");

    const bounded = CLAIM_MILEAGE_BANDS.filter((b) => b.upperExclusive !== null);
    expect(sql.match(/WHEN m < :/g)).toHaveLength(bounded.length);

    for (const band of bounded) {
      expect(params).toContainEqual({
        name: expect.stringMatching(/^mi_b\d+$/),
        value: band.upperExclusive,
        type: "DOUBLE",
      });
    }
    // Every label reaches SQL as a bound parameter, never inlined as text.
    for (const band of CLAIM_MILEAGE_BANDS) {
      expect(params.some((p) => p.value === band.label && p.type === "STRING")).toBe(true);
    }
  });

  it("interpolates no literal threshold or label into the SQL text", () => {
    const { sql } = buildBandCase("m", CLAIM_MILEAGE_BANDS, "mi");
    for (const band of CLAIM_MILEAGE_BANDS) {
      if (band.upperExclusive !== null) expect(sql).not.toContain(String(band.upperExclusive));
      expect(sql).not.toContain(band.label);
    }
  });

  it("guards null and negative before any threshold comparison", () => {
    // Order matters: SQL CASE takes the first matching WHEN, so the Unknown
    // guard has to precede the band tests or a negative value would match
    // `< 20000` and land in the lowest band.
    const { sql } = buildBandCase("m", CLAIM_MILEAGE_BANDS, "mi");
    expect(sql.indexOf("IS NULL")).toBeLessThan(sql.indexOf("WHEN m < :"));
    expect(sql).toContain("m < 0");
  });

  it("bands the elapsed table the same way", () => {
    const { sql, params } = buildBandCase("e", CLAIM_ELAPSED_BANDS, "el");
    expect(sql.match(/WHEN e < :/g)).toHaveLength(10);
    expect(params.some((p) => p.value === 15 && p.type === "DOUBLE")).toBe(true);
    expect(params.some((p) => p.value === 271 && p.type === "DOUBLE")).toBe(true);
    expect(params.some((p) => p.value === "K: Over 270 Days")).toBe(true);
  });
});

describe("addClaimBases / sumClaimBases / rollUpClaims", () => {
  it("sums every base field", () => {
    const a = bases({ claimCount: 1, claimValue: 100, partsCost: 10, repairTime: 2 });
    const summed = addClaimBases(a, a);
    expect(summed.claimCount).toBe(2);
    expect(summed.claimValue).toBe(200);
    expect(summed.partsCost).toBe(20);
    expect(summed.repairTime).toBe(4);
  });

  it("sums an empty list to zero rather than throwing", () => {
    expect(sumClaimBases([])).toEqual(ZERO_CLAIM_BASES);
  });

  it("groups and sums, preserving insertion order", () => {
    const rows = [
      { band: "0k - 20k", ...bases({ claimCount: 1, claimValue: 50 }) },
      { band: "20k - 40k", ...bases({ claimCount: 2, claimValue: 80 }) },
      { band: "0k - 20k", ...bases({ claimCount: 3, claimValue: 70 }) },
    ];
    const out = rollUpClaims(rows, (r) => r.band, (r) => r);
    expect(out.map((o) => o.key)).toEqual(["0k - 20k", "20k - 40k"]);
    expect(out[0].bases.claimCount).toBe(4);
    expect(out[0].bases.claimValue).toBe(120);
  });
});

describe("sharePct", () => {
  it("computes a row's share of its group", () => {
    expect(sharePct(3, 12)).toBe(25);
  });

  it("is null, not 0, for an empty group", () => {
    expect(sharePct(0, 0)).toBeNull();
  });

  it("is a genuine 0 for a real zero over a real total", () => {
    expect(sharePct(0, 12)).toBe(0);
  });
});

describe("the frontend copy of this module", () => {
  it("is byte-identical to the API copy", async () => {
    // Same convention and same reasoning as dealerMeasures.ts: the frontend
    // needs this arithmetic to re-roll-up when the year filter changes, and a
    // silent divergence would make the page disagree with these tests while
    // looking fine. Paths resolve from the vitest cwd rather than
    // import.meta.url — this package is CommonJS.
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const [api, web] = await Promise.all([
      readFile(resolve(process.cwd(), "src/lib/claimMeasures.ts"), "utf-8"),
      readFile(resolve(process.cwd(), "../src/lib/claimMeasures.ts"), "utf-8"),
    ]);
    expect(web).toBe(api);
  });
});
