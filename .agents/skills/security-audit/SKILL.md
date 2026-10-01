---
name: security-audit
description: Security best practices, vulnerability review, and full security audits for LLM Gateway. Use when writing security-sensitive code (auth, sessions, API keys, provider keys, billing, webhooks, user-supplied URLs, admin routes, CORS, rendering user content), when asked for a security review, security report, vulnerability research, pen test, or security audit, and for the monthly audit routine that fixes confirmed findings in a PR.
---

# Security audit

Merged from OpenAI's `security-best-practices` (secure defaults per framework)
and Cloudflare's `security-audit` (evidence-first audit workflow). Licenses:
`LICENSE-openai` (Apache-2.0, files under `references/`) and
`LICENSE-cloudflare` (MIT, the upper-case companion files, validators, and
`report-schema.json`).

## Pick the mode

| Request                                        | Mode              | Load                                                   |
| ---------------------------------------------- | ----------------- | ------------------------------------------------------ |
| Writing or changing code                       | Secure by default | Matching `references/` file                            |
| Working nearby and something looks wrong       | Passive           | Flag critical issues only; ask before fixing           |
| Security question, focused review, triage      | Guidance          | Relevant companions from the table below               |
| "Audit", "pen test", full/comprehensive review | Full audit        | [AUDIT-WORKFLOW.md](AUDIT-WORKFLOW.md), all six phases |
| Monthly routine                                | Routine           | Full audit (`quick` profile), then [Fix](#fix)         |

If a request could mean guidance or full audit, ask one question first.

## Framework references

This repo is TypeScript: Hono APIs (`apps/api`, `apps/gateway`), Next.js App
Router frontends, React. Read every matching file before writing or reviewing
code in that stack:

- `references/javascript-typescript-nextjs-web-server-security.md`
- `references/javascript-typescript-react-web-frontend-security.md`
- `references/javascript-general-web-frontend-security.md`
- `references/javascript-express-web-server-security.md` — no Hono guide
  exists; apply its middleware, input, header, and error-handling rules to Hono.

Project rules override generic advice. Do not report missing TLS, `Secure`
cookies on local dev, or missing HSTS as findings. A best practice without a
reachable boundary violation is not a finding (see Anti-patterns in
`AUDIT-WORKFLOW.md`).

## Audit companions

| Companion                                                                          | Covers                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| [RECONNAISSANCE.md](RECONNAISSANCE.md)                                             | Phase 1: boundaries, ledger                         |
| [HUNTING.md](HUNTING.md), [ATTACK-CLASSES.md](ATTACK-CLASSES.md)                   | Phase 2: hunter waves                               |
| [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md)                         | Phases 3-6: verify, `findings.json`, report         |
| [WEB-PROTOCOL-AND-AUTH.md](WEB-PROTOCOL-AND-AUTH.md)                               | Sessions, auth, CSRF, CORS, redirects               |
| [DATA-ISOLATION-AND-LIFECYCLE.md](DATA-ISOLATION-AND-LIFECYCLE.md)                 | Org/project tenancy, deletion, exports              |
| [AI-AND-LLM.md](AI-AND-LLM.md)                                                     | Prompt injection, tool calls, model output handling |
| [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md](RESOURCE-EXHAUSTION-AND-AVAILABILITY.md) | Rate limits, unbounded work, cost abuse             |
| [CLIENT-SIDE.md](CLIENT-SIDE.md)                                                   | XSS, postMessage, client storage                    |
| [CLOUD-AND-DEPLOYMENT.md](CLOUD-AND-DEPLOYMENT.md)                                 | `infra/`, containers, secrets                       |
| [SUPPLY-CHAIN-AND-RELEASE.md](SUPPLY-CHAIN-AND-RELEASE.md)                         | `.github/workflows`, dependencies, publishing       |
| [PROTOCOLS-RPC-AND-MESSAGING.md](PROTOCOLS-RPC-AND-MESSAGING.md)                   | Webhooks, MCP, queues                               |
| [DESKTOP-MOBILE-AND-LOCAL-IPC.md](DESKTOP-MOBILE-AND-LOCAL-IPC.md)                 | `apps/mobile`                                       |
| [MEMORY-SAFETY-AND-BINARY.md](MEMORY-SAFETY-AND-BINARY.md)                         | Native code, parsers (rarely relevant here)         |

## High-value surfaces in this repo

Seed reconnaissance from these; they are not the whole attack surface.

- Auth and sessions: `apps/api/src/auth/` (better-auth), `apps/api/src/middleware/admin.ts`.
- Tenancy: every `apps/api/src/routes/` handler taking an org, project, or key id
  must check the caller's membership. Cross-tenant read or write is high.
- Gateway keys and limits: `apps/gateway/src/key/`, `packages/shared/src/api-key-hash.ts`,
  `apps/gateway/src/middleware/org-rate-limit.ts`, `apps/gateway/src/middleware/cors.ts`.
- Provider credentials: `packages/actions/src/provider-key/` (`crypto.ts`, `redact.ts`),
  `apps/api/src/routes/keys-provider.ts`. Keys must never reach logs or responses.
- User-supplied URLs (SSRF): `packages/actions/src/process-image-url.ts`,
  `packages/shared/src/url-safety-node.ts`, `apps/api/src/routes/platform-webhooks.ts`.
  Rules live in the `gateway` skill.
- Billing: `apps/api/src/stripe.ts` webhook signature handling, credit math (`billing` skill).
- Client IP trust: `packages/shared/src/client-ip.ts` (`infrastructure` skill).
- MCP: `apps/gateway/src/mcp/`.
- Admin: `ee/admin`, `apps/api/src/routes/admin*.ts`.
- Rendered user or model content: grep `dangerouslySetInnerHTML` in `apps/` and `ee/`.

## Running a full audit

Follow `AUDIT-WORKFLOW.md`. Write the run directory outside the repo
(default `~/security-audit-skill/llmgateway/run-<N>`) or under the worktree's
`.context/`, which is git-excluded. Validate before reporting:

```bash
node .agents/skills/security-audit/validate-findings.cjs <run-dir>/findings.json
node .agents/skills/security-audit/validate-coverage-ledger.cjs <run-dir>/coverage-ledger.json
```

Never commit `findings.json` or reports: they describe unfixed vulnerabilities.
Share them only in private channels. `SECURITY.md` governs external disclosure.

## Fix

Fix only `confirmed` findings, one finding per commit, smallest change at the
last trusted decision point, with a regression `*.spec.ts` next to the code.
Check callers so the fix does not break legitimate flows. Run the `testing`
skill's isolated tests and `pnpm build`, then open a PR with the `pull-request`
skill. The PR body names each fixed finding by title and severity only, never
a working exploit. Leave `needs_validation` records out of the PR; list them for
a human.
