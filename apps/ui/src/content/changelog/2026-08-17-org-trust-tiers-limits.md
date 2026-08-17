---
id: "78"
slug: "org-trust-tiers-limits"
date: "2026-08-17"
title: "Trust Tiers: Limits That Grow With Your Account"
summary: "Every organization now has transparent per-endpoint rate limits, daily/monthly spend caps, and top-up allowances that scale automatically with account age or lifetime usage — all visible on the new Settings → Limits page. Enterprise organizations have no limits at all."
image:
  src: "/changelog/org-trust-tiers-limits.png"
  alt: "The new Settings → Limits page showing an organization's trust tier, spend caps, top-up allowance, and what it takes to reach the next tier"
  width: 1440
  height: 1150
---

Card testers and abuse rings hammer new accounts; legitimate teams grow steadily. The gateway now tells them apart with **trust tiers**: every organization starts with sensible limits that rise automatically as the account ages or accumulates real usage — no support ticket required.

## One Ladder, Three Kinds Of Limits

Your tier is determined by **account age, or lifetime usage spend combined with a minimum account age**. It drives three things at once:

| Tier | Qualifies (age, or spend + min age) | Rate multiplier | Daily / monthly spend cap | Top-up per 24h |
| ---- | ----------------------------------- | --------------- | ------------------------- | -------------- |
| 0    | new                                 | 1×              | $25 / $250                | $100           |
| 1    | 7 days **or** $10 (≥ 1 day)         | 2×              | $100 / $1,000             | $500           |
| 2    | 30 days **or** $100 (≥ 3 days)      | 4×              | $500 / $5,000             | $2,500         |
| 3    | 60 days **or** $1,000 (≥ 7 days)    | 10×             | $5,000 / $50,000          | $10,000        |
| 4    | 90 days **or** $5,000 (≥ 14 days)   | 20×             | $15,000 / $200,000        | $20,000        |

- **Per-endpoint rate limits.** Every `/v1` endpoint has a generous per-organization requests-per-minute budget, multiplied by your tier.
- **Spend caps.** Daily and monthly USD ceilings on paid usage. Free models never count.
- **Top-up allowances.** How much you can add to your credit balance per rolling 24-hour window.

Qualifying spend is **net of refunds** — refunded or clawed-back payments never raise limits, and a refunded top-up still counts against the 24-hour top-up window. Spend alone never promotes a brand-new account: each spend-qualified tier also requires the minimum account age shown above.

## See Exactly Where You Stand

The new **Settings → Limits** page shows your current tier, live spend versus each cap, your top-up allowance, and precisely what's missing for the next tier — wait N more days, or grow usage once your account is old enough.

## Enterprise: No Limits

Organizations on the Enterprise plan are fully exempt — no rate limits, no spend caps, no top-up limits. Throughput is bounded only by your credit balance and upstream providers.

**[Rate limits docs →](https://docs.llmgateway.io/resources/rate-limits)** | **[Contact us about Enterprise →](https://llmgateway.io/enterprise)**
