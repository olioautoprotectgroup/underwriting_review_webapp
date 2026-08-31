import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { looksGzipped, parseMaybeGzippedJson } from "../lib/requestBody";
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
  //
  // Compression is detected from the body's magic bytes, NOT from
  // Content-Encoding, because that header does not survive the trip: the push
  // job sets it, the gzip body arrives intact, but the header is stripped en
  // route. See requestBody.ts for the full reasoning.
  let body: DashboardData;
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    const gzipped = looksGzipped(raw);
    if (gzipped && request.headers.get("content-encoding")?.toLowerCase() !== "gzip") {
      // Not an error — just the condition that made this bug hard to see.
      // Worth a breadcrumb if the platform's behaviour ever changes back.
      context.log(
        "Body is gzipped (detected by magic bytes) but Content-Encoding was not received — " +
          "header was stripped in transit, as expected on Static Web Apps.",
      );
    }
    body = parseMaybeGzippedJson(raw) as DashboardData;
  } catch (err) {
    context.error("Failed to read dashboard payload", err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 400,
      jsonBody: { error: "Could not read the request body as JSON", detail: message },
    };
  }

  // Validates only the keys the snapshot still carries. `claimMix` is
  // deliberately NOT required: it moved to a live per-dealer read, and a
  // payload that still includes it (an older notebook revision) must keep
  // working. That tolerance is the point — when elrHistory was removed, the
  // notebook change merged before the webapp change and briefly left every
  // dealer page 500ing. Accepting both shapes means these two repos can be
  // deployed in either order.
  if (!Array.isArray(body?.dealers) || !Array.isArray(body?.elrCurrent)) {
    return {
      status: 400,
      jsonBody: { error: "Malformed dashboard payload: expected dealers and elrCurrent arrays" },
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
