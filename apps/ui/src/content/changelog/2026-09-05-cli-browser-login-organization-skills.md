---
id: "92"
slug: "cli-browser-login-organization-skills"
date: "2026-09-05"
title: "CLI Browser Login and Organization Skills"
summary: "Sign in to the LLM Gateway CLI from your browser or enterprise SSO instead of typing a password, and pull your organization's shared skills into Claude Code, Codex, OpenCode, Cursor, and other agents with one command. Browser login works on every plan; organization skills are available on the Enterprise plan."
image:
  src: "/changelog/cli-browser-login-organization-skills.png"
  alt: "A glowing terminal window linked by a beam of light to a browser window holding a key, surrounded by books, a shield, and robot figures on a circuit board"
  width: 1536
  height: 1024
---

Signing in to a CLI with a password is a habit worth breaking, and for teams on enterprise SSO it was not even possible: the CLI only knew email and password. **Browser login** fixes both. The CLI now hands authentication to the dashboard you are already signed in to, including SAML SSO, and gets back its own session.

## Approve a Code, Not a Password

```bash
# Opens the dashboard, shows a code in the terminal, waits for approval
npx @llmgateway/cli auth login

# Jump straight to your organization's SSO sign-in
npx @llmgateway/cli auth login --sso you@example.com

# Remote terminal: print the link and code instead of opening a browser
npx @llmgateway/cli auth login --no-browser --timeout 600
```

The terminal prints a short code, and the approval page at `/connect/device` shows the same code next to the account it will sign in. You approve only if they match. The CLI then receives a separate, revocable session, never your browser cookie, and `auth logout` revokes it on the server. Codes expire, are single use, and are rate limited. For deployments without device authorization, email and password sign-in still works when SSO is not enforced for the email domain, and `--key` remains the API-key fallback.

Self-hosting? The device flow ships with a migration and the CLI client ID `llmgateway-cli`; pass `--api-url`, `--dashboard-url`, and `--gateway-url` to point the CLI at a private deployment.

## Organization Skills

Enterprise organizations can publish a shared skill library under **Organization → Skills**: import a single `SKILL.md`, import a folder with references and scripts, or write a custom skill in the dashboard. Owners and admins publish, edit, disable, and delete; every active member can read; disabled skills disappear from CLI discovery; and each action lands in the audit log without storing the skill content.

| Limit            | Value                                      |
| ---------------- | ------------------------------------------ |
| Skill name       | Lowercase, hyphenated, up to 64 characters |
| `SKILL.md`       | Up to 200,000 characters                   |
| Supporting files | Up to 100 per skill, 1 MB per bundle       |
| Encodings        | `utf-8` text or `base64` binary            |

Developers install them where their agent looks:

```bash
npx @llmgateway/cli skills list
npx @llmgateway/cli skills show code-review
npx @llmgateway/cli skills add code-review --agent claude
npx @llmgateway/cli skills add --all --agent codex
npx @llmgateway/cli skills publish ./SKILL.md --org <org-id>
```

Targets are `agents` (the default, `.agents/skills/<name>/SKILL.md`), `codex`, `claude`, `opencode`, `cursor`, `qwen`, and `pi`; `--global` writes to the agent's home directory. Installation only writes files and never runs a skill's scripts. Your own tooling can read the same catalog with a project API key: `GET /v1/skills` lists enabled skills and `GET /v1/skills/{name}` returns the full bundle.

## Fifteen Agents, Plus Your Own

Aider, Qwen Code, and Goose join the launcher, bringing the built-in list to 15 agents that start pre-wired to the gateway with `npx @llmgateway/cli launch <agent>`. Enterprises can register trusted custom launchers from a JSON definition with `agents add`, and `--gateway-url` points any launch at a private gateway endpoint.

---

**[Organization skills docs →](https://docs.llmgateway.io/features/organization-skills)** | **[CLI docs →](https://docs.llmgateway.io/developers/cli)**
