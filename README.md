# Underwriting Review Webpage

Web dashboard and case-management front end for AutoProtect's Underwriting Review Platform. Reuses the stack and patterns proven in `olioautoprotectgroup/repairer_network`: React + Vite + TypeScript + Tailwind CSS frontend, colocated Azure Functions (Node/TypeScript) backend under `/api`, deployed together via Azure Static Web Apps (Free tier), CI/CD via the SWA GitHub Actions integration.

It reads dealer RAG/ELR status, Dealer 360 detail, and claim mix from the Databricks platform in `olioautoprotectgroup/underwriting_reviews`, and provides a web front end for the case-management actions `notebooks/case_manager.py` performs today (open/close/notes/assign).

## Structure

```
underwriting_review_webapp/
├── src/                        # React frontend
│   ├── pages/                  # Dashboard, DealerDetail, CaseDetail
│   ├── components/             # RagBadge, DealerSummary, ElrTrendChart, CaseCard, CaseEventForm
│   └── lib/                    # api.ts (fetch client), types.ts, allowlist.ts (UI-only copy)
├── api/                         # Azure Functions backend
│   ├── data/dashboard.json     # Git-committed dealer + ELR-current snapshot (aggregate only)
│   ├── src/functions/          # One file per route group
│   ├── src/lib/                # allowlist, auth, data, github, databricks, caseRules, caseRepository, types
│   └── test/                   # Vitest unit tests for caseRules and auth
└── staticwebapp.config.json    # Route/auth config for Azure Static Web Apps
```

## Two data paths — don't confuse them

**The rule: aggregate data lives in the snapshot, per-dealer data is read live.**

- **Snapshot (dealers, ELR *current*)** is read-only and periodically refreshed. A Databricks job (`underwriting_reviews/notebooks/webapp_dashboard_push.py`, weekly Monday 08:30) pushes a fresh `api/data/dashboard.json` via `PUT /api/dashboard-data`, committed to this repo through the GitHub Contents API with SHA-based optimistic concurrency — the same pattern `repairer_network` uses for its repairer directory.
- **Live, directly against Databricks** via a personal access token and the SQL Statement Execution API (`api/src/lib/databricks.ts`, `caseRepository.ts`):
  - **Case data (open/close/notes/assign)** — `uwr_case`/`uwr_case_event`/`uwr_case_current`.
  - **ELR history** — `uwr_warranty_elr_snapshot`, one dealer at a time (`fetchElrHistoryForDealer`).
  - **Claim mix** — `vw_fact_claim`, Warranty-filtered, one dealer at a time (`fetchClaimMixForDealer`).

Two different reasons, worth keeping straight:

**Cases are live for correctness.** The case-open precondition (dealer currently Amber/Red, no other active case for that cohort) must be checked against Databricks' live state — a periodically refreshed snapshot would risk a real correctness bug. Once a live call is required anyway, keeping cases out of the git-committed file avoids a second, eventually-consistent copy of compliance-relevant data.

**ELR history is live for volume.** It holds one row per dealer × product × contract_year × period — ~386K rows, ~187 MB as JSON — and is only ever needed for one dealer at a time, to draw that dealer's trend chart. Pushing all of it through the snapshot broke on several independent platform limits simultaneously: Azure Static Web Apps caps an `/api` request at **30 MB** and each request at **45 seconds** (neither configurable, any tier), Consumption functions get **1.5 GB** of memory against a path that holds several inflating copies of the payload, and GitHub's Contents API refuses commits far below 187 MB. It would also have added roughly **1 GB/year of permanent git history**, and `api/data/dashboard.json` is deployed *inside* the app, against the Free tier's 250 MB budget.

If you're adding a new field, ask which of the two it is. Anything sized by dealer count is probably fine in the snapshot; anything sized by dealer × period almost certainly is not.

## Auth

Azure Static Web Apps' Free tier has no custom roles — every route requires only the built-in `authenticated` role in `staticwebapp.config.json`. The real access control is a **static, exact-match staff email allowlist** (`api/src/lib/allowlist.ts`), checked server-side in `api/src/lib/auth.ts` against the `x-ms-client-principal` header SWA attaches post-login. `src/lib/allowlist.ts` is a hand-kept UI-only copy used purely to show a friendlier "not approved" screen — it is never the security boundary; every API route re-checks the real list itself.

Adding or removing someone from the allowlist requires a PR + merge (redeploy) — a deliberate tradeoff for git-blame/PR-review traceability on a compliance-relevant access list.

The Databricks dashboard-push job authenticates to `PUT /api/dashboard-data` with a shared secret (`x-writeback-key` header, checked via constant-time comparison against `DATABRICKS_WRITEBACK_KEY`) rather than a signed-in identity, since it can't produce an AAD header.

## Local development

Two terminals, same pattern as `repairer_network`:

```bash
# Terminal 1 — frontend, proxies /api to localhost:7071
npm install
npm run dev

# Terminal 2 — API
cd api
npm install
cp local.settings.json.example local.settings.json   # fill in real values
npm start   # runs `func start` — requires Azure Functions Core Tools v4
```

Without the SWA gateway in front of it, `x-ms-client-principal` is never set locally, so the frontend will show the signed-out screen. Use the [SWA CLI](https://azure.github.io/static-web-apps-cli/) (`swa start --api-location api`) for full login-flow testing, or call the API directly (e.g. with `curl`) for backend-only work.

## Verification

- `npm run build` (root) — `tsc --noEmit && vite build`
- `npm run typecheck && npm test` (in `api/`) — Vitest unit tests cover the case status-transition rules and the auth/allowlist checks; both are pure-function tests with no live Databricks connection required
- `.github/workflows/ci.yml` runs both of the above on every PR against `main`

## Deployment

See the frontend development plan for the full checklist (Azure Static Web App creation, application settings, Databricks service principal and warehouse setup, the `webapp_dashboard_push.py` job, and smoke tests). In short:

1. Azure Portal → Static Web App → Free plan, linked to this repo, app location `/`, api location `api`, output location `dist`.
2. Application settings: `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO`/`GITHUB_BRANCH`/`GITHUB_DATA_PATH`, `DATABRICKS_HOST`/`DATABRICKS_TOKEN`/`DATABRICKS_WAREHOUSE_ID`/`DATABRICKS_CATALOG`/`DATABRICKS_SCHEMA`, `DATABRICKS_WRITEBACK_KEY`.
3. Databricks: a personal access token (PAT) under an account with `SELECT` on the ELR/dealer/claim tables and `SELECT`+`INSERT` on the case tables (a service principal needs admin rights this project doesn't have yet — see `docs/CHANGE_LOG.md` in `underwriting_reviews` for the decision), plus a small serverless SQL warehouse.
4. Populate `api/src/lib/allowlist.ts`, PR + merge.
