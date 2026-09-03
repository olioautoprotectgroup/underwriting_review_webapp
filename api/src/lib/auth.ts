import { HttpRequest } from "@azure/functions";
import { timingSafeEqual } from "node:crypto";
import { ALLOWED_STAFF_EMAILS } from "./allowlist";

/**
 * Azure Static Web Apps' Free tier has no custom-role support (that's a
 * Standard SKU feature), so role gating in staticwebapp.config.json can
 * only use the built-in `authenticated` role. Every route is gated on that
 * alone, and this module does the real access check here, server-side,
 * using the `x-ms-client-principal` header SWA attaches to every proxied
 * request. Unlike repairer_network's domain-suffix check, this is an
 * exact-match allowlist (see allowlist.ts for why).
 */
const ALLOWED = new Set(ALLOWED_STAFF_EMAILS.map((e) => e.toLowerCase()));

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

export function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded) as ClientPrincipal;
  } catch {
    return null;
  }
}

export function isAuthorizedStaff(request: HttpRequest): boolean {
  const principal = getClientPrincipal(request);
  return Boolean(principal?.userDetails && ALLOWED.has(principal.userDetails.toLowerCase()));
}

/**
 * The 403 every staff-gated route returns, naming the identity **the server
 * itself saw**.
 *
 * This exists because an opaque 403 hid a real bug. A user whose address is on
 * the allowlist was refused by the API while `App.tsx`'s client-side copy of the
 * same list accepted them — so they got the full app shell with an unexplained
 * error inside it, and nothing on either side said which identity had been
 * rejected. `signedInAs` closes that: the client and server checks can disagree,
 * and when they do the difference has to be visible.
 *
 * `signedInAs: null` is itself the diagnosis — it means `x-ms-client-principal`
 * never arrived, which is a different fault from an unrecognised address.
 *
 * **Not an information leak.** It returns the caller's own identity, taken from
 * their own auth cookie, to themselves — the same value `App.tsx` already
 * renders client-side. It exposes nothing about anyone else, and deliberately
 * carries only this one field rather than the whole principal (a test pins
 * that), so it cannot drift into dumping `userId` or roles.
 *
 * Machine callers do not use this — `dashboard-data.ts` keeps its own 403, since
 * a writeback failure has no user principal to report.
 */
export function forbiddenResponse(request: HttpRequest): {
  status: number;
  jsonBody: { error: string; signedInAs: string | null };
} {
  return {
    status: 403,
    jsonBody: {
      error: "Access restricted to approved underwriting staff",
      signedInAs: getClientPrincipal(request)?.userDetails ?? null,
    },
  };
}

/**
 * Authorizes a machine caller (the scheduled Databricks dashboard push) via
 * a shared secret in the `x-writeback-key` header, checked against the
 * DATABRICKS_WRITEBACK_KEY app setting. Constant-time comparison so
 * response timing can't be used to guess the key.
 */
export function isAuthorizedWriteback(request: HttpRequest): boolean {
  const expected = process.env.DATABRICKS_WRITEBACK_KEY;
  if (!expected) return false;
  const provided = request.headers.get("x-writeback-key");
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected, "utf-8");
  const providedBuf = Buffer.from(provided, "utf-8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
