import { describe, it, expect } from "vitest";
import {
  CaseRuleError,
  TRANSITIONS,
  canTransition,
  checkOpenPrecondition,
  resolveTargetStatus,
  validateCaseEventInput,
} from "../src/lib/caseRules";
import type { CaseStatus, CaseWithCurrentState, ElrPosition } from "../src/lib/types";

const ALL_STATUSES: CaseStatus[] = ["OPEN", "IN_PROGRESS", "ON_HOLD", "CLOSED"];

function elrPosition(overrides: Partial<ElrPosition> = {}): ElrPosition {
  return {
    dealerCode: "D1",
    product: "WARRANTY",
    contractYear: 2024,
    financialPeriodEndDate: "2026-01-01",
    periodClaimValue: 0,
    periodTrueUpDiff: 0,
    periodEarnedPremium: 0,
    itdClaimValue: 0,
    itdEarnedPremium: 0,
    earnedLossRatio: 0.9,
    ragStatus: "Red",
    dealerName: "Dealer One",
    dealerFinancialGroupName: null,
    snapshotGeneratedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function caseRow(overrides: Partial<CaseWithCurrentState> = {}): CaseWithCurrentState {
  return {
    caseId: "c1",
    dealerCode: "D1",
    product: "WARRANTY",
    contractYear: 2024,
    title: "Test case",
    description: null,
    sourceRagStatus: "Red",
    sourceEarnedLossRatio: 0.9,
    openedBy: "actor@autoprotectgroup.co.uk",
    openedAt: "2026-01-01T00:00:00Z",
    latestEventId: "e1",
    latestEventType: "OPEN",
    status: "OPEN",
    priority: "MEDIUM",
    assignedTo: null,
    dueDate: null,
    latestNote: null,
    lastUpdatedBy: "actor@autoprotectgroup.co.uk",
    lastUpdatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TRANSITIONS / canTransition", () => {
  it("matches the exact transition table from case_manager.py", () => {
    expect(TRANSITIONS.OPEN).toEqual(["IN_PROGRESS", "ON_HOLD", "CLOSED"]);
    expect(TRANSITIONS.IN_PROGRESS).toEqual(["OPEN", "ON_HOLD", "CLOSED"]);
    expect(TRANSITIONS.ON_HOLD).toEqual(["OPEN", "IN_PROGRESS", "CLOSED"]);
    expect(TRANSITIONS.CLOSED).toEqual(["OPEN"]);
  });

  it("allows every listed transition and rejects every unlisted one, for every status", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });
});

describe("checkOpenPrecondition", () => {
  it("throws 404 when there is no current ELR position", () => {
    expect(() => checkOpenPrecondition(undefined, [])).toThrow(CaseRuleError);
    try {
      checkOpenPrecondition(undefined, []);
    } catch (err) {
      expect((err as CaseRuleError).status).toBe(404);
    }
  });

  it("rejects a Green dealer", () => {
    expect(() => checkOpenPrecondition(elrPosition({ ragStatus: "Green" }), [])).toThrow(CaseRuleError);
  });

  it("rejects a 'No status' dealer", () => {
    expect(() => checkOpenPrecondition(elrPosition({ ragStatus: "No status" }), [])).toThrow(CaseRuleError);
  });

  it("accepts an Amber dealer with no active case", () => {
    expect(() => checkOpenPrecondition(elrPosition({ ragStatus: "Amber" }), [])).not.toThrow();
  });

  it("accepts a Red dealer with no active case", () => {
    expect(() => checkOpenPrecondition(elrPosition({ ragStatus: "Red" }), [])).not.toThrow();
  });

  it("rejects when an active (non-CLOSED) case already exists", () => {
    expect(() => checkOpenPrecondition(elrPosition(), [caseRow({ status: "IN_PROGRESS" })])).toThrow(
      CaseRuleError,
    );
  });

  it("allows opening when the only existing case for the cohort is CLOSED", () => {
    // fetchActiveCasesForCohort filters status != 'CLOSED' at the SQL level,
    // so a CLOSED case never reaches this function as an "active" case —
    // simulate that contract by passing an empty array.
    expect(() => checkOpenPrecondition(elrPosition(), [])).not.toThrow();
  });
});

describe("validateCaseEventInput", () => {
  it("requires a note for ADD_NOTE", () => {
    expect(() => validateCaseEventInput({ eventType: "ADD_NOTE" }, "OPEN")).toThrow(CaseRuleError);
    expect(() => validateCaseEventInput({ eventType: "ADD_NOTE", note: "  " }, "OPEN")).toThrow(CaseRuleError);
    expect(() => validateCaseEventInput({ eventType: "ADD_NOTE", note: "ok" }, "OPEN")).not.toThrow();
  });

  it("requires assignedTo for ASSIGN", () => {
    expect(() => validateCaseEventInput({ eventType: "ASSIGN" }, "OPEN")).toThrow(CaseRuleError);
    expect(() =>
      validateCaseEventInput({ eventType: "ASSIGN", assignedTo: "a@autoprotectgroup.co.uk" }, "OPEN"),
    ).not.toThrow();
  });

  it("requires status for CHANGE_STATUS and validates the transition", () => {
    expect(() => validateCaseEventInput({ eventType: "CHANGE_STATUS" }, "OPEN")).toThrow(CaseRuleError);
    expect(() =>
      validateCaseEventInput({ eventType: "CHANGE_STATUS", status: "IN_PROGRESS" }, "OPEN"),
    ).not.toThrow();
    // OPEN -> OPEN isn't a listed transition
    expect(() => validateCaseEventInput({ eventType: "CHANGE_STATUS", status: "OPEN" }, "OPEN")).toThrow(
      CaseRuleError,
    );
  });

  it("rejects CHANGE_STATUS targeting CLOSED (must use CLOSE instead)", () => {
    expect(() => validateCaseEventInput({ eventType: "CHANGE_STATUS", status: "CLOSED" }, "OPEN")).toThrow(
      CaseRuleError,
    );
  });

  it("rejects CHANGE_STATUS from CLOSED to OPEN (must use REOPEN instead)", () => {
    expect(() => validateCaseEventInput({ eventType: "CHANGE_STATUS", status: "OPEN" }, "CLOSED")).toThrow(
      CaseRuleError,
    );
  });

  it("CLOSE succeeds from any non-CLOSED status", () => {
    for (const from of ["OPEN", "IN_PROGRESS", "ON_HOLD"] as CaseStatus[]) {
      expect(() => validateCaseEventInput({ eventType: "CLOSE" }, from)).not.toThrow();
    }
  });

  it("CLOSE fails from CLOSED (already closed)", () => {
    expect(() => validateCaseEventInput({ eventType: "CLOSE" }, "CLOSED")).toThrow(CaseRuleError);
  });

  it("REOPEN only succeeds from CLOSED", () => {
    expect(() => validateCaseEventInput({ eventType: "REOPEN" }, "CLOSED")).not.toThrow();
    for (const from of ["OPEN", "IN_PROGRESS", "ON_HOLD"] as CaseStatus[]) {
      expect(() => validateCaseEventInput({ eventType: "REOPEN" }, from)).toThrow(CaseRuleError);
    }
  });

  it("rejects OPEN as an event type on an existing case", () => {
    expect(() => validateCaseEventInput({ eventType: "OPEN" }, "OPEN")).toThrow(CaseRuleError);
  });
});

describe("resolveTargetStatus", () => {
  it("resolves CLOSE to CLOSED and REOPEN to OPEN regardless of input.status", () => {
    expect(resolveTargetStatus({ eventType: "CLOSE" }, "IN_PROGRESS")).toBe("CLOSED");
    expect(resolveTargetStatus({ eventType: "REOPEN" }, "CLOSED")).toBe("OPEN");
  });

  it("resolves CHANGE_STATUS to the input's status", () => {
    expect(resolveTargetStatus({ eventType: "CHANGE_STATUS", status: "ON_HOLD" }, "OPEN")).toBe("ON_HOLD");
  });

  it("resolves ADD_NOTE/ASSIGN to the current status unchanged", () => {
    expect(resolveTargetStatus({ eventType: "ADD_NOTE", note: "x" }, "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(resolveTargetStatus({ eventType: "ASSIGN", assignedTo: "a@x.com" }, "ON_HOLD")).toBe("ON_HOLD");
  });
});
