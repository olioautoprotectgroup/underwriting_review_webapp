import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import {
  fetchCasesForDealer,
  fetchClaimMixForDealer,
  fetchElrHistoryForDealer,
} from "../lib/caseRepository";
import { fetchDealerDashboard } from "../lib/dealerDashboard";
import { fetchDealerClaims } from "../lib/dealerClaims";
import { forbiddenResponse, isAuthorizedStaff } from "../lib/auth";

/**
 * Combines the periodically-refreshed dealer/ELR-current snapshot with live
 * reads of this dealer's ELR history, claim mix, and cases.
 *
 * Cases are always live (see the frontend development plan's "Case write
 * path") — the snapshot never carries case data, so there's nothing to
 * reconcile. ELR *history* and *claim mix* are live for a different reason:
 * both are per-dealer data that was bloating a weekly-committed snapshot
 * (history ~386k rows; claim mix ~19k). All live reads are issued
 * concurrently — none depends on another, and each is its own warehouse
 * round trip, so serialising them would multiply the page's latency.
 *
 * `claims` is returned alongside `dashboard` rather than inside it because it
 * is a genuinely different basis: `dashboard` is policy-grained off
 * `uwr_transformed_data`, `claims` is claim-grained off `vw_fact_claim`, and
 * their claim values do not tie (see dealerClaims.ts). Keeping them as sibling
 * keys means nothing in the payload implies they are two views of one number.
 */
export async function getDealer(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return forbiddenResponse(request);
  const dealerCode = request.params.code;
  if (!dealerCode) return { status: 400, jsonBody: { error: "dealerCode is required" } };

  const dashboard = loadDashboardData();
  const dealer = dashboard.dealers.find((d) => d.dealerCode === dealerCode);
  if (!dealer) return { status: 404, jsonBody: { error: `No dealer with code "${dealerCode}"` } };

  const elrCurrent = dashboard.elrCurrent.filter((p) => p.dealerCode === dealerCode);
  const [elrHistory, claimMix, cases, dealerDashboard, claims] = await Promise.all([
    fetchElrHistoryForDealer(dealerCode),
    fetchClaimMixForDealer(dealerCode),
    fetchCasesForDealer(dealerCode),
    fetchDealerDashboard(dealerCode),
    fetchDealerClaims(dealerCode),
  ]);

  return {
    jsonBody: {
      dealer,
      elrCurrent,
      elrHistory,
      claimMix,
      cases,
      dashboard: dealerDashboard,
      claims,
    },
  };
}

app.http("dealers-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dealers/{code}",
  handler: getDealer,
});
