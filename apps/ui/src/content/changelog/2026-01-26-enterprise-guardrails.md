---
id: "36"
slug: "enterprise-guardrails"
date: "2026-01-26"
title: "Enterprise Guardrails"
summary: "Protect your LLM usage with content guardrails. Detect and block prompt injections, PII, secrets, and more — available for Enterprise customers."
image:
  src: "/changelog/guardrails.png"
  alt: "Guardrails configuration dashboard"
  width: 1408
  height: 768
---

**Guardrails** protect your organization by automatically detecting and blocking harmful content in LLM requests.

## Built-in Protection

System rules detect common threats:

- **Prompt Injection** — attempts to override system instructions
- **Jailbreak** — attempts to bypass safety measures
- **PII Detection** — personal information like emails, phone numbers, SSNs
- **Secrets** — API keys, passwords, and credentials
- **Sensitive File Types** — block uploads of restricted file types

## Configurable Actions

For each rule, choose how to respond:

- **Block** — reject the request entirely
- **Redact** — remove sensitive content and continue
- **Warn** — log the violation but allow the request

## Custom Rules

Create organization-specific rules:

- **Blocked Terms** — prevent specific words or phrases
- **Custom Regex** — match patterns unique to your use case
- **Topic Restrictions** — block certain topics

## Security Events Dashboard

Monitor all violations with a dedicated dashboard showing:

- Total violations and trends
- Breakdown by action taken (blocked, redacted, warned)
- Detailed violation logs with timestamps

## Access

Guardrails are available on the **Enterprise plan**.

**Interested?** [Contact us](/enterprise) to enable Enterprise for your organization.
