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

describe("splitClaimValue — the Claims Value Split", () => {
  // Parts 600 + Labour 300 + VAT (120 + 60 = 180) = 1080.
  const b = bases({
    partsCost: 600,
    labourCost: 300,
    partsTax: 120,
    labourTax: 60,
    repairTime: 4,
  });

  it("sums VAT from both tax columns, not just one", () => {
    // The confirmed definition is `parts_tax + labour_tax`. Taking only one
    // would understate VAT and make the three parts fail to sum to the whole.
    expect(splitClaimValue(b).vat).toBe(180);
  });

  it("totals to the sum of the three components", () => {
    expect(splitClaimValue(b).total).toBe(1080);
  });

  it("splits to percentages that add to 100", () => {
    const s = splitClaimValue(b);
    expect(s.partsPct).toBeCloseTo(55.5556, 4);
    expect(s.labourPct).toBeCloseTo(27.7778, 4);
    expect(s.vatPct).toBeCloseTo(16.6667, 4);
    expect((s.partsPct ?? 0) + (s.labourPct ?? 0) + (s.vatPct ?? 0)).toBeCloseTo(100, 6);
  });

  it("computes Labour per Hour from labour excluding tax, not labour plus VAT", () => {
    // 300 / 4 = 75. Using 360 (labour + its tax) would give 90 and silently
    // overstate the effective rate by the VAT rate.
    expect(splitClaimValue(b).labourPerHour).toBe(75);
  });

  it("reports Labour per Hour as null, not zero or Infinity, when repair time is zero", () => {
    const s = splitClaimValue(bases({ labourCost: 300, repairTime: 0 }));
    expect(s.labourPerHour).toBeNull();
  });

  it("reports every split percentage as null when there is no claim cost at all", () => {
    // A dealer with no claims has no split. Rendering 0% would assert the
    // claims exist and cost nothing — the same null-vs-zero rule as the
    // policy-side measures.
    const s = splitClaimValue(ZERO_CLAIM_BASES);
    expect(s.total).toBe(0);
    expect(s.partsPct).toBeNull();
    expect(s.labourPct).toBeNull();
    expect(s.vatPct).toBeNull();
    expect(s.labourPerHour).toBeNull();
  });

  it("keeps a genuine zero component as 0%, not blank, when other components exist", () => {
    // No parts on any claim is a real finding (labour-only repairs), and
    // distinct from "no claims".
    const s = splitClaimValue(bases({ labourCost: 100, labourTax: 20 }));
    expect(s.partsPct).toBe(0);
    expect(s.labourPct).toBeCloseTo(83.3333, 4);
  });
});

describe("bandFor — boundaries are lower-inclusive, upper-exclusive", () => {
  // Matching transformed_data_port.py:294-321 exactly. Off-by-one here would
  // put a cohort in the wrong band and disagree with the live report.
  it("puts exactly 36 months in the second age band, not the first", () => {
    expect(bandFor(35.9, CLAIM_ELAPSED_BANDS)).toBe("A: 0 - 3 Years");
    expect(bandFor(36, CLAIM_ELAPSED_BANDS)).toBe("B: 3 - 5 Years");
  });

  it("puts exactly 20000 miles in the second mileage band, not the first", () => {
    expect(bandFor(19999, CLAIM_MILEAGE_BANDS)).toBe("0k - 20k");
    expect(bandFor(20000, CLAIM_MILEAGE_BANDS)).toBe("20k - 40k");
  });

  it("puts zero in the lowest band", () => {
    expect(bandFor(0, CLAIM_MILEAGE_BANDS)).toBe("0k - 20k");
    expect(bandFor(0, CLAIM_ELAPSED_BANDS)).toBe("A: 0 - 3 Years");
  });

  it("falls through to the catch-all band above the last threshold", () => {
    expect(bandFor(144, CLAIM_ELAPSED_BANDS)).toBe("F: Over 12 Years");
    expect(bandFor(100000, CLAIM_MILEAGE_BANDS)).toBe("Over 100k");
  });

  it("routes null and negative values to Unknown, NOT to the lowest band", () => {
    // The deliberate departure from transformed_data_port.py, which dumps
    // negative/INT_MIN garbage into the lowest band to match the live model.
    // For claims the glossary requires bound-filtering, and hiding bad data in
    // "0k - 20k" would misstate the best band on a page used to judge a dealer.
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
  it("lists the mileage bands in numeric order, Unknown last", () => {
    const order = bandOrder(CLAIM_MILEAGE_BANDS);
    expect(order).toEqual([
      "0k - 20k",
      "20k - 40k",
      "40k - 60k",
      "60k - 80k",
      "80k - 100k",
      "Over 100k",
      UNKNOWN_BAND,
    ]);
  });

  it("takes order from the table, not from collating the labels", () => {
    // en-GB collation happens to order today's real labels correctly, so
    // sorting them would look fine. That is a coincidence of these particular
    // strings. This band set proves the difference: "10k - 20k" collates before
    // "5k - 10k", so a sort-based implementation would show the bands
    // out of sequence with nothing to signal it.
    const tricky = [
      { upperExclusive: 5000, label: "0k - 5k" },
      { upperExclusive: 10000, label: "5k - 10k" },
      { upperExclusive: null, label: "10k - 20k" },
    ];
    const order = bandOrder(tricky);
    expect(order).toEqual(["0k - 5k", "5k - 10k", "10k - 20k", UNKNOWN_BAND]);
    expect([...order].sort((a, b) => a.localeCompare(b, "en-GB"))).not.toEqual(order);
  });

  it("puts Unknown last, after the real bands", () => {
    expect(bandOrder(CLAIM_ELAPSED_BANDS).at(-1)).toBe(UNKNOWN_BAND);
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
    expect(sql.match(/WHEN e < :/g)).toHaveLength(5);
    expect(params.some((p) => p.value === 36 && p.type === "DOUBLE")).toBe(true);
    expect(params.some((p) => p.value === "F: Over 12 Years")).toBe(true);
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
