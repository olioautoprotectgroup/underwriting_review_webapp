// Mirrors api/src/lib/allowlist.ts by hand. This copy is UI-only — it drives
// the "you're signed in but not approved" screen in App.tsx. It is NOT the
// security boundary: every API route re-checks the real allowlist
// server-side (api/src/lib/auth.ts), reading the same x-ms-client-principal
// header directly, so a stale or tampered copy of this file can never grant
// access to data — it can only make the client-side UX say the wrong thing
// until the next real API call 403s.
export const ALLOWED_STAFF_EMAILS: readonly string[] = [
  "cingrey@autoprotect.net",
  "oliver.oakes@autoprotectgroup.co.uk",
  "matthew.tilly@autoprotectgroup.co.uk",
  "lbakerstokes@autoprotect.net",
  "gambrose@autoprotect.net",
  "joshua.botha@autoprotectgroup.co.uk",
];
