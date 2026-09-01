---
id: "82"
slug: "devpass-card-removal"
date: "2026-08-28"
title: "Remove Your DevPass Payment Card"
summary: "DevPass subscribers can now remove their saved card after canceling, or whenever a subscription is inactive. The card details leave Stripe while a privacy-safe fingerprint remains to enforce the one-card-per-account rule."
image:
  src: "/changelog/devpass-card-removal.png"
  alt: "A payment card lifting away from a circuit board while a glowing fingerprint shield remains"
  width: 1536
  height: 1024
---

Canceling a subscription should not mean leaving its payment card attached indefinitely. **DevPass payment card removal** now lets you detach the saved card as soon as your subscription is scheduled to end, has already ended, or never became active.

## Remove the Card, Keep the Protection

Open **Billing → Payment method** after canceling and select **Remove card**. Removal clears the card from the subscription and Stripe customer, detaches it from Stripe, deletes the local payment-method record, and disables automatic credit reloads.

LLM Gateway never stores the card number. We retain only Stripe's stable card fingerprint — an identifier that contains no card details — so the same card cannot be used to claim DevPass through another account. If an account is deleted and the card needs to be reused legitimately, support can release that fingerprint after confirming there is no remaining subscription.

If the canceled subscription is still within its current billing period, add a payment method before resuming it. Card removal is available on **every DevPass tier**.

---

**[Billing docs →](https://docs.llmgateway.io/learn/billing)** | **[Open DevPass billing →](https://devpass.llmgateway.io/dashboard/billing)**
