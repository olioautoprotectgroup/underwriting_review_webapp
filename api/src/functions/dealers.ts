import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import {
  fetchCasesForDealer,
  fetchClaimMixForDealer,
  fetchElrHistoryForDealer,
} from "../lib/caseRepository";
import { isAuthorizedStaff } from "../lib/auth";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

/**
 * Combines the periodically-refreshed dealer/ELR-current snapshot with live
 * reads of this dealer's ELR history, claim mix, and cases.
 *
 * Cases are always live (see the frontend development plan's "Case write
 * path") — the snapshot never carries case data, so there's nothing to
 * reconcile. ELR *history* and *claim mix* are live for a different reason:
 * both are per-dealer data that was bloating a weekly-committed snapshot
 * (history ~386k rows; claim mix ~19k). All three live reads are issued
 * concurrently — none depends on another, and each is its own warehouse
 * round trip, so serialising them would triple the page's latency.
 */
export async function getDealer(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  const dealerCode = request.params.code;
  if (!dealerCode) return { status: 400, jsonBody: { error: "dealerCode is required" } };

  const dashboard = loadDashboardData();
  const dealer = dashboard.dealers.find((d) => d.dealerCode === dealerCode);
  if (!dealer) return { status: 404, jsonBody: { error: `No dealer with code "${dealerCode}"` } };

  const elrCurrent = dashboard.elrCurrent.filter((p) => p.dealerCode === dealerCode);
  const [elrHistory, claimMix, cases] = await Promise.all([
    fetchElrHistoryForDealer(dealerCode),
    fetchClaimMixForDealer(dealerCode),
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
