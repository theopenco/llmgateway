---
id: "blog-llm-compliance-checklist"
slug: "llm-compliance-checklist"
date: "2026-08-04"
title: "The LLM Compliance Checklist for Production Teams"
summary: "An eight-point LLM compliance checklist for putting model traffic in production: provider vetting, routing restrictions, data residency, retention, access control, and the audit trail — with what to enforce at the gateway versus document by hand."
categories: ["Guides"]
faqs:
  - question: "What should an LLM compliance checklist cover?"
    answer: "Provider inventory, routing restrictions, geographic control, retention (yours and your providers'), access gating, an audit trail, coverage for internal deployments, and diligence on the gateway vendor itself. The distinguishing question for each: is it enforced mechanically, or documented and hoped for?"
  - question: "Can compliance rules be enforced before data reaches a provider?"
    answer: "Yes — that's the point of enforcing at the gateway. LLM Gateway blocks requests that would violate the compliance policy with a `403` before any data leaves the gateway, on both automatic routing and pinned-provider requests."
  - question: "Which parts of this need an Enterprise plan?"
    answer: "Provider compliance policies, the headquarters filter, org-level restrictions over IAM, custom retention periods, and audit logs are [Enterprise features](https://llmgateway.io/enterprise). Metadata-only retention, the provider directory, and self-hosting the AGPLv3 core are available to everyone."
  - question: "Does self-hosting remove the need for this checklist?"
    answer: "No — self-hosting moves the gateway inside your boundary but your traffic still fans out to providers. Points 1–5 apply identically; you're just running the enforcement point yourself."
image:
  src: "/blog/llm-compliance-checklist.png"
  alt: "LLM compliance checklist concept — a glowing clipboard chip with checkmarks on a circuit board"
  width: 1536
  height: 1024
---

Security reviews for LLM features fail on the same handful of questions. Which providers see our data? Can anything route somewhere we haven't approved? What do we retain, and what do _they_ retain? Who approved this model, and where's the record?

This LLM compliance checklist is the eight-point version of that review — the one to run _before_ the vendor questionnaire arrives. For each point: what good looks like, and whether it's something you can enforce mechanically at the gateway or something you document by hand. Enforcement beats documentation every time an outage, a retry, or a hurried engineer would otherwise make the decision for you.

**LLM Gateway** enforces most of this list at the routing layer; where a capability is Enterprise-gated, we say so.

## 1. Inventory every provider that can see your data

You can't review what you can't list. Every provider your traffic can reach — including fallbacks — receives your data, typically as a processor (confirm the exact role — processor, subprocessor, or controller — in each provider's DPA), and the list is longer than most teams think once automatic failover is involved.

- **What good looks like:** a live list of eligible providers per model, not a wiki page from the launch review.
- **How to enforce it:** route everything through one gateway so there is exactly one place the list lives. The [providers directory](https://llmgateway.io/providers) shows every catalogue provider with its certifications, data policy, and headquarters.

## 2. Restrict routing to providers that meet your requirements

An approved-vendor list only matters if unapproved vendors are unreachable.

- **What good looks like:** requests physically cannot reach a provider that fails your certification or data-policy bar, on any code path.
- **How to enforce it:** [provider compliance policies](https://docs.llmgateway.io/features/compliance) (Enterprise plan) — toggle SOC 2 Type II, ISO 27001, GDPR, no-training-on-prompts, no-prompt-logging, and no-stealth-providers requirements. Every requirement is fail-closed: unknown attributes count as non-compliant, and blocked requests get a `403` before any data leaves the gateway. The dashboard's policy-aware provider pickers show a green or red shield per provider, with the exact failing requirements listed, so the policy is visible while you configure it — not just when it rejects traffic.

## 3. Control where data goes geographically

Certifications tell you how a provider behaves; jurisdiction tells you which laws it answers to.

- **What good looks like:** routing restricted to approved countries, with regional pinning where a provider offers multiple regions.
- **How to enforce it:** the Provider Headquarters filter allows only providers based in your selected countries (fail-closed for unknown headquarters), and `provider/model:region` syntax pins individual requests to a specific region. See [GDPR-compliant LLM routing](/blog/gdpr-compliant-llm-routing) for the EU-specific walkthrough.

## 4. Set an explicit retention policy — yours and theirs

Two retention questions, often conflated: what you store, and what your providers store.

- **What good looks like:** metadata-only storage unless payload retention has a named justification; provider-side logging and training excluded by policy (point 2).
- **How to enforce it:** LLM Gateway defaults to metadata-only — no prompts or responses stored. Payload retention is per-organization opt-in at $0.01/1M tokens with automatic deletion after the retention period (custom periods on Enterprise). The [LLM data retention guide](/blog/llm-data-retention) covers the trade-offs.

## 5. Gate who can use what

Model access is a permission like any other. A developer experimenting with an unapproved model shouldn't be a policy discussion after the fact.

- **What good looks like:** org-wide restrictions that member- and key-level rules cannot override.
- **How to enforce it:** blocked/allowed provider and model lists compose with the requirements above, and organization-level compliance restrictions take precedence over member-level and API-key-level IAM rules. Project-scoped developers can browse what they're allowed to call on the org's Models page without being granted policy access.

## 6. Keep an audit trail of decisions and rejections

Auditors ask two things: show me the control, and show me it working.

- **What good looks like:** config changes, key rotations, and blocked requests all recorded with actor and timestamp.
- **How to enforce it:** every compliance-policy block is recorded as a security event, and [audit logs](https://llmgateway.io/enterprise/audit-logs) (Enterprise) capture configuration and key changes — exportable as evidence for your own SOC 2 or HIPAA audits.

## 7. Cover your own deployments, not just catalogue providers

Custom deployments — models in your own cloud account — have no published data policy, so a fail-closed policy blocks them by default.

- **What good looks like:** internal deployments held to the same written standard as external vendors.
- **How to enforce it:** record a compliance self-attestation per custom provider key (SOC 2 status, logging, training, operating country). The gateway evaluates attestations with the same fail-closed rules, and every attestation change lands in the audit log.

## 8. Verify your gateway vendor, too

The gateway sees everything, so it has to clear a higher bar than the providers behind it.

- **What good looks like:** a current SOC 2 Type II report, a public trust center, and — ideally — source you can read.
- **How it works here:** LLM Gateway holds a [SOC 2 Type II report](/blog/soc2-type-ii), the trust center at [security.llmgateway.io](https://security.llmgateway.io/) hosts certifications and subprocessors, and the core is AGPLv3 — self-hostable when policy requires the gateway inside your own boundary.

## The checklist, in one place

| #   | Check                          | Mechanism                                       | Plan       |
| --- | ------------------------------ | ----------------------------------------------- | ---------- |
| 1   | Provider inventory             | Single gateway + providers directory            | All plans  |
| 2   | Routing restrictions           | Compliance policies, fail-closed                | Enterprise |
| 3   | Geographic control             | Headquarters filter + region pinning            | Enterprise |
| 4   | Retention policy               | Metadata-only default, opt-in payload retention | PAYG plans |
| 5   | Access gating                  | Org restrictions over IAM rules                 | Enterprise |
| 6   | Audit trail                    | Security events + audit logs                    | Enterprise |
| 7   | Custom-deployment attestations | Self-attestation, fail-closed evaluation        | Enterprise |
| 8   | Gateway vendor diligence       | SOC 2 Type II + trust center + AGPLv3 source    | —          |

<BlogCta variant="enterprise" location="bottom" />
