import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { commitDashboardJson, getCurrentDashboardJson } from "../lib/github";
import { isAuthorizedWriteback } from "../lib/auth";
import type { DashboardData } from "../lib/types";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to the Databricks dashboard-push job" },
};

/**
 * Writeback endpoint for the weekly webapp_dashboard_push.py Databricks
 * job. Machine-auth only (no human path) — this is the only way
 * dashboard.json is ever updated. Replaces the file wholesale in one
 * commit per run, matching repairer_network's repair-counts.ts pattern.
 * Reads the current blob sha immediately before writing, so a genuine
 * concurrent writeback (e.g. a manually re-triggered run overlapping the
 * scheduled one) fails loudly with a 409 rather than one silently clobbering
 * the other.
 */
export async function putDashboardData(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!isAuthorizedWriteback(request)) return FORBIDDEN;

  const body = (await request.json()) as DashboardData;
  if (!Array.isArray(body.dealers) || !Array.isArray(body.elrCurrent)) {
    return { status: 400, jsonBody: { error: "Malformed dashboard payload" } };
  }

  const { sha } = await getCurrentDashboardJson<DashboardData>().catch(() => ({ sha: undefined as unknown as string }));
  try {
    await commitDashboardJson(body, sha, "Refresh dashboard data from Databricks");
  } catch (err) {
    context.error("Failed to commit dashboard data", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("GitHub API 409")) {
      return {
        status: 409,
        jsonBody: { error: "Dashboard data was updated concurrently. This run should be retried." },
      };
    }
    return { status: 500, jsonBody: { error: "Failed to persist dashboard data", detail: message } };
  }

  return { status: 200, jsonBody: { ok: true } };
}

app.http("dashboard-data-put", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "dashboard-data",
  handler: putDashboardData,
});
