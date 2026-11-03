# Code review

What the automated reviewers and the humans on this repository look for. Every
review loads this file; keep it short and keep it true.

## What failure looks like here

- `apps/gateway` — it misroutes, double-bills, leaks a provider key or another org's data, or blocks the request path on the `log` table.
- `apps/api` — it exposes data across organizations, skips server-side permission checks, or breaks a webhook idempotently retried by Stripe or a provider.
- `packages/db/migrations` — it locks a live table, rewrites it, or breaks the deployed code that runs before and after the migration.
- `packages/models` — it misprices, mislabels a capability, or removes a model instead of deactivating it.
- `packages/actions` — it builds a request the provider rejects, or costs it wrong (money math without `Decimal`).
- `apps/worker` — it double-charges, skips a period, or deletes data retention should keep.
- `.github/workflows` — it runs fork code with a write token, or lets a red check merge.
- `apps/docs`, changelog, marketing — it lies about current behaviour or hardcodes a catalogue list.

## How to review

- Judge the change against its stated intent: does it solve the problem, fit the system, and leave everything it touched consistent (docs, tests, callers)? On a bug fix, look for the root cause, not the symptom.
- Evidence is a file and line in this repository, not a guess from a name. Read the implementation before claiming it is wrong.
- Rank findings: **Important** (would ship a bug, a security hole, or a lie), **Nit** (style, naming, small simplification), **Pre-existing** (true, but not introduced by this PR). Cap nits at three per review; drop findings that are only diagnostics, formatting, or cleanup — `pnpm format` and CI own those.
- Start the summary with a count ("2 important, 1 nit") and say plainly when there is nothing to fix.
- Flag code that breaks a rule in `AGENTS.md` or the matching skill, and changes that make a line in those files out of date.

## Skip

`pnpm-lock.yaml`, `**/snapshot.json`, images, `apps/mobile/ios`, `apps/mobile/android`, generated `dist/` and `.next/` output.

## Closing the loop

- Every finding is answered: fix it, or resolve the thread with a one-line reason. Unresolved threads block the merge.
- When a reviewer flags the same thing twice, fix it at the source: an ESLint rule, a line in the matching skill, or a line here. Do not re-explain it in the next PR.
- An approval covers one commit. A push after approval needs a fresh look.
