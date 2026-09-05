---
id: "blog-enterprise-cli-browser-login-organization-skills"
slug: "enterprise-cli-browser-login-organization-skills"
date: "2026-09-05"
title: "Enterprise CLI: SSO Login, Organization Skills, 15 Coding Agents"
summary: "The LLM Gateway CLI now signs in through your browser or enterprise SSO, installs your organization's shared skills into Claude Code, Codex, OpenCode, Cursor, and more, and launches 15 coding agents pre-wired to the gateway. Organization skills are an Enterprise feature; browser login works on every plan."
categories: ["Product"]
faqs:
  - question: "Can I use the LLM Gateway CLI with SSO?"
    answer: "Yes. Run llmgateway auth login --sso you@example.com and the CLI opens your organization's SSO sign-in in the browser. After you approve the code shown in your terminal, the CLI receives its own revocable session. Email and password login remains subject to your organization's SSO enforcement."
  - question: "What are organization skills in LLM Gateway?"
    answer: "Organization skills are SKILL.md bundles, optionally with supporting files, that enterprise owners and admins publish in the dashboard. Developers list and install them with llmgateway skills add into the folder their coding agent reads, such as .claude or .agents/skills, using a project API key from the same organization."
  - question: "Which coding agents does the LLM Gateway CLI launch?"
    answer: "Fifteen built-in agents, including Claude Code, Codex CLI, OpenCode, DevPass Code, Aider, Qwen Code, Goose, Empryo, and SoulForge, plus any custom launcher you register from a JSON definition with llmgateway agents add. Run llmgateway launch --list for the current list."
  - question: "Does installing an organization skill run any code?"
    answer: "No. Installation validates the bundle, rejects path traversal and symlink destinations, and only writes files. Supporting scripts are treated as code for you to review before running, and the CLI requires --force to replace an existing skill directory."
image:
  src: "/blog/enterprise-cli-browser-login-organization-skills.png"
  alt: "A glowing terminal window linked by a beam of light to a browser window holding a key, surrounded by books, a shield, and robot figures on a circuit board"
  width: 1536
  height: 1024
---

Rolling coding agents out to forty developers looks simple until you do it. Every developer configures every agent by hand. The team's review checklist lives in a wiki that no agent reads. And the accounts are on SAML SSO, so the CLI, which only knew email and password, could not sign in at all.

The **LLM Gateway CLI** now handles all three. It signs in through the browser session you already have, including **enterprise SSO**. It installs **organization skills**, a shared library of agent instructions your admins publish once, into whichever agent each developer uses. And it launches 15 coding agents pre-wired to the gateway, plus any launcher your enterprise defines.

## Sign in from the browser you are already logged into

```bash
npx @llmgateway/cli auth login
```

The CLI prints a short code and opens the dashboard's approval page. The page shows the same code next to the account it is about to sign in, and you approve only if they match. The CLI then polls for its own session and stores it in `~/.llmgateway/config.json`, bound to the API instance that issued it.

For SSO-only organizations, `--sso you@example.com` goes straight to your identity provider's sign-in. On a remote machine, `--no-browser --timeout 600` prints the link and code instead of opening anything.

A few properties were non-negotiable:

- The CLI gets a **separate, revocable session**, never your browser cookie. `auth logout` revokes it on the server.
- Device codes are single use, expire after ten minutes by default, and code creation is rate limited.
- No session token ever travels in a redirect URL.
- Password, social, and passkey login still respect enforced SSO. Browser login does not create a side door.

Deployments without device authorization keep working with `auth login --email` or `auth login --key`, and the CLI reports the missing capability explicitly instead of failing in a confusing way.

## Organization skills: publish once, install everywhere

A skill is a `SKILL.md` file with a YAML header, optionally alongside references, scripts, and assets. Under **Organization → Skills**, owners and admins import a single file, import a whole folder, or write a custom skill in the dashboard. New skills are enabled immediately; disabling one removes it from CLI discovery, and every publish, edit, disable, or delete lands in the organization audit log without recording the skill's content.

```md
---
name: code-review
description: Review code changes against the team's standards.
---

# Code review

- Check correctness and error handling.
- Explain the impact of each finding.
- Suggest tests for important edge cases.
```

Developers pull the catalog into the agent they use:

```bash
npx @llmgateway/cli skills list
npx @llmgateway/cli skills show code-review
npx @llmgateway/cli skills add code-review --agent claude
npx @llmgateway/cli skills add --all --agent codex
```

Install targets are `agents` (the default, writing `.agents/skills/<name>/SKILL.md`), `codex`, `claude`, `opencode`, `cursor`, `qwen`, and `pi`; `--global` uses the agent's home-directory location. Admins can also publish from the terminal with `skills publish ./SKILL.md --org <org-id>`.

| Limit            | Value                                      |
| ---------------- | ------------------------------------------ |
| Skill name       | Lowercase, hyphenated, up to 64 characters |
| `SKILL.md`       | Up to 200,000 characters                   |
| Supporting files | Up to 100 per skill, 1 MB per bundle       |

Your own tooling can read the same catalog: `GET /v1/skills` lists enabled skills and `GET /v1/skills/{name}` returns the full bundle, authenticated with a regular project API key against the platform API. Expired keys return `401`, missing project or enterprise access returns `403`, and disabled skills return `404`.

Organization skills are available on the **Enterprise plan**.

## Fifteen agents, one launcher

`npx @llmgateway/cli launch <agent>` starts an agent with the gateway configured, whatever that agent needs: environment variables, a config file, or its own key-registration command. Aider, Qwen Code, and Goose join Claude Code, Codex CLI, OpenCode, DevPass Code, Empryo, SoulForge, and the rest, for 15 built-in agents.

Enterprises with an internal agent register it from a trusted JSON definition:

```bash
llmgateway agents add ./company-agent.json
llmgateway launch -m your-model company-agent
```

Definitions accept `${model}`, `${gatewayUrl}`, and `${apiKey}` placeholders, credentials only in environment values, and arguments passed without a shell. Repository files are never executed implicitly. `--gateway-url` points any launch at a private gateway endpoint, `--dry-run` previews the launch offline, and key checks are opt-in with `--check-key` because a probe can incur an inference charge.

## Rolling it out on a private deployment

Self-hosted deployments need three things, all shipped in the latest gateway release: the device authorization migration, the dashboard's `/connect/device` approval page, and the organization skills API on the management service. The CLI's client ID is `llmgateway-cli`, and `auth login` saves the `--api-url`, `--dashboard-url`, and `--gateway-url` you pass so later commands find the right services. The full deployment contract is documented in the [CLI docs](https://docs.llmgateway.io/developers/cli).

## Getting started

- **[Talk to us about Enterprise](https://llmgateway.io/enterprise)** to enable organization skills and SSO for your team
- **[Read the organization skills docs](https://docs.llmgateway.io/features/organization-skills)** for publishing, limits, and the API contract
- **[Launch any coding agent from the CLI](/changelog/cli-launch-coding-agents)** covers the launcher this release extends

<BlogCta variant="gateway" location="bottom" />
