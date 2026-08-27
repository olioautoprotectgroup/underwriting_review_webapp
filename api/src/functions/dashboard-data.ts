import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { gunzipSync } from "node:zlib";
import { commitDashboardJson, getDashboardFileSha } from "../lib/github";
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

  // Decoding is inside a try/catch on purpose. It used to sit outside one,
  // and an unhandled throw here is invisible to the caller: the platform
  // returns a bare 500 with an empty body and nothing but a trace ID, which
  // is indistinguishable from an infrastructure failure and cost real time
  // to diagnose. Any failure to read the body is a client error — say so.
  let body: DashboardData;
  try {
    const encoding = request.headers.get("content-encoding")?.toLowerCase();
    if (encoding === "gzip") {
      const raw = Buffer.from(await request.arrayBuffer());
      body = JSON.parse(gunzipSync(raw).toString("utf-8")) as DashboardData;
    } else {
      body = (await request.json()) as DashboardData;
    }
  } catch (err) {
    context.error("Failed to read dashboard payload", err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 400,
      jsonBody: { error: "Could not read the request body as JSON", detail: message },
    };
  }

  if (
    !Array.isArray(body?.dealers) ||
    !Array.isArray(body?.elrCurrent) ||
    !Array.isArray(body?.claimMix)
  ) {
    return {
      status: 400,
      jsonBody: { error: "Malformed dashboard payload: expected dealers, elrCurrent and claimMix arrays" },
    };
  }

  try {
    const sha = await getDashboardFileSha();
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
