import type { CaseEventInput, CaseStatus, CaseWithCurrentState, ElrPosition } from "./types";

/**
 * Re-implementation, in TypeScript, of the business rules that live in
 * underwriting_reviews/notebooks/case_manager.py. Kept as pure functions
 * taking already-fetched rows as input — no Databricks call happens in
 * here — so they're unit-testable without a live warehouse connection, and
 * so the actual SQL-calling code in databricks.ts stays a thin wrapper
 * around this tested logic.
 */

export class CaseRuleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CaseRuleError";
  }
}

export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ["IN_PROGRESS", "ON_HOLD", "CLOSED"],
  IN_PROGRESS: ["OPEN", "ON_HOLD", "CLOSED"],
  ON_HOLD: ["OPEN", "IN_PROGRESS", "CLOSED"],
  CLOSED: ["OPEN"],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * OPEN precondition: the dealer's *live* current position (uwr_warranty_elr_current)
 * must be Amber or Red, and there must be no existing non-CLOSED case for
 * the same dealer+product+contractYear. Both rows must be fetched live,
 * immediately before this check — trusting a periodically refreshed
 * snapshot here would be a real correctness bug (a case could be wrongly
 * blocked or wrongly allowed once the dealer's real position has moved on).
 */
export function checkOpenPrecondition(
  elrPosition: ElrPosition | undefined,
  activeCasesForCohort: CaseWithCurrentState[],
): void {
  if (!elrPosition) {
    throw new CaseRuleError(404, "No current ELR position found for this dealer/product/contract year");
  }
  if (elrPosition.ragStatus !== "Amber" && elrPosition.ragStatus !== "Red") {
    throw new CaseRuleError(
      409,
      `Cannot open a case: current RAG status is ${elrPosition.ragStatus}, not Amber or Red`,
    );
  }
  if (activeCasesForCohort.length > 0) {
    throw new CaseRuleError(
      409,
      "An active case already exists for this dealer, product and contract year",
    );
  }
}

/**
 * Validates a case-event input against the case's current live status.
 * Throws CaseRuleError (400/409) on any violation; returns normally if the
 * input is valid to apply.
 */
export function validateCaseEventInput(input: CaseEventInput, currentStatus: CaseStatus): void {
  switch (input.eventType) {
    case "ADD_NOTE":
      if (!input.note?.trim()) {
        throw new CaseRuleError(400, "note is required for an ADD_NOTE event");
      }
      return;
    case "ASSIGN":
      if (!input.assignedTo?.trim()) {
        throw new CaseRuleError(400, "assignedTo is required for an ASSIGN event");
      }
      return;
    case "CHANGE_STATUS": {
      if (!input.status) {
        throw new CaseRuleError(400, "status is required for a CHANGE_STATUS event");
      }
      if (input.status === "CLOSED" || (currentStatus === "CLOSED" && input.status === "OPEN")) {
        throw new CaseRuleError(400, "use the CLOSE/REOPEN event type for this transition, not CHANGE_STATUS");
      }
      if (!canTransition(currentStatus, input.status)) {
        throw new CaseRuleError(409, `Cannot transition from ${currentStatus} to ${input.status}`);
      }
      return;
    }
    case "CLOSE":
      if (!canTransition(currentStatus, "CLOSED")) {
        throw new CaseRuleError(409, `Cannot close a case from status ${currentStatus}`);
      }
      return;
    case "REOPEN":
      if (currentStatus !== "CLOSED") {
        throw new CaseRuleError(409, "REOPEN is only valid for a CLOSED case");
      }
      return;
    case "OPEN":
      throw new CaseRuleError(400, "OPEN is not a valid event type for an existing case");
  }
}

/** Resolves the target status for a validated event input, given the case's current status. */
export function resolveTargetStatus(input: CaseEventInput, currentStatus: CaseStatus): CaseStatus {
  switch (input.eventType) {
    case "CLOSE":
      return "CLOSED";
    case "REOPEN":
      return "OPEN";
    case "CHANGE_STATUS":
      return input.status as CaseStatus;
    default:
      return currentStatus;
  }
}
