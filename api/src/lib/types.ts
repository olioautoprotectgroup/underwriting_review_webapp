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

export interface DashboardData {
  dealers: Dealer[];
  elrCurrent: ElrPosition[];
  elrHistory: ElrPosition[];
  claimMix: ClaimMixEntry[];
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
