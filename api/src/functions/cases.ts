import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { isAuthorizedStaff } from "../lib/auth";
import { CaseRuleError, checkOpenPrecondition } from "../lib/caseRules";
import {
  fetchActiveCasesForCohort,
  fetchAllCases,
  fetchElrPosition,
  insertCaseAndOpenEvent,
} from "../lib/caseRepository";
import { getClientPrincipal } from "../lib/auth";
import type { CaseWithCurrentState, OpenCaseInput } from "../lib/types";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

export function caseRuleErrorResponse(err: unknown): HttpResponseInit {
  if (err instanceof CaseRuleError) {
    return { status: err.status, jsonBody: { error: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, jsonBody: { error: "Failed to process case action", detail: message } };
}

export async function listCases(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const cases = await fetchAllCases();
  return { jsonBody: cases };
}

export async function createCase(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const actor = getClientPrincipal(request)?.userDetails as string;

  const input = (await request.json()) as OpenCaseInput;
  if (!input.dealerCode || !input.product || !input.contractYear || !input.title?.trim()) {
    return { status: 400, jsonBody: { error: "dealerCode, product, contractYear and title are required" } };
  }

  try {
    // Live reads, immediately before the write — see checkOpenPrecondition's
    // docstring for why a periodically refreshed snapshot can't be used here.
    const [elrPosition, activeCases] = await Promise.all([
      fetchElrPosition(input.dealerCode, input.product, input.contractYear),
      fetchActiveCasesForCohort(input.dealerCode, input.product, input.contractYear),
    ]);
    checkOpenPrecondition(elrPosition, activeCases);

    const { caseRow, eventRow } = await insertCaseAndOpenEvent(input, actor, elrPosition!);
    const result: CaseWithCurrentState = {
      ...caseRow,
      latestEventId: eventRow.eventId,
      latestEventType: eventRow.eventType,
      status: eventRow.status,
      priority: eventRow.priority,
      assignedTo: eventRow.assignedTo,
      dueDate: eventRow.dueDate,
      latestNote: eventRow.note,
      lastUpdatedBy: eventRow.actor,
      lastUpdatedAt: eventRow.eventAt,
    };
    return { status: 201, jsonBody: result };
  } catch (err) {
    context.error("Failed to open case", err);
    return caseRuleErrorResponse(err);
  }
}

app.http("cases-list", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cases",
  handler: listCases,
});

app.http("cases-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cases",
  handler: createCase,
});
