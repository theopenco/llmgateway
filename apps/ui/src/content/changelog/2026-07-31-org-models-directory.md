---
id: "73"
slug: "org-models-directory"
date: "2026-07-31"
title: "Org Models Directory"
summary: "The dashboard's Custom Models page is now a full Models directory: every catalog model plus your organization's custom models in one searchable table, with per-model compliance eligibility so your team sees exactly what they can route to."
image:
  src: "/changelog/org-models-directory.png"
  alt: "A glowing model catalog grid on a circuit-board chip with allowed and blocked model tiles, representing the org models directory with compliance eligibility"
  width: 1536
  height: 1024
---

"Which models can we actually use?" used to take three answers: the public models page for the catalog, the Custom Models page for your own deployments, and a compliance admin for what the org's policy blocks. **The org Models directory** merges all three — the dashboard page at `Organization → Models` now lists every catalog model and every custom model your organization defines, marked with whether your compliance policy will actually let a request through.

## One table for catalog and custom models

The page reuses the same directory as the public [models page](https://llmgateway.io/models) — search, capability filters, price and context ranges, table and grid views. Your custom models appear alongside the catalog, addressed as `{customProvider}/{modelName}`, which is the exact model string to send:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "internal-vllm/llama-4-maverick",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'
```

A **Source** filter switches between catalog models, custom models, or both. Every active member of the organization can browse the page — including project-scoped developer members, for whom it is read-only — so nobody needs admin access or a manually shared list to discover what is available.

## Compliance eligibility, on every row

With a provider compliance policy enabled, each provider mapping in the directory is evaluated with the same fail-closed rules the gateway enforces at request time — certifications, data-policy requirements, country restrictions, and provider/model allow and deny lists. Blocked rows are greyed out with a ban icon, and its tooltip lists the exact failing requirements, such as "No SOC 2 Type 2 report" or "Not on the allowed-providers list". Custom providers are judged by their recorded compliance attestation, exactly as the gateway does.

An **Eligible only** filter narrows the directory to what requests can actually reach. If a model is marked blocked on this page, the gateway will reject requests for it while the policy is active — the page and the enforcement share one implementation.

Compliance eligibility requires an active policy, available on the **Enterprise plan**; without one, the directory simply lists everything. Custom-model management (pricing, limits, attestations) stays owner/admin-only and moved below the directory.

---

**[Org Models Directory docs →](https://docs.llmgateway.io/features/models-directory)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
