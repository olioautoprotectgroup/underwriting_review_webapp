import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadDashboardData } from "../lib/data";
import { isAuthorizedStaff } from "../lib/auth";

const FORBIDDEN: HttpResponseInit = {
  status: 403,
  jsonBody: { error: "Access restricted to approved underwriting staff" },
};

export async function getDashboard(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isAuthorizedStaff(request)) return FORBIDDEN;
  return { jsonBody: loadDashboardData() };
}

app.http("dashboard-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dashboard",
  handler: getDashboard,
});
