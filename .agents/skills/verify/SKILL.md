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

Run these as separate commands. Never pipe one whose failure must stop the
chain into `tail` or `head`: a pipeline reports the _last_ command's status, so
`docker compose up -d | tail && pnpm wait-for-services | tail && pnpm push-dev`
runs the schema push even when the stack never came up.

Then confirm your own containers are serving the ports before any
`push-*`, `seed`, or test command:

```bash
docker compose ps --format '{{.Name}}\t{{.State}}\t{{.Ports}}'
```

A port that was free when the slot was chosen is not a guarantee. Worktrees
come and go, and another one can claim the port while this stack is down, so a
`DATABASE_URL` that answers is not necessarily this worktree's database — a
`push-dev` or `seed` against another worktree's Postgres destroys its data
silently. If `docker ps` shows the port held by a container whose name lacks
this worktree's `STACK_SUFFIX`, move to a different slot; never stop or reuse
the other container.

If `docker compose up` fails with `all predefined address pools have been fully
subnetted`, pin this worktree's subnet rather than pruning networks, which
other worktrees depend on:

```yaml
# docker-compose-override-<worktree>.yml (gitignored)
networks:
  default:
    ipam:
      config:
        - subnet: 10.99.<slot>.0/24
```

Pass it alongside the base file on every compose command for the worktree,
including `down`:
`docker compose -f docker-compose.yml -f docker-compose-override-<worktree>.yml up -d`.

Use `pnpm setup` only when a full reset is required and `STACK_SUFFIX` is set;
it removes the selected stack's volumes.

## Build and launch

Build affected apps through Turbo filters, including their workspace
dependencies. Run the full `pnpm build` before handoff when required by
`AGENTS.md`.

Turbo's strict environment mode may not pass the worktree isolation variables
declared in `.envrc`. Launch an isolated stack with
`pnpm exec turbo run dev --env-mode=loose`, then confirm the startup logs show
the selected ports rather than the defaults.

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
