---
id: "devpass-vs-alibaba-qwen-coding"
slug: "alibaba-qwen-coding"
date: "2026-09-27"
title: "DevPass vs Alibaba Cloud Coding Plan"
metaTitle: "DevPass vs Alibaba Cloud Coding Plan: Pricing and Limits (2026)"
description: "Compare Alibaba Cloud’s international $50 Pro Coding Plan, request quotas, eligibility, and billing boundaries with DevPass’s monthly coding plans."
competitor: "Alibaba Cloud Coding Plan"
competitorLogo: "qwen"
competitorTagline: "Request-based coding subscription"
tagline: "Alibaba’s international Pro plan counts requests across several windows. DevPass meters model usage in dollars."
devpassPrice: "$29–$179/mo"
competitorPrice: "$50/mo international Pro"
verdict: "Alibaba Cloud’s international Pro plan suits supported interactive coding workloads that fit its request quotas and live catalog. DevPass suits developers who prefer a dollar allowance across its coding catalog. A request quota is not a prompt count or a token allowance, and agent tasks may make several requests."
features:
  - label: "International monthly plan"
    devpass: "$29–$179"
    competitor: "$50 Pro"
  - label: "Entry tier"
    devpass: "Lite available"
    competitor: "Lite no longer sold"
  - label: "Usage measurement"
    devpass: "Model usage in dollars"
    competitor: "API requests"
  - label: "Plan limits"
    devpass: "Monthly allowance + premium weekly limits"
    competitor: "6,000 / 5 hours; 45,000 / week; 90,000 / month"
  - label: "Catalog"
    devpass: "Live DevPass coding catalog"
    competitor: "Qwen and selected partner models"
  - label: "Access credentials"
    devpass: "DevPass endpoint and key"
    competitor: "Dedicated Coding Plan endpoint and key"
  - label: "Use scope"
    devpass: "One developer; coding plan terms apply"
    competitor: "One user; interactive coding, not backend automation"
faqs:
  - question: "Is Alibaba Coding Plan still available on Lite?"
    answer: "The international documentation says Lite stopped accepting new subscriptions on March 20, 2026, with renewals and upgrades stopped on April 13. Existing plans last until their expiry. The currently offered Pro plan costs $50/month."
  - question: "How many prompts does the Pro plan include?"
    answer: "Its quota counts API requests, not user prompts. Pro permits 6,000 requests per five hours, 45,000 per week, and 90,000 per month. All limits apply, and one agent task can generate several requests."
  - question: "Can I use a normal Alibaba API key?"
    answer: "The subscription requires its dedicated Coding Plan key and endpoint. Standard Model Studio API access is separately billed pay as you go."
  - question: "Can the plan run production backend jobs?"
    answer: "The Coding Plan documentation restricts it to supported interactive coding tools for one user. It excludes automated backend use and sharing. Check the standard API product for those workloads."
---

## International Pro pricing

Alibaba Cloud’s international [Coding Plan documentation](https://www.alibabacloud.com/help/en/model-studio/coding-plan) lists **Pro at $50/month**. Lite is no longer sold or renewed. Subscription slots are limited and restock daily; availability is not guaranteed.

Pro includes **6,000 requests per five hours, 45,000 per week, and 90,000 per month**. All three windows apply. An agent may make multiple model calls for one user task, so the monthly figure is not a count of completed prompts or coding jobs.

## Scope and billing boundaries

The plan includes Qwen and selected partner models; consult its live catalog instead of assuming it is Qwen-only. Use the dedicated Coding Plan endpoint and key. Requests sent through standard API billing are not covered by the subscription.

The plan is for one user’s interactive coding in supported tools, excluding backend automation and key sharing. Mainland China offers and prices differ from the international plan compared here. **Choose Alibaba’s plan** when its catalog, quotas, and availability fit; **choose DevPass** for a dollar-metered coding allowance across its live catalog.

## DevPass pricing and limits

DevPass costs **$29/month for Lite, $79 for Pro, or $179 for Max**, for one developer. As of September 27, these plans include $87, $237, and $537 of monthly model usage respectively, with separate premium weekly fair-use limits. Optional pay-as-you-go overflow costs extra.

**Plan changes start October 15, 2026:** new subscriptions begin at 2× the plan price in monthly usage; existing subscriptions move to 2× at their first renewal on or after that date. Daily caps, tighter premium weekly caps, and revised Reset Pass benefits take effect October 15, including within existing billing cycles. Read the [plan-change terms](/legal/terms#october-2026-plan-changes) before subscribing.

Compare the live [coding catalog](/coding-models) and [plan details](/pricing). Client support depends on the API and custom-endpoint features of the coding tool; a DevPass key does not unlock every feature of a third-party editor.
