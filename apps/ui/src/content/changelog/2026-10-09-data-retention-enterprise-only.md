---
id: "113"
slug: "data-retention-enterprise-only"
date: "2026-10-09"
title: "Full Data Retention Moves to Enterprise"
summary: "Retain All Data is now an Enterprise feature. New organizations are Metadata Only, and existing organizations that retain full payloads keep the setting until November 8, 2026. Usage analytics and the Responses API are unchanged."
tags: ["llmgateway"]
image:
  src: "/changelog/data-retention-enterprise-only.png"
  alt: "A glowing enterprise data vault on a circuit board with chat bubbles streaming past it and a thin metadata ribbon feeding an analytics chart"
  width: 1536
  height: 1024
---

Storing full prompts and completions is a compliance decision, not a default. **Retain All Data** is now available on the **Enterprise plan** only.

## What changes

New organizations are **Metadata Only**. Request timestamps, models, token counts, latency, and costs stay in your logs and power the dashboard analytics; full request and response payloads are not stored. Enabling **Retain All Data** under **Settings → Policies** requires Enterprise.

## What happens to existing organizations

Organizations that already retain full payloads keep the setting during a 30-day transition window. On **November 8, 2026**, organizations that are not on Enterprise switch to Metadata Only automatically. You can make the switch earlier at any time; once an organization is Metadata Only, the setting cannot be re-enabled without Enterprise.

| Organization                           | Before November 8, 2026   | From November 8, 2026 |
| -------------------------------------- | ------------------------- | --------------------- |
| Enterprise                             | Retain All Data available | Unchanged             |
| Existing, currently retaining payloads | Retain All Data kept      | Metadata Only         |
| Existing, Metadata Only                | Metadata Only             | Unchanged             |
| New                                    | Metadata Only             | Unchanged             |

Payloads already stored follow your organization's retention period and are deleted when it expires, exactly as before. Metadata Only logs carry no storage cost.

## What does not change

The Responses API works independently of log retention. Stored responses remain available for 30 days for `previous_response_id` chaining and retrieval on every plan; send `store: false` to opt out.

The separate Enterprise **zero data retention** compliance policy, provider keys you bring yourself, and usage analytics are unaffected.

If your team relies on full request and response logs for debugging, evaluation, or audit, [talk to us about Enterprise](https://llmgateway.io/enterprise).

---

**[Data retention docs →](https://docs.llmgateway.io/features/data-retention)** | **[Explore Enterprise →](https://llmgateway.io/enterprise)**
