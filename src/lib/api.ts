import type {
  CaseDetail,
  CaseEventInput,
  CaseWithCurrentState,
  DashboardSummary,
  DealerClaims,
  DealerDashboard,
  Dealer,
  ElrPosition,
  ClaimMixEntry,
  OpenCaseInput,
} from "./types";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        detail?: string;
        signedInAs?: string | null;
      };
      if (parsed.error) message = [parsed.error, parsed.detail].filter(Boolean).join(" — ");

      // A 403 carries the identity the SERVER saw. Surface it, because the
      // server and this app check the allowlist separately and can disagree:
      // when they do, the user gets the full signed-in shell with a bare
      // "access restricted" inside it, and nothing says which identity was
      // refused. That happened, and cost a diagnosis. `signedInAs: null` means
      // the request reached the API with no sign-in identity attached at all,
      // which is a different fault worth distinguishing.
      if ("signedInAs" in parsed) {
        message +=
          parsed.signedInAs === null || parsed.signedInAs === undefined
            ? " — the API received no sign-in identity for this request"
            : ` — the server sees you as ${parsed.signedInAs}`;
      }
    } catch {
      // not JSON — use the raw text as-is
    }
    throw new Error(`Request failed (${res.status}): ${message}`);
  }
  return res.json() as Promise<T>;
}

export async function getDashboard(): Promise<DashboardSummary> {
  const res = await fetch("/api/dashboard");
  return handle<DashboardSummary>(res);
}

export interface DealerDetail {
  dealer: Dealer;
  elrCurrent: ElrPosition[];
  /** Read live from Databricks by the API, not from the snapshot. */
  elrHistory: ElrPosition[];
  claimMix: ClaimMixEntry[];
  cases: CaseWithCurrentState[];
  /** The Power BI Dealer Dashboard rebuild — read live from uwr_transformed_data. */
  dashboard: DealerDashboard;
  /**
   * Sections 7-10 — read live from vw_fact_claim. A sibling key, not part of
   * `dashboard`, because the basis differs and the claim values do not tie.
   */
  claims: DealerClaims;
}

export async function getDealerDetail(dealerCode: string): Promise<DealerDetail> {
  const res = await fetch(`/api/dealers/${encodeURIComponent(dealerCode)}`);
  return handle<DealerDetail>(res);
}

export async function listCases(): Promise<CaseWithCurrentState[]> {
  const res = await fetch("/api/cases");
  return handle<CaseWithCurrentState[]>(res);
}

export async function getCase(caseId: string): Promise<CaseDetail> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
  return handle<CaseDetail>(res);
}

export async function openCase(input: OpenCaseInput): Promise<CaseWithCurrentState> {
  const res = await fetch("/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle<CaseWithCurrentState>(res);
}

export async function addCaseEvent(
  caseId: string,
  input: CaseEventInput,
): Promise<CaseWithCurrentState> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle<CaseWithCurrentState>(res);
}

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

export async function getClientPrincipal(): Promise<ClientPrincipal | null> {
  try {
    const res = await fetch("/.auth/me");
    if (!res.ok) return null;
    const data = (await res.json()) as { clientPrincipal: ClientPrincipal | null };
    return data.clientPrincipal;
  } catch {
    return null;
  }
}
