import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import { fetchCasesForDealer } from "../lib/caseRepository";
import { isAuthorizedStaff } from "../lib/auth";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

/**
 * Combines the periodically-refreshed dealer/ELR/claim-mix snapshot with a
 * live read of that dealer's cases. Cases are always live (see the frontend
 * development plan's "Case write path") — the snapshot never carries case
 * data, so there's nothing to reconcile between the two.
 */
export async function getDealer(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const dealerCode = request.params.code;
  if (!dealerCode) return { status: 400, jsonBody: { error: "dealerCode is required" } };

  const dashboard = loadDashboardData();
  const dealer = dashboard.dealers.find((d) => d.dealerCode === dealerCode);
  if (!dealer) return { status: 404, jsonBody: { error: `No dealer with code "${dealerCode}"` } };

  const elrCurrent = dashboard.elrCurrent.filter((p) => p.dealerCode === dealerCode);
  const elrHistory = dashboard.elrHistory.filter((p) => p.dealerCode === dealerCode);
  const claimMix = dashboard.claimMix.filter((c) => c.dealerCode === dealerCode);
  const cases = await fetchCasesForDealer(dealerCode);

  return { jsonBody: { dealer, elrCurrent, elrHistory, claimMix, cases } };
}

app.http("dealers-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dealers/{code}",
  handler: getDealer,
});
