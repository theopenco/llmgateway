---
id: "66"
slug: "devpass-reset-passes"
date: "2026-07-16"
title: "DevPass Reset Passes"
summary: "Hit your weekly premium allowance mid-sprint? A Reset Pass instantly restores the full allowance and starts a fresh 7-day window. Pro includes 1 pass per cycle and Max includes 2; extra passes are a one-time purchase from the DevPass dashboard."
image:
  src: "/changelog/devpass-reset-passes.png"
  alt: "DevPass Reset Passes: a glowing visa-stamp seal on a circuit board, representing an instant reset of the weekly premium model allowance"
  width: 1536
  height: 1024
---

Every DevPass plan includes a weekly fair-use allowance for premium frontier models. Until now, using it up mid-sprint left two options: switch to standard models until the rolling 7-day window reset, or upgrade a tier. **Reset Passes** add a third — redeem a pass and your full weekly premium allowance is back immediately, with a fresh 7-day window that starts on your next premium request.

## Stamp a fresh week

The DevPass dashboard now shows a Reset Pass card — styled as a stamped visa extension in your DevPass passport — right under the premium allowance meter. It holds your passes as stamps: plan-included passes and purchased ones. One click on **Use a pass** zeroes the week's premium usage on the spot. A pass removes the weekly limit only — it doesn't add credits, so premium usage after a reset draws from your monthly allowance exactly as before. Standard models are unaffected either way, since they never count against the weekly cap.

| Plan | Included per cycle | Extra passes |
| ---- | ------------------ | ------------ |
| Lite | —                  | $9 each      |
| Pro  | 1                  | $29 each     |
| Max  | 2                  | $79 each     |

Included passes refresh with every billing cycle and don't roll over; they're always consumed before purchased ones. Purchased passes are bound to the tier they were bought for and never expire — an unused pass is still there whenever you're back on that tier, even after a cancelled plan.

## Buy in one click, invoiced like everything else

Extra passes are a one-time purchase from the same card — no subscription change, no proration. Each purchase emails a PDF invoice and appears in your DevPass billing history alongside plan charges.

If you hit the cap from your coding agent, the gateway's error now points the way:

```json
{
  "error": {
    "message": "You've used your weekly allowance for premium-tier models on the pro plan. Redeem a Reset Pass from your dashboard for an instant reset, upgrade for a higher allowance, or use any standard model now. Resets in 6 days.",
    "type": "invalid_request_error",
    "code": "billing_error"
  }
}
```

If you're reaching for a Reset Pass every week, upgrading a tier is usually the better deal — the next tier raises the weekly cap itself and brings a bigger monthly allowance with it.

---

**[Model categories & fair use →](https://docs.llmgateway.io/learn/model-categories)** | **[DevPass pricing →](https://devpass.llmgateway.io/pricing)**
