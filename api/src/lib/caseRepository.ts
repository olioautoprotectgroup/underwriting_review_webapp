import { randomUUID } from "node:crypto";
import { executeStatement, type SqlParam } from "./databricks";
import type {
  Case,
  CaseEvent,
  CaseEventInput,
  CaseStatus,
  CaseWithCurrentState,
  ClaimMixEntry,
  ElrPosition,
  OpenCaseInput,
  RagStatus,
} from "./types";

/**
 * All live Databricks reads/writes for cases, composed from executeStatement.
 * Column names match the real Delta tables exactly (see
 * underwriting_reviews/notebooks/case_lifecycle_setup.py and
 * warranty_elr_rag_snapshot.py) — this file is the one place that
 * translates between those snake_case SQL rows and this app's camelCase
 * TypeScript types.
 */

function num(v: string | null): number {
  return v === null ? 0 : Number(v);
}
function numOrNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function toElrPosition(row: Record<string, string | null>): ElrPosition {
  return {
    dealerCode: row.dealer_code as string,
    product: row.product as string,
    contractYear: num(row.contract_year),
    financialPeriodEndDate: row.financial_period_end_date as string,
    periodClaimValue: num(row.period_claim_value),
    periodTrueUpDiff: num(row.period_true_up_diff),
    periodEarnedPremium: num(row.period_earned_premium),
    itdClaimValue: num(row.itd_claim_value),
    itdEarnedPremium: num(row.itd_earned_premium),
    earnedLossRatio: numOrNull(row.earned_loss_ratio),
    ragStatus: row.rag_status as RagStatus,
    dealerName: row.dealer_name,
    dealerFinancialGroupName: row.dealer_financial_group_name,
    snapshotGeneratedAt: row.snapshot_generated_at as string,
  };
}

function toCaseWithCurrentState(row: Record<string, string | null>): CaseWithCurrentState {
  return {
    caseId: row.case_id as string,
    dealerCode: row.dealer_code as string,
    product: row.product as string,
    contractYear: num(row.contract_year),
    title: row.title as string,
    description: row.description,
    sourceRagStatus: row.source_rag_status as RagStatus,
    sourceEarnedLossRatio: numOrNull(row.source_earned_loss_ratio),
    openedBy: row.opened_by as string,
    openedAt: row.opened_at as string,
    latestEventId: row.latest_event_id as string,
    latestEventType: row.latest_event_type as CaseWithCurrentState["latestEventType"],
    status: row.status as CaseStatus,
    priority: row.priority as CaseWithCurrentState["priority"],
    assignedTo: row.assigned_to,
    dueDate: row.due_date,
    latestNote: row.latest_note,
    lastUpdatedBy: row.last_updated_by as string,
    lastUpdatedAt: row.last_updated_at as string,
  };
}

function toCaseEvent(row: Record<string, string | null>): CaseEvent {
  return {
    eventId: row.event_id as string,
    caseId: row.case_id as string,
    eventType: row.event_type as CaseEvent["eventType"],
    previousEventId: row.previous_event_id,
    fromStatus: row.from_status as CaseStatus | null,
    status: row.status as CaseStatus,
    priority: row.priority as CaseEvent["priority"],
    assignedTo: row.assigned_to,
    dueDate: row.due_date,
    note: row.note,
    actor: row.actor as string,
    eventAt: row.event_at as string,
  };
}

export async function fetchElrPosition(
  dealerCode: string,
  product: string,
  contractYear: number,
): Promise<ElrPosition | undefined> {
  const rows = await executeStatement(
    `SELECT * FROM uwr_warranty_elr_current
     WHERE dealer_code = :dealer_code AND product = :product AND contract_year = :contract_year`,
    [
      { name: "dealer_code", value: dealerCode, type: "STRING" },
      { name: "product", value: product, type: "STRING" },
      { name: "contract_year", value: contractYear, type: "INT" },
    ],
  );
  return rows[0] ? toElrPosition(rows[0]) : undefined;
}

export async function fetchElrPositionsForDealer(dealerCode: string): Promise<ElrPosition[]> {
  const rows = await executeStatement(
    `SELECT * FROM uwr_warranty_elr_current WHERE dealer_code = :dealer_code`,
    [{ name: "dealer_code", value: dealerCode, type: "STRING" }],
  );
  return rows.map(toElrPosition);
}

/**
 * One dealer's full ELR history (every period, not just the latest), read
 * live rather than from the periodic dashboard.json snapshot.
 *
 * This is deliberately NOT in the snapshot. The history table holds one row
 * per dealer x product x contract_year x period — roughly 386k rows across
 * all dealers, ~187 MB as JSON, which is far past what the snapshot path can
 * carry (Azure SWA caps an /api request at 30 MB and each request at 45s;
 * GitHub's Contents API refuses commits well below that size). Every one of
 * those rows was previously shipped so that a single dealer's ELR trend
 * chart could be drawn. Reading per-dealer here costs nothing extra
 * architecturally: getDealer already makes a live Databricks call for this
 * dealer's cases, so there is no new credential, dependency, or latency
 * class — see README.md's "Two data paths".
 *
 * Ordered in SQL so the trend chart plots chronologically regardless of the
 * warehouse's row ordering.
 */
export async function fetchElrHistoryForDealer(dealerCode: string): Promise<ElrPosition[]> {
  const rows = await executeStatement(
    `SELECT * FROM uwr_warranty_elr_snapshot
     WHERE dealer_code = :dealer_code
     ORDER BY financial_period_end_date`,
    [{ name: "dealer_code", value: dealerCode, type: "STRING" }],
  );
  return rows.map(toElrPosition);
}

/**
 * This platform reports on Warranty only. Mirrors `PRODUCT_SCOPE` in
 * underwriting_reviews' notebooks/_config.py — kept as a named constant so
 * the two are easy to diff by eye if the scope ever widens.
 */
const PRODUCT_SCOPE = "WARRANTY";

/**
 * One dealer's claim mix by loss type, read live rather than from the
 * periodic snapshot.
 *
 * Replicates webapp_dashboard_push.py's claim_mix_df aggregation exactly,
 * narrowed to a single dealer. Moved off the snapshot because it is
 * per-dealer data (getDealer was the only consumer, and it filtered to one
 * dealer anyway) and it was ~19k rows of a 14.6 MB file committed weekly —
 * see README.md's "Two data paths".
 *
 * The product filter is REQUIRED and not optional cosmetics: unlike the ELR
 * tables, vw_fact_claim spans every product, so dropping it would silently
 * inflate both figures for every dealer.
 */
export async function fetchClaimMixForDealer(dealerCode: string): Promise<ClaimMixEntry[]> {
  const rows = await executeStatement(
    `SELECT loss_type,
            COUNT(DISTINCT claim_id) AS claim_count,
            SUM(paid_amount_gbp)     AS paid_gbp
     FROM vw_fact_claim
     WHERE product = :product AND dealer_code = :dealer_code
     GROUP BY loss_type`,
    [
      { name: "product", value: PRODUCT_SCOPE, type: "STRING" },
      { name: "dealer_code", value: dealerCode, type: "STRING" },
    ],
  );
  return rows.map((row) => ({
    dealerCode,
    lossType: row.loss_type as string,
    claimCount: num(row.claim_count),
    paidGbp: num(row.paid_gbp),
  }));
}

export async function fetchActiveCasesForCohort(
  dealerCode: string,
  product: string,
  contractYear: number,
): Promise<CaseWithCurrentState[]> {
  const rows = await executeStatement(
    `SELECT * FROM uwr_case_current
     WHERE dealer_code = :dealer_code AND product = :product AND contract_year = :contract_year
       AND status != 'CLOSED'`,
    [
      { name: "dealer_code", value: dealerCode, type: "STRING" },
      { name: "product", value: product, type: "STRING" },
      { name: "contract_year", value: contractYear, type: "INT" },
    ],
  );
  return rows.map(toCaseWithCurrentState);
}

export async function fetchCasesForDealer(dealerCode: string): Promise<CaseWithCurrentState[]> {
  const rows = await executeStatement(`SELECT * FROM uwr_case_current WHERE dealer_code = :dealer_code`, [
    { name: "dealer_code", value: dealerCode, type: "STRING" },
  ]);
  return rows.map(toCaseWithCurrentState);
}

export async function fetchAllCases(): Promise<CaseWithCurrentState[]> {
  const rows = await executeStatement(`SELECT * FROM uwr_case_current`);
  return rows.map(toCaseWithCurrentState);
}

export async function fetchCaseWithCurrentState(caseId: string): Promise<CaseWithCurrentState | undefined> {
  const rows = await executeStatement(`SELECT * FROM uwr_case_current WHERE case_id = :case_id`, [
    { name: "case_id", value: caseId, type: "STRING" },
  ]);
  return rows[0] ? toCaseWithCurrentState(rows[0]) : undefined;
}

export async function fetchCaseEvents(caseId: string): Promise<CaseEvent[]> {
  const rows = await executeStatement(
    `SELECT * FROM uwr_case_event WHERE case_id = :case_id ORDER BY event_at`,
    [{ name: "case_id", value: caseId, type: "STRING" }],
  );
  return rows.map(toCaseEvent);
}

/**
 * Inserts the uwr_case header and its OPEN event. These are two separate
 * statements (no multi-table transaction on the Statement Execution API) —
 * see the frontend development plan's "OPEN's two-insert risk" note. If the
 * second insert fails, the caller should surface a "partially failed,
 * retry" error; a retry's precondition check won't false-positive the
 * orphaned header as a duplicate active case, since uwr_case_current's join
 * finds no active event for it.
 */
export async function insertCaseAndOpenEvent(
  input: OpenCaseInput,
  actor: string,
  elrPosition: ElrPosition,
): Promise<{ caseRow: Case; eventRow: CaseEvent }> {
  const caseId = randomUUID();
  const openedAt = new Date().toISOString();

  const caseParams: SqlParam[] = [
    { name: "case_id", value: caseId, type: "STRING" },
    { name: "dealer_code", value: input.dealerCode, type: "STRING" },
    { name: "product", value: input.product, type: "STRING" },
    { name: "contract_year", value: input.contractYear, type: "INT" },
    { name: "title", value: input.title, type: "STRING" },
    { name: "description", value: input.description ?? null, type: "STRING" },
    { name: "source_rag_status", value: elrPosition.ragStatus, type: "STRING" },
    { name: "source_earned_loss_ratio", value: elrPosition.earnedLossRatio, type: "DOUBLE" },
    { name: "opened_by", value: actor, type: "STRING" },
  ];
  await executeStatement(
    `INSERT INTO uwr_case
       (case_id, dealer_code, product, contract_year, title, description,
        source_rag_status, source_earned_loss_ratio, opened_by, opened_at)
     VALUES (:case_id, :dealer_code, :product, :contract_year, :title, :description,
             :source_rag_status, :source_earned_loss_ratio, :opened_by, current_timestamp())`,
    caseParams,
  );

  const eventId = randomUUID();
  const eventParams: SqlParam[] = [
    { name: "event_id", value: eventId, type: "STRING" },
    { name: "case_id", value: caseId, type: "STRING" },
    { name: "status", value: "OPEN", type: "STRING" },
    { name: "priority", value: input.priority, type: "STRING" },
    { name: "note", value: input.note ?? null, type: "STRING" },
    { name: "actor", value: actor, type: "STRING" },
  ];
  await executeStatement(
    `INSERT INTO uwr_case_event
       (event_id, case_id, event_type, previous_event_id, from_status, status, priority,
        assigned_to, due_date, note, actor, event_at)
     VALUES (:event_id, :case_id, 'OPEN', NULL, NULL, :status, :priority,
             NULL, NULL, :note, :actor, current_timestamp())`,
    eventParams,
  );

  return {
    caseRow: {
      caseId,
      dealerCode: input.dealerCode,
      product: input.product,
      contractYear: input.contractYear,
      title: input.title,
      description: input.description,
      sourceRagStatus: elrPosition.ragStatus,
      sourceEarnedLossRatio: elrPosition.earnedLossRatio,
      openedBy: actor,
      openedAt,
    },
    eventRow: {
      eventId,
      caseId,
      eventType: "OPEN",
      previousEventId: null,
      fromStatus: null,
      status: "OPEN",
      priority: input.priority,
      assignedTo: null,
      dueDate: null,
      note: input.note ?? null,
      actor,
      eventAt: openedAt,
    },
  };
}

/**
 * Appends one full-state event row, carrying forward whatever the input
 * didn't explicitly change from `current` (the case's already-fetched live
 * state) — every event row is a complete snapshot, not a delta, so a
 * consumer never needs to replay history to know e.g. the priority as of
 * any given event.
 */
export async function insertCaseEvent(
  caseId: string,
  input: CaseEventInput,
  actor: string,
  current: CaseWithCurrentState,
  targetStatus: CaseStatus,
): Promise<CaseEvent> {
  const eventId = randomUUID();
  const eventAt = new Date().toISOString();
  const priority = input.priority ?? current.priority;
  const assignedTo = input.assignedTo ?? current.assignedTo;
  const dueDate = input.dueDate ?? current.dueDate;

  await executeStatement(
    `INSERT INTO uwr_case_event
       (event_id, case_id, event_type, previous_event_id, from_status, status, priority,
        assigned_to, due_date, note, actor, event_at)
     VALUES (:event_id, :case_id, :event_type, :previous_event_id, :from_status, :status,
             :priority, :assigned_to, :due_date, :note, :actor, current_timestamp())`,
    [
      { name: "event_id", value: eventId, type: "STRING" },
      { name: "case_id", value: caseId, type: "STRING" },
      { name: "event_type", value: input.eventType, type: "STRING" },
      { name: "previous_event_id", value: current.latestEventId, type: "STRING" },
      { name: "from_status", value: current.status, type: "STRING" },
      { name: "status", value: targetStatus, type: "STRING" },
      { name: "priority", value: priority, type: "STRING" },
      { name: "assigned_to", value: assignedTo, type: "STRING" },
      { name: "due_date", value: dueDate, type: "DATE" },
      { name: "note", value: input.note ?? null, type: "STRING" },
      { name: "actor", value: actor, type: "STRING" },
    ],
  );

  return {
    eventId,
    caseId,
    eventType: input.eventType,
    previousEventId: current.latestEventId,
    fromStatus: current.status,
    status: targetStatus,
    priority,
    assignedTo,
    dueDate,
    note: input.note ?? null,
    actor,
    eventAt,
  };
}
