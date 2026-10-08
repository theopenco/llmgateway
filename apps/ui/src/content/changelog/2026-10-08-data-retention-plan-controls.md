---
id: "113"
slug: "data-retention-plan-controls"
date: "2026-10-08"
title: "Data Retention Plan Controls"
summary: "Full request and response retention is available on Enterprise and can no longer be enabled on Free. New organizations default to Metadata Only, existing settings stay unchanged, and the Responses API continues to work."
tags: ["llmgateway"]
image:
  src: "/changelog/data-retention-plan-controls.png"
  alt: "A glowing data vault on a circuit board beside chat bubbles and an analytics chart"
  width: 1536
  height: 1024
---

Usage analytics do not require storing full prompts and completions. **Retain All Data** is available on Enterprise and can no longer be enabled on the Free plan.

## Keep usage analytics without payloads

New organizations default to Metadata Only: request timestamps, models, token counts, and costs remain available, without storing full request and response payloads in your logs.

Existing retention settings stay unchanged. Free organizations that already retain payloads can keep their setting or turn it off. Once turned off, it cannot be re-enabled on Free.

## Keep using the Responses API

The Responses API works independently of log retention. Stored responses remain available for 30 days for `previous_response_id` chaining and response retrieval, including on Free with Metadata Only. Send `store: false` to opt out of Responses storage.

The separate Enterprise zero-data-retention compliance policy still requires `store: false`.

---

**[Data retention docs →](https://docs.llmgateway.io/features/data-retention)** | **[Explore Enterprise →](https://llmgateway.io/enterprise)**
