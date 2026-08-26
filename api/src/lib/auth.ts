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
