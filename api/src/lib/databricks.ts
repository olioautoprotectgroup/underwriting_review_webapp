/**
 * Live Databricks access for the case read/write path (see the frontend
 * development plan's "Case write path" section for why cases go straight
 * to Databricks rather than through the git-committed dashboard.json).
 *
 * Auth: OAuth machine-to-machine (client-credentials grant) against a
 * Databricks service principal, not a personal access token — a PAT is
 * tied to a human account and silently breaks if that person's access
 * changes; a service principal is Databricks' documented pattern for an
 * unattended API caller like this Function.
 *
 * NOTE: the exact OAuth token-endpoint path below (`/oidc/v1/token`) is the
 * documented Databricks account/workspace OAuth-for-service-principals
 * endpoint at the time this was written. Confirm it against current
 * Databricks docs during deployment setup — this is the one detail in this
 * file worth verifying live rather than trusting as committed.
 *
 * Required app settings: DATABRICKS_HOST, DATABRICKS_CLIENT_ID,
 * DATABRICKS_CLIENT_SECRET, DATABRICKS_WAREHOUSE_ID, DATABRICKS_CATALOG,
 * DATABRICKS_SCHEMA.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required app setting: ${name}`);
  return value;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

/** Refresh 60s before actual expiry so a token never goes stale mid-request. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken;
  }

  const host = requiredEnv("DATABRICKS_HOST").replace(/\/$/, "");
  const clientId = requiredEnv("DATABRICKS_CLIENT_ID");
  const clientSecret = requiredEnv("DATABRICKS_CLIENT_SECRET");

  const res = await fetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "all-apis",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Databricks OAuth token request failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

export type SqlParamType = "STRING" | "INT" | "DOUBLE" | "BOOLEAN" | "DATE" | "TIMESTAMP";

export interface SqlParam {
  name: string;
  value: string | number | boolean | null;
  type: SqlParamType;
}

interface StatementResponse {
  statement_id: string;
  status: { state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "CLOSED"; error?: { message: string } };
  manifest?: { schema: { columns: { name: string }[] } };
  result?: { data_array?: (string | null)[][] };
}

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

/**
 * Executes a single SQL statement against the configured warehouse and
 * returns its rows as plain objects keyed by column name. Every value MUST
 * be bound via `parameters` with an explicit SQL type — never string-
 * interpolated into `statement` — this is the injection-safety boundary
 * for every case read/write in this app.
 */
export async function executeStatement(
  statement: string,
  parameters: SqlParam[] = [],
): Promise<Record<string, string | null>[]> {
  const host = requiredEnv("DATABRICKS_HOST").replace(/\/$/, "");
  const warehouseId = requiredEnv("DATABRICKS_WAREHOUSE_ID");
  const catalog = requiredEnv("DATABRICKS_CATALOG");
  const schema = requiredEnv("DATABRICKS_SCHEMA");
  const token = await getAccessToken();

  const submit = async () => {
    const res = await fetch(`${host}/api/2.0/sql/statements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        catalog,
        schema,
        statement,
        parameters,
        wait_timeout: "30s",
        disposition: "INLINE",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Databricks SQL statement submission failed (${res.status}): ${body}`);
    }
    return (await res.json()) as StatementResponse;
  };

  const poll = async (statementId: string) => {
    const res = await fetch(`${host}/api/2.0/sql/statements/${statementId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Databricks SQL statement poll failed (${res.status}): ${body}`);
    }
    return (await res.json()) as StatementResponse;
  };

  let response = await submit();
  let attempts = 0;
  while (
    (response.status.state === "PENDING" || response.status.state === "RUNNING") &&
    attempts < MAX_POLL_ATTEMPTS
  ) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    response = await poll(response.statement_id);
    attempts++;
  }

  if (response.status.state !== "SUCCEEDED") {
    const message = response.status.error?.message ?? `statement ended in state ${response.status.state}`;
    throw new Error(`Databricks SQL statement did not succeed: ${message}`);
  }

  const columns = response.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows = response.result?.data_array ?? [];
  return rows.map((row) => Object.fromEntries(columns.map((name, i) => [name, row[i] ?? null])));
}
