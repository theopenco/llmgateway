---
id: "74"
slug: "moderations-flat-request-pricing"
date: "2026-08-03"
title: "Moderations Pricing From August 7"
summary: "Starting Friday, August 7, 2026, the /v1/moderations endpoint is billed at a flat $0.00001 per successful request — no token metering, no per-model rates, and no charge for failed or retried attempts. Because it becomes paid, it also starts requiring a credit balance: top up before August 7 or moderation stops working for organizations with no credits."
image:
  src: "/changelog/moderations-flat-request-pricing.png"
  alt: "A circuit board with a glowing shield on the central chip surrounded by coin and checkmark icons, representing per-request moderation pricing"
  width: 1536
  height: 1024
---

Safety classification is cheap upstream but not free to serve: every moderation call still goes through routing, key rotation, logging, and retention like any other request. So far `/v1/moderations` has been recorded at zero cost, which left the request handling unpriced and made moderation traffic invisible in spend analytics. From **Friday, August 7, 2026**, the moderations endpoint is billed at a **flat $0.00001 per successful request**. Until that date, moderation requests stay free.

## What Changes On August 7

| Behavior           | Today               | From August 7                          |
| ------------------ | ------------------- | -------------------------------------- |
| Successful request | $0                  | $0.00001, regardless of input size     |
| Failed request     | $0                  | $0                                     |
| Retried attempt    | $0                  | $0 — only the successful attempt bills |
| Moderation model   | No effect on price  | No effect on price                     |
| `api-keys` mode    | No credits deducted | No credits deducted                    |

The price is per request, not per input item and not per token: classifying one string and classifying a batch of fifty cost the same. Every moderation model the endpoint accepts, including `omni-moderation-latest`, bills at that same flat rate.

## Action Required: Keep Credits Topped Up

Because the endpoint becomes paid, it also starts requiring a credit balance.
**From August 7, moderation requests from an organization with no credits are
rejected with `402` and the endpoint stops working** until you top up. If you
have been using `/v1/moderations` on a zero-credit organization because it was
free, add credits before August 7 to avoid an interruption.

Projects in `api-keys` mode that serve moderation with their own OpenAI key are
not affected and need no balance.

## Nothing To Change In Your Code

The request and response shapes are unchanged, and no migration is needed:

```bash
curl https://api.llmgateway.io/v1/moderations \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "input": "I want to harm someone."
  }'
```

At 100,000 moderation calls that is $1.00 in total. Requests served with your own OpenAI key in `api-keys` mode will continue to deduct no credits — the cost is recorded on the log for visibility only.

Once the price takes effect, moderation calls carry a real per-request cost in your activity logs and cost breakdowns, so moderation spend is attributable per project and per API key like the rest of your traffic.

---

**[Moderations docs →](https://docs.llmgateway.io/features/moderations)** | **[View your usage →](https://llmgateway.io/dashboard)**
