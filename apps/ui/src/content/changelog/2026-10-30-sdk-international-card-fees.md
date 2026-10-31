---
id: "119"
slug: "sdk-international-card-fees"
date: "2026-10-30"
title: "Correct Card Fees in SDK Checkout"
summary: "Payments SDK checkout now applies the separate international-card surcharge and shows the full fee breakdown before payment confirmation."
tags: ["llmgateway"]
image:
  src: "/changelog/sdk-international-card-fees.png"
  alt: "Payments SDK checkout card fees and payment review"
  width: 1200
  height: 630
---

Payments SDK checkout previously skipped the international-card surcharge. **Card-priced checkout** now adds the separate 1.5% fee for cards issued outside the United States, alongside the existing 5% platform fee. US-issued cards still pay only the platform fee.

## Review the total before paying

Checkout collects the card first, then shows the credits, platform fee, international card fee when applicable, and final charge. Fees do not reduce wallet credits, developer markup margin, or configured bonus credits.

Embeddable Payments remains **opt-in preview**. Integrations must upgrade the client and Elements packages for the new card-first quote and server-confirmation flow; headless integrations pass a Stripe payment method to `createTopUp` and confirm the reviewed quote with `confirmTopUp`. Older calls without a payment method are rejected.

---

**[Checkout integration docs →](https://docs.llmgateway.io/features/embeddable-payments#buying-credits)** | **[Payments SDK settings →](https://llmgateway.io/dashboard)**
