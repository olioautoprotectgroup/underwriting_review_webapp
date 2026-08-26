import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getClientPrincipal, isAuthorizedStaff } from "../lib/auth";
import { resolveTargetStatus, validateCaseEventInput } from "../lib/caseRules";
import { fetchCaseEvents, fetchCaseWithCurrentState, insertCaseEvent } from "../lib/caseRepository";
import { caseRuleErrorResponse } from "./cases";
import type { CaseEventInput, CaseWithCurrentState } from "../lib/types";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

export async function getCaseDetail(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const caseId = request.params.id;
  if (!caseId) return { status: 400, jsonBody: { error: "caseId is required" } };

  const current = await fetchCaseWithCurrentState(caseId);
  if (!current) return { status: 404, jsonBody: { error: `No case with id "${caseId}"` } };
  const events = await fetchCaseEvents(caseId);

  return { jsonBody: { case: current, events } };
}

export async function createCaseEvent(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const caseId = request.params.id;
  if (!caseId) return { status: 400, jsonBody: { error: "caseId is required" } };
  const actor = getClientPrincipal(request)?.userDetails as string;

  const input = (await request.json()) as CaseEventInput;

  try {
    const current = await fetchCaseWithCurrentState(caseId);
    if (!current) return { status: 404, jsonBody: { error: `No case with id "${caseId}"` } };

    validateCaseEventInput(input, current.status);
    const targetStatus = resolveTargetStatus(input, current.status);
    const event = await insertCaseEvent(caseId, input, actor, current, targetStatus);

    const result: CaseWithCurrentState = {
      ...current,
      latestEventId: event.eventId,
      latestEventType: event.eventType,
      status: event.status,
      priority: event.priority,
      assignedTo: event.assignedTo,
      dueDate: event.dueDate,
      latestNote: event.note,
      lastUpdatedBy: event.actor,
      lastUpdatedAt: event.eventAt,
    };
    return { jsonBody: result };
  } catch (err) {
    context.error("Failed to record case event", err);
    return caseRuleErrorResponse(err);
  }
}

app.http("case-detail-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "cases/{id}",
  handler: getCaseDetail,
});

app.http("case-events-create", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "cases/{id}/events",
  handler: createCaseEvent,
});
