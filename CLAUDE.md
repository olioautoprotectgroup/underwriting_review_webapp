# Instructions for Claude Code working in this repository

## Branching and pull requests — mandatory

**Never commit or push directly to `main`.** This applies to every change,
no matter how small. For every change:

1. Create a feature branch off `main`.
2. Commit your change(s) there.
3. Open a pull request into `main`.
4. Do not merge it yourself unless the repo owner has explicitly asked you
   to. Leave it open for review by default.

### Why this exists

This repo's branch protection cannot be technically enforced — GitHub only
enforces branch protection / rulesets on private repositories on a paid
plan, and this org is on the free tier. The sibling repo
`olioautoprotectgroup/underwriting_reviews` had three separate incidents
where a direct-to-`main` push collided with in-flight work from another
agent or session — see that repo's `CHANGE_LOG.md` (2026-08-24 entry) for
the full history. This repo adopts the same convention from day one to
avoid repeating it: multiple AI agents (Claude Code, Codex) and the repo
owner all have push access, so a direct push collides silently.

## Two data paths — don't confuse them when making changes

- **Dashboard data** (`api/data/dashboard.json`): read-only, refreshed
  periodically by a Databricks job via `PUT /api/dashboard-data`. Never add
  case data to this file or that endpoint.
- **Case data**: read and written **live** against Databricks
  (`api/src/lib/databricks.ts`, `caseRepository.ts`) — never routed through
  the git-committed snapshot. See `README.md` and `api/src/lib/caseRules.ts`
  for why.

## Repo conventions

- `api/src/lib/allowlist.ts` (server-side, the real security boundary) and
  `src/lib/allowlist.ts` (client-side, UI-only) must be kept in sync by
  hand — same convention as `types.ts` being duplicated between frontend
  and API rather than a shared package.
- Case business rules (`api/src/lib/caseRules.ts`) must stay pure functions
  with no direct Databricks call, so they remain unit-testable — see
  `api/test/caseRules.test.ts`.
- Run `npm run typecheck && npm run build` (root) and `npm run typecheck &&
  npm test` (in `api/`) before considering any change done — this is what
  `.github/workflows/ci.yml` gates on.
