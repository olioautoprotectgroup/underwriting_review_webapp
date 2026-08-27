import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import { isAuthorizedStaff } from "../lib/auth";
import type { DashboardSummary } from "../lib/types";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

/**
 * The dashboard table's data, projected down to the columns it renders.
 *
 * This used to return the entire snapshot, so every browser downloaded the
 * full dealer list and claim mix on every page load to draw a five-column
 * table. Keep this a projection: if a new column is needed, add it here
 * explicitly rather than widening the response back out to the whole file.
 */
export async function getDashboard(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;

  const { elrCurrent } = loadDashboardData();
  const body: DashboardSummary = {
    elrCurrent: elrCurrent.map((p) => ({
      dealerCode: p.dealerCode,
      dealerName: p.dealerName,
      contractYear: p.contractYear,
      earnedLossRatio: p.earnedLossRatio,
      ragStatus: p.ragStatus,
    })),
  };
  return { jsonBody: body };
}

app.http("dashboard-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dashboard",
  handler: getDashboard,
});
