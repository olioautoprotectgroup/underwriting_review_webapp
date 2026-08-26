/**
 * Live Databricks access for the case read/write path (see the frontend
 * development plan's "Case write path" section for why cases go straight
 * to Databricks rather than through the git-committed dashboard.json).
 *
 * Auth: a personal access token (PAT) under Oliver Oakes' own Databricks
 * account, used directly as the bearer token on every request — not a
 * service principal, since creating one requires account/workspace admin
 * rights this project doesn't have. This is the same accepted tradeoff as
 * `sandbox.oliver_oakes` elsewhere in this platform (see
 * `underwriting_reviews/docs/CHANGE_LOG.md`'s "Promote off
 * sandbox.oliver_oakes" open item): the token is tied to a human account
 * and will break if that person's access changes or the token is rotated
 * or revoked. Revisit once proper admin/service-principal access is
 * available.
 *
 * Required app settings: DATABRICKS_HOST, DATABRICKS_TOKEN,
 * DATABRICKS_WAREHOUSE_ID, DATABRICKS_CATALOG, DATABRICKS_SCHEMA.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required app setting: ${name}`);
  return value;
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
  const token = requiredEnv("DATABRICKS_TOKEN");

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
