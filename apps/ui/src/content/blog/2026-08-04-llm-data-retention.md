---
id: "blog-llm-data-retention"
slug: "llm-data-retention"
date: "2026-08-04"
title: "LLM Data Retention: What to Store, and for How Long"
summary: "A practical guide to LLM data retention: when storing full prompts and responses helps, when metadata is enough, what it costs, and how to set a retention policy your compliance team will sign off on."
categories: ["Guides"]
faqs:
  - question: "Does LLM Gateway store my prompts by default?"
    answer: "No. The default retention level is metadata-only: timestamps, models, token counts, and costs, with no request or response payloads. Full payload storage is an explicit opt-in per organization, available on standard pay-as-you-go organizations."
  - question: "How much does LLM data retention cost?"
    answer: "Metadata retention is free. Full payload retention costs $0.01 per 1 million tokens across all token types, billed per request and itemized in `usage.cost_details.data_storage_cost`."
  - question: "How long does LLM Gateway keep stored request data?"
    answer: "On the managed cloud, 30 days by default, after which records are deleted automatically; Enterprise organizations can configure custom retention periods to match their audit or data-minimization requirements. Payload retention itself is only configurable on standard pay-as-you-go organizations — DevPass and chat subscriptions stay metadata-only. Self-hosted deployments set their own retention periods through environment variables."
  - question: "Can I keep LLM logs inside my own infrastructure?"
    answer: "Yes — self-host the AGPLv3 gateway and all stored data lives in your own PostgreSQL database, with retention configured through environment variables and no per-token storage fee."
image:
  src: "/blog/llm-data-retention.png"
  alt: "LLM data retention concept — a glowing vault chip on a circuit board holding request records"
  width: 1536
  height: 1024
---

Every LLM request your application makes is a record: a prompt that may contain customer data, a response that may end up in front of a user, and metadata about cost, latency, and the model that produced it. LLM data retention is the question of which of those records you keep, for how long, and who can see them — and most teams answer it by accident, inheriting whatever their tooling logs by default.

That default matters more than it looks. Store too little and you can't debug a bad production response or answer an auditor's question about what a model was shown. Store too much and you've built a second copy of your most sensitive data, with its own access-control and deletion obligations under GDPR and your customer contracts.

**LLM Gateway** makes the decision explicit: retention is a per-organization policy, not a side effect of logging.

## Metadata or full payloads: the only real decision

There are two meaningfully different retention levels for LLM traffic:

| Level               | What's stored                                                                                 | What it enables                                               | Cost on LLM Gateway |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------- |
| **Metadata only**   | Timestamps, model, provider, token counts, costs, finish reasons                              | Usage analytics, spend tracking, routing data                 | Free (default)      |
| **Retain all data** | Everything above, plus full request and response payloads — messages, tool calls, attachments | Payload-level debugging, audit trails, incident investigation | $0.01 per 1M tokens |

Metadata-only is the default on LLM Gateway, and it's the right default: your usage dashboards, cost analytics, and per-model breakdowns all work without a single prompt being stored. Payload retention is opt-in, per organization, for the teams that need to inspect exactly what was sent and returned.

Full payload retention is configurable on standard pay-as-you-go organizations. DevPass and chat subscriptions are always metadata-only — their request and response payloads are not retained, and there is no setting to turn payload storage on.

## When you actually need full payloads

Three situations justify storing complete requests and responses:

- **Production debugging.** A user reports a wrong or harmful response. Without the stored payload you're reconstructing the conversation from application logs; with it you inspect the exact prompt, tool calls, and completion in the dashboard, filtered by model and date.
- **Audit and incident response.** Compliance frameworks increasingly ask what data was shown to which AI system. A payload trail answers that question with records rather than architecture diagrams.
- **Quality analysis.** Measuring prompt effectiveness or response quality over time requires the actual text, not just token counts.

If none of these apply, stay on metadata-only. You get the analytics without the obligations.

## What retention costs

When "Retain All Data" is enabled, storage bills at **$0.01 per 1 million tokens** across input, cached input, output, and reasoning tokens. A request with 1,000 input and 500 output tokens costs $0.000015 to store. Each response's `usage.cost_details` object includes a `data_storage_cost` field, so the per-request cost is visible in the API response itself, and storage appears as its own category in the usage dashboard and invoices.

In API-keys mode (your own provider keys), only the storage cost touches your LLM Gateway credits — inference bills go to your provider. In credits mode, both come out of credits.

## How long records are kept

Stored data is retained for 30 days by default, then deleted automatically. Enterprise plans can set custom retention periods — longer for audit-heavy industries, shorter for data-minimization policies. Changing the retention level applies to new requests only; existing records follow the policy that was active when they were created.

One exception worth knowing: the Responses API keeps stored responses (used for `previous_response_id` chaining) in dedicated storage for 30 days regardless of your retention level, matching OpenAI's own behavior. Send `store: false` with the request to opt out.

## Setting the policy

Retention is configured per organization in the dashboard:

1. Navigate to **Organization Settings → Policies**
2. Select your **Data Retention Level**
3. Save

All stored data is encrypted at rest, access is restricted to organization members with the right permissions, and you can request immediate deletion of specific records through support. Self-hosted deployments (the gateway core is AGPLv3) keep everything in your own PostgreSQL database, under your own retention rules.

## Retention is one leg of the compliance stool

Retention controls what _you_ keep. The other half of the question is what your _providers_ keep — whether they log prompts, train on them, and where they're headquartered. That's governed by [provider compliance policies](https://docs.llmgateway.io/features/compliance), which block requests to providers that don't meet your requirements before any data leaves the gateway.

For the full picture, see the [LLM compliance checklist](/blog/llm-compliance-checklist) and our guide to [GDPR-compliant LLM routing](/blog/gdpr-compliant-llm-routing). Our own handling of your data is covered by a SOC 2 Type II report — see [the announcement](/blog/soc2-type-ii) or request the report at [security.llmgateway.io](https://security.llmgateway.io/).

<BlogCta variant="enterprise" location="bottom" />
