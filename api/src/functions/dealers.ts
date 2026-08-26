import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import { fetchCasesForDealer, fetchElrHistoryForDealer } from "../lib/caseRepository";
import { isAuthorizedStaff } from "../lib/auth";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

/**
 * Combines the periodically-refreshed dealer/ELR-current/claim-mix snapshot
 * with live reads of this dealer's ELR history and cases.
 *
 * Cases are always live (see the frontend development plan's "Case write
 * path") — the snapshot never carries case data, so there's nothing to
 * reconcile. ELR *history* is also live, for a different reason: it's far
 * too large to ship through the snapshot at all (see
 * fetchElrHistoryForDealer). Both live reads are issued concurrently, since
 * neither depends on the other and each is a separate warehouse round trip.
 */
export async function getDealer(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const dealerCode = request.params.code;
  if (!dealerCode) return { status: 400, jsonBody: { error: "dealerCode is required" } };

  const dashboard = loadDashboardData();
  const dealer = dashboard.dealers.find((d) => d.dealerCode === dealerCode);
  if (!dealer) return { status: 404, jsonBody: { error: `No dealer with code "${dealerCode}"` } };

  const elrCurrent = dashboard.elrCurrent.filter((p) => p.dealerCode === dealerCode);
  const claimMix = dashboard.claimMix.filter((c) => c.dealerCode === dealerCode);
  const [elrHistory, cases] = await Promise.all([
    fetchElrHistoryForDealer(dealerCode),
    fetchCasesForDealer(dealerCode),
  ]);

  return { jsonBody: { dealer, elrCurrent, elrHistory, claimMix, cases } };
}

app.http("dealers-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dealers/{code}",
  handler: getDealer,
});
