/**
 * Static, exact-match staff allowlist — committed in code rather than an app
 * setting or Azure AD group, per an explicit decision (see the repo's
 * frontend development plan). Spans two email domains (@autoprotect.net and
 * @autoprotectgroup.co.uk), so this must stay an exact-match list, not a
 * single-domain suffix check like repairer_network's ALLOWED_DOMAIN.
 *
 * Adding/removing someone requires a PR + merge (redeploy) — an accepted
 * tradeoff for git-blame/PR-review traceability on a compliance-relevant
 * access list.
 */
export const ALLOWED_STAFF_EMAILS: readonly string[] = [
  "cingrey@autoprotect.net",
  "oliver.oakes@autoprotectgroup.co.uk",
  "matthew.tilly@autoprotectgroup.co.uk",
  "lbakerstokes@autoprotect.net",
  "gambrose@autoprotect.net",
  "joshua.botha@autoprotectgroup.co.uk",
];
