---
name: verify
description: Build, launch, and drive the LLM Gateway stack in an isolated worktree environment to verify API, gateway, dashboard, playground, or screenshot changes. Use when locally reproducing a change, launching services on offset ports, taking seeded-data screenshots, or checking a workflow end to end.
---

# Verify a change

Use the repository's current implementation and `AGENTS.md` as the source of
truth. Do not reuse ports, containers, credentials, or commands remembered from
another worktree.

## Isolate the workspace

1. Read **Running an isolated stack per worktree** in `AGENTS.md`.
2. Reuse the worktree's exported `STACK_SUFFIX`, database URLs, Redis ports, app
   ports, and service URLs only if they are complete. Otherwise choose an unused
   slot and export the full block from `AGENTS.md`.
3. Confirm the selected ports are free. Never start or reset the default shared
   Docker stack from a Conductor worktree.

Start only the isolated services needed by the change:

```bash
pnpm build:core
docker compose up -d
pnpm wait-for-services
pnpm push-test
pnpm push-dev
pnpm seed
```

Use `pnpm setup` only when a full reset is required and `STACK_SUFFIX` is set;
it removes the selected stack's volumes.

## Build and launch

Build affected apps through Turbo filters, including their workspace
dependencies. Run the full `pnpm build` before handoff when required by
`AGENTS.md`.

Launch the configured stack with `pnpm dev`. Use exported service URLs where
the repository defines them; otherwise construct the local origin from the
matching app port in `AGENTS.md`.

## Drive and capture

- Use seeded accounts and identifiers from `packages/db/src/seed.ts`; passwords
  equal their seeded email addresses.
- Verify the changed behavior through the same surface a user exercises. Pin a
  gateway provider and set `x-no-fallback: true` when provider-specific behavior
  matters.
- Use an available browser automation tool for UI verification. If a local
  Playwright script is needed, run it from an app that declares
  `@playwright/test` (`apps/ui`, `apps/playground`, or `apps/code`).
- Capture only seeded local data. Resolve screenshot output paths from the tool
  being used instead of assuming a tool-specific directory.

Record the exact commands, URLs, and observed result. Do not describe a check as
passing unless it ran successfully.

## Clean up

Stop processes started for the check. Run `docker compose down -v` only when
this session started the worktree-specific `STACK_SUFFIX` stack. Never tear down
the default shared stack or a stack that was already running.
