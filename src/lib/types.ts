// Mirrors api/src/lib/types.ts by hand — same convention as repairer_network,
// no shared/generated types package. Keep these two files in sync manually.

export type RagStatus = "Green" | "Amber" | "Red" | "No status";
export type CaseStatus = "OPEN" | "IN_PROGRESS" | "ON_HOLD" | "CLOSED";
export type CasePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CaseEventType = "OPEN" | "ADD_NOTE" | "ASSIGN" | "CHANGE_STATUS" | "CLOSE" | "REOPEN";

export interface Dealer {
  dealerCode: string;
  dealerName: string | null;
  dealerFinancialGroupName: string | null;
  fsaType: string | null;
  fsaNumber: string | null;
  isSelfAuthorised: boolean | null;
  selfAuthorisationLimit: number | null;
}

export interface ElrPosition {
  dealerCode: string;
  product: string;
  contractYear: number;
  financialPeriodEndDate: string;
  periodClaimValue: number;
  periodTrueUpDiff: number;
  periodEarnedPremium: number;
  itdClaimValue: number;
  itdEarnedPremium: number;
  earnedLossRatio: number | null;
  ragStatus: RagStatus;
  dealerName: string | null;
  dealerFinancialGroupName: string | null;
  snapshotGeneratedAt: string;
}

export interface ClaimMixEntry {
  dealerCode: string;
  lossType: string;
  claimCount: number;
  paidGbp: number;
}

/**
 * Shape of the git-committed api/data/dashboard.json snapshot. Aggregate,
 * slowly-changing data only — ELR history and claim mix are NOT here; both
 * are read live per dealer. Kept in hand-sync with api/src/lib/types.ts.
 */
export interface DashboardData {
  dealers: Dealer[];
  elrCurrent: ElrPosition[];
}

/** GET /api/dashboard response — only the columns the dashboard renders. */
export interface DashboardSummaryRow {
  dealerCode: string;
  dealerName: string | null;
  contractYear: number;
  earnedLossRatio: number | null;
  ragStatus: RagStatus;
}

export interface DashboardSummary {
  elrCurrent: DashboardSummaryRow[];
}

// uwr_case — append-only immutable header. Never writable wholesale from the UI.
export interface Case {
  caseId: string;
  dealerCode: string;
  product: string;
  contractYear: number;
  title: string;
  description: string | null;
  sourceRagStatus: RagStatus;
  sourceEarnedLossRatio: number | null;
  openedBy: string;
  openedAt: string;
}

// uwr_case_event — append-only, one row per action. Never mutated.
export interface CaseEvent {
  eventId: string;
  caseId: string;
  eventType: CaseEventType;
  previousEventId: string | null;
  fromStatus: CaseStatus | null;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo: string | null;
  dueDate: string | null;
  note: string | null;
  actor: string;
  eventAt: string;
}

// uwr_case_current — the joined view the UI actually renders.
export interface CaseWithCurrentState extends Case {
  latestEventId: string;
  latestEventType: CaseEventType;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo: string | null;
  dueDate: string | null;
  latestNote: string | null;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
}

export interface CaseDetail {
  case: CaseWithCurrentState;
  events: CaseEvent[];
}

/** POST /api/cases body. caseId/openedBy/openedAt/sourceRagStatus/
 * sourceEarnedLossRatio are always server-derived — never trust a client
 * to assert its own identity or the dealer's live RAG position. */
export type OpenCaseInput = Omit<
  Case,
  "caseId" | "openedBy" | "openedAt" | "sourceRagStatus" | "sourceEarnedLossRatio"
> & { priority: CasePriority; note?: string };

/** POST /api/cases/{id}/events body. eventId/caseId/previousEventId/
 * fromStatus/actor/eventAt are always server-derived. */
export type CaseEventInput = Pick<CaseEvent, "eventType"> &
  Partial<Pick<CaseEvent, "status" | "priority" | "assignedTo" | "dueDate" | "note">>;

// ---------------------------------------------------------------------------
// Dealer Dashboard — the web rebuild of the Power BI paginated report.
// Mirrors api/src/lib/dealerDashboard.ts by hand (same convention as the rest
// of this file). Rows carry the seven base sums only; every displayed measure
// is derived from them client-side via dealerMeasures.ts, so changing the year
// or the plotted measure never needs another warehouse round trip.
// ---------------------------------------------------------------------------

export interface DealerPositionRow {
  contractYear: number;
  underwritingCode: string | null;
  vehicleAgeBand: string | null;
  vehicleMileageBand: string | null;
  productTypeName: string | null;
  term: string | null;
  vehicleMake: string | null;
  soldPolicies: number;
  dealerNet: number;
  uwPremium: number;
  earnedPremium: number;
  claimCount: number;
  claimsValue: number;
  claimFund: number;
}

export interface DealerDevelopmentRow {
  contractYear: number;
  period: number;
  claimsValue: number;
  earnedPremium: number;
}

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

// ---------------------------------------------------------------------------
// Claim detail — sections 7-10 of the Dealer Dashboard.
// Mirrors api/src/lib/dealerClaims.ts by hand (same convention as the rest of
// this file). Claim-grained off vw_fact_claim, NOT policy-grained off
// uwr_transformed_data — a separate top-level key precisely so nothing implies
// these claim values tie to the ones in DealerDashboard. They do not; see
// claimMeasures.ts for why.
// ---------------------------------------------------------------------------

/** One row of the claim breakdown, at the union grain of sections 7, 9 and 10. */
export interface DealerClaimRow {
  contractYear: number;
  elapsedBand: string;
  mileageBand: string;
  payeeType: string;
  claimCount: number;
  claimValue: number;
  partsCost: number;
  labourCost: number;
  partsTax: number;
  labourTax: number;
  repairTime: number;
}

/** One fault narrative within a mileage band, for the section 8 drill-down. */
export interface ClaimFaultRow {
  contractYear: number;
  mileageBand: string;
  faultDescription: string;
  claimCount: number;
  claimValue: number;
}

/** One fault narrative for a contract year — the Claim Causal Part Analysis. */
export interface CausalPartRow {
  contractYear: number;
  faultDescription: string;
  claimCount: number;
  claimValue: number;
}

export interface DealerClaims {
  rows: DealerClaimRow[];
  faults: ClaimFaultRow[];
  causalParts: CausalPartRow[];
}
