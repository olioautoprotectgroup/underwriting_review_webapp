import * as fs from "node:fs";
import * as path from "node:path";
import type { DashboardData } from "./types";

// Compiled to dist/src/lib/data.js — data/ lives alongside src/, three levels up from there.
const DATA_FILE = path.join(__dirname, "..", "..", "..", "data", "dashboard.json");

/**
 * Fast read of the locally bundled snapshot — used by the dashboard/dealer
 * detail reads, where being up to one weekly-refresh-cycle behind the
 * latest Databricks push is an acceptable, expected tradeoff (see the
 * webapp_dashboard_push.py notebook). Writes must NOT use this as their
 * base — see github.ts's getCurrentDashboardJson.
 */
export function loadDashboardData(): DashboardData {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw) as DashboardData;
}
