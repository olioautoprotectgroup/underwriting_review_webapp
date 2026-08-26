import type {
  CaseDetail,
  CaseEventInput,
  CaseWithCurrentState,
  DashboardData,
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
      const parsed = JSON.parse(text) as { error?: string; detail?: string };
      if (parsed.error) message = [parsed.error, parsed.detail].filter(Boolean).join(" — ");
    } catch {
      // not JSON — use the raw text as-is
    }
    throw new Error(`Request failed (${res.status}): ${message}`);
  }
  return res.json() as Promise<T>;
}

export async function getDashboard(): Promise<DashboardData> {
  const res = await fetch("/api/dashboard");
  return handle<DashboardData>(res);
}

export interface DealerDetail {
  dealer: Dealer;
  elrCurrent: ElrPosition[];
  elrHistory: ElrPosition[];
  claimMix: ClaimMixEntry[];
  cases: CaseWithCurrentState[];
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
