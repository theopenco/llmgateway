---
id: "blog-how-we-keep-llm-gateway-secure"
slug: "how-we-keep-llm-gateway-secure"
date: "2026-10-23"
title: "How We Keep LLM Gateway Secure in the Age of AI"
summary: "AI makes attackers faster, and supply chain attacks on LLM infrastructure keep landing. Here is how we approach AI gateway security at LLM Gateway: the routines that patch advisories, the monthly AI security audit, layered code review, and the real pull requests behind them."
categories: ["Engineering"]
faqs:
  - question: "How does LLM Gateway protect provider API keys?"
    answer: "Provider keys are encrypted at rest and never written to logs or API responses. LLM Gateway API keys are stored as HMAC fingerprints, not plaintext, and the secrets behind both live in a keyring that supports rotation. In August 2026 we removed every plaintext fallback, so a missing ciphertext now fails closed instead of falling back to a readable value."
  - question: "Does LLM Gateway use AI to write and review code?"
    answer: "Yes. AI agents help write many of our pull requests, run our monthly security audit and our dependency advisory pass, and review every pull request. Every change still goes through the same rules: evidence as a file and line, a regression test for each fix, unresolved review threads block the merge, and changes to high-risk paths need a maintainer's review."
  - question: "How fast does LLM Gateway patch security advisories?"
    answer: "Critical and high advisories are fixed in dedicated pull requests, usually within days. When Node.js shipped its October 21, 2026 security releases, the bump to 24.22.1 merged the same day. Since August 1, 2026 we have merged 19 pull requests that patched dependency or runtime advisories."
  - question: "How do I report a security issue in LLM Gateway?"
    answer: "Use a private GitHub security advisory on the theopenco/llmgateway repository, as described in SECURITY.md. Please do not open a public issue for a vulnerability."
image:
  src: "/blog/how-we-keep-llm-gateway-secure.png"
  alt: "A glowing teal shield on the central chip of a dark circuit board, surrounded by a padlock, a key, a magnifying glass over code, a checklist, a git branch and a radar, representing AI gateway security routines"
  width: 1536
  height: 1024
---

Two days ago, [LiteLLM was compromised again](/blog/litellm-compromised-again): a poisoned release dumped every provider key its users had stored. In the same week we patched critical Next.js advisories, a Node.js security release and an account takeover in a popular auth library. AI is shrinking the time between a published bug and a working exploit.

So the question we hear most from security teams has changed. It used to be "are you SOC 2 compliant?" Now it is "You use AI to write code. How do you keep it secure?"

This post answers that with what actually ran in our repository: the routines, the review layers and the pull requests. **LLM Gateway** is open source, so every PR linked here is public.

## What an AI gateway has to protect

An AI gateway sits between your application and every model provider you use. That makes AI gateway security a narrow but unforgiving problem. Our review brief, `REVIEW.md`, defines failure per area, and it reads like a threat model:

- **Gateway**: it leaks a provider key or another organization's data, misroutes or double-bills.
- **API**: it exposes data across organizations or skips a server-side permission check.
- **Billing and webhooks**: it breaks a webhook that Stripe or a provider retries.
- **CI workflows**: it runs fork code with a write token or lets a red check merge.
- **Docs and marketing**: it lies about current behaviour.

Everything below exists to catch one of those before it ships.

## Routine 1: patch advisories in days, not quarters

Most breaches still start with a known bug in a dependency. Our dependency routine has three parts:

- **Dependabot** checks GitHub Actions daily, npm weekly across every workspace, and Docker monthly. All security updates land in one grouped PR instead of one per directory, and version updates wait out a five-day cooldown, so a freshly poisoned release has time to be caught before we adopt it.
- **A scheduled security pass** keeps one standing `chore/security` branch, recreates it from the latest `main`, and fixes every open critical and high advisory in the lockfile, with each advisory ID and the reason for each bump in the PR body.
- **The runtime is pinned in one place.** `.tool-versions` holds the Node.js version for CI, workflows, the devcontainer and the infrastructure Dockerfiles, so a runtime patch is a one-line change.

What that looked like this month:

| PR                                                         | What it fixed                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [#4766](https://github.com/theopenco/llmgateway/pull/4766) | Node.js 24.22.1 from the October 21 security releases, merged the same day                     |
| [#4777](https://github.com/theopenco/llmgateway/pull/4777) | Next.js critical advisories (including an unauthenticated RCE), plus DOMPurify and Hono        |
| [#4761](https://github.com/theopenco/llmgateway/pull/4761) | Two high advisories in the MCP SDK, plus Vite and launch-editor                                |
| [#4711](https://github.com/theopenco/llmgateway/pull/4711) | A critical magic link account takeover in better-auth, with the 1.7 rate-limit storage rewrite |

Since August 1, we have merged 19 pull requests that patched dependency or runtime advisories.

Install scripts are a second front. pnpm only runs lifecycle scripts for an explicit allowlist in `pnpm-workspace.yaml` (esbuild, sharp and a handful of others), so a compromised transitive package cannot run code just by being installed.

## Routine 2: a monthly AI security audit that needs evidence

AI is very good at producing security checklists, and checklists are mostly noise. So our audit is built around evidence.

In October we added a [`security-audit` agent skill](https://github.com/theopenco/llmgateway/pull/4374) to the repository. It merges OpenAI's `security-best-practices` (secure defaults per framework) with Cloudflare's `security-audit` (an evidence-first, six-phase audit workflow). Agents load it whenever they touch auth, sessions, API keys, billing, webhooks, user-supplied URLs or admin routes, and once a month it drives a full audit:

1. **Reconnaissance** maps the trust boundaries, seeded with the surfaces that matter here: auth, tenancy checks in every route, gateway keys, provider credentials, outbound URLs, Stripe webhooks, client IP trust, MCP and admin.
2. **Hunting** runs attack-class passes, including a dedicated one for prompt injection, tool calls and model output.
3. **Validation** turns each candidate into a record in `findings.json`, checked by a validator script. A best practice with no reachable boundary violation is not a finding.
4. **Fix** handles only `confirmed` findings: one finding per commit, the smallest change at the last trusted decision point, and a regression `*.spec.ts` next to the code.

Two rules keep this safe in a public repository. Findings and reports are never committed, because they describe unfixed vulnerabilities. And a fix PR names each finding by title and severity only, never a working exploit.

One finding fixed this month: [#4494](https://github.com/theopenco/llmgateway/pull/4494): a Vertex service-account JSON is user-supplied, and the server POSTed to whatever `token_uri` it contained. **Fixed finding: SSRF via service-account `token_uri`, high.** The token endpoint is now pinned to Google's, with a regression test that proves a foreign `token_uri` is ignored.

## Routine 3: every pull request gets AI and human review

AI agents help write many of our pull requests, so review cannot be a rubber stamp. It works in layers:

- **AI review on every PR.** CodeRabbit loads `REVIEW.md`, so it hunts for the failures above rather than style. Findings must cite a file and line and are ranked Important, Nit or Pre-existing.
- **Risk labels.** The `pr-risk` workflow labels each PR `risk: low`, `medium` or `high`. Changes to migrations, the database schema, auth, payment and Stripe webhook routes, or CI workflows are always high risk, whatever their size, and request a maintainer review.
- **Nothing is waved through.** Every finding is fixed or resolved with a one-line reason, unresolved threads block the merge, and an approval covers one commit: a push after approval needs a fresh look.
- **Fix it at the source.** When a reviewer flags the same thing twice, the fix goes into an ESLint rule, a skill or `REVIEW.md`, not into the next PR description.
- **Static analysis.** GitHub code scanning runs alongside. It caught three polynomial ReDoS patterns ([#3762](https://github.com/theopenco/llmgateway/pull/3762)) and a time-of-check race in our e2e workflow, where a commit pushed after a maintainer's `/e2e` comment could have run with provider secrets. That workflow now refuses any head pushed after the comment ([#4318](https://github.com/theopenco/llmgateway/pull/4318)).

We also try things that do not work yet. This week we shipped a dedicated AI security review job and a hard merge gate, then pulled both the next day because they needed more work. They will come back in separate PRs. A security control that blocks good changes and lets reviewers tune it out is worse than none.

## What the commits look like: closing SSRF one door at a time

Bring-your-own-key means tenants can point the gateway at their own provider endpoints. That is useful, and it is also the classic setup for server-side request forgery (SSRF). Here is one thread of work from the last three weeks:

- [#4374](https://github.com/theopenco/llmgateway/pull/4374) pins tenant DNS: sockets to tenant-controlled hosts resolve through a lookup that rejects private and reserved addresses at connect time, so the address used is the address checked.
- [#4494](https://github.com/theopenco/llmgateway/pull/4494) pins the GCP OAuth token endpoint.
- [#4688](https://github.com/theopenco/llmgateway/pull/4688) guards download URLs that providers return for videos and audio: HTTPS only, no internal hosts, redirects refused.
- [#4719](https://github.com/theopenco/llmgateway/pull/4719) rejects BYOK base URL overrides on the hosted service, and found a second door on the way: an Azure resource name was interpolated into a hostname without validation.
- [#4723](https://github.com/theopenco/llmgateway/pull/4723) moves the hostname check into one shared helper and validates the remaining endpoint options.
- [#4725](https://github.com/theopenco/llmgateway/pull/4725) refuses redirects on the GCP token exchange and stops copying upstream response bodies into errors and logs.
- [#4775](https://github.com/theopenco/llmgateway/pull/4775) routes video generation through the same guarded connection as every other endpoint.

None of these is dramatic on its own. That is the point: each review or audit pass finds the next door, and the fix generalises into a shared helper so the next endpoint gets it for free.

## Keys and secrets fail closed

- **LLM Gateway API keys** are stored as HMAC fingerprints, never plaintext. The secret behind them is a keyring, so it can be rotated without breaking existing keys.
- **Provider keys** are encrypted at rest and must never reach logs or responses.
- **No plaintext fallbacks.** In August, [#3821](https://github.com/theopenco/llmgateway/pull/3821) removed every legacy plaintext path for API keys, provider keys and end-user sessions. A missing ciphertext now fails closed.
- **You can rotate yours too.** See [API key rotation](/blog/api-key-rotation) for zero-downtime rotation of your own keys.

## Abuse is a security problem too

An AI gateway sells compute, so stolen cards and throwaway accounts are a constant. A few of the controls:

- Signups and email verifications are checked against AbuseIPDB. A flagged account is created as usual but cannot buy credits or run inference until a human approves it.
- Rate limits now key on the one client IP header our load balancer actually sets. Before [#3749](https://github.com/theopenco/llmgateway/pull/3749), the limiters read a header that never arrived, so every visitor shared one bucket.
- The docs Ask AI route validates requests before it counts them against the hourly model budget, so junk traffic cannot lock out real users ([#4591](https://github.com/theopenco/llmgateway/pull/4591)).
- Support chat now requires a signed-in user with a verified email ([#4755](https://github.com/theopenco/llmgateway/pull/4755), [#4767](https://github.com/theopenco/llmgateway/pull/4767)).

## AI features get AI-specific controls

When a model can call tools, the tool call is the attack surface. When a user approves a connector tool, the API checks ownership and the saved proposal, then claims it before running anything, so a replayed or doubled approval cannot run a tool twice ([#4598](https://github.com/theopenco/llmgateway/pull/4598)). Our content filter and [guardrails](/blog/llm-guardrails-explained) run in the gateway, so the same policy applies to every provider behind it.

## What you get as a customer

- **[SOC 2 Type II](/blog/soc2-type-ii)**, audited over an observation period rather than on a single day.
- **Audit events and log metadata in your SIEM** through signed HTTPS data streams, on Enterprise.
- **SSO and SCIM** for your identity provider.
- **Data retention you control**, explained in [LLM data retention](/blog/llm-data-retention).
- **Private disclosure.** Report vulnerabilities through a private GitHub security advisory, as described in our `SECURITY.md`.

## Rules we hold AI-written code to

If you are working out how to secure your own codebase in the age of AI, these are the rules that made the difference for us:

1. **Evidence is a file and a line.** An AI finding without one is a guess.
2. **One finding, one commit, one regression test.**
3. **Fix the class, not the instance.** Move the check into a shared helper.
4. **Humans own the high-risk paths.** Auth, billing, migrations and CI always get a maintainer.
5. **Never publish an exploit.** Public PRs name the finding and its severity, nothing more.
6. **Pull a control that does not work yet.** Then bring it back properly.

## Get started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and route your first request in under a minute
- **[Talk to us about Enterprise](https://llmgateway.io/enterprise)**: SSO, SCIM, data streams and our SOC 2 Type II report
- **[LiteLLM compromised again](/blog/litellm-compromised-again)**: what happened, what to rotate and how to migrate
