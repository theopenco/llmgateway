---
id: "104"
slug: "branded-end-user-receipts"
date: "2026-09-25"
title: "Branded Payments SDK Receipts"
summary: "End-users who buy credits in your app now get a receipt led by your brand, with your support address and a card statement that reads LLMGTWY* YOURBRAND instead of ours. Refunds send a matching credit note. Available on Payments SDK projects, which are in preview."
tags: ["llmgateway", "airside"]
image:
  src: "/changelog/branded-end-user-receipts.png"
  alt: "A glowing receipt on a circuit-board chip surrounded by card and envelope icons, representing branded end-user receipts on LLM Gateway"
  width: 1536
  height: 1024
---

When someone buys credits inside your app with the Payments SDK, they have
never heard of us — they bought from you. Until now the only payment email
they got came from LLM Gateway, and their card statement said `LLMGTWY`. That
reads like a charge they never made, and the support ticket lands on your desk.
**Branded receipts** put your name on both.

## Three fields, set once per project

Open **Settings → Payments SDK** on the project and fill in the new
**Receipts & branding** section. Every successful top-up then emails the
end-user a receipt with a PDF attached, and refunds send a matching credit note.

| Field                    | Appears as                                                               |
| ------------------------ | ------------------------------------------------------------------------ |
| **Brand name**           | The heading of the receipt email and the seller named on the PDF         |
| **Support email**        | The first contact address on the receipt, above ours                     |
| **Statement descriptor** | Appended to our prefix on the cardholder's statement: `LLMGTWY* ACME AI` |

The brand name falls back to the project name, so a project that sets nothing
still sends something recognisable. The statement descriptor is capped at 13
characters — card networks allow 22 in total and our prefix takes the rest —
and it is normalized when you save, so the preview in the dashboard is exactly
what the cardholder sees.

We remain the merchant of record, so the receipt still names us and carries our
billing contact. Your brand leads it; we explain who processed the payment.

## Receipts need an email address

We can only send a receipt to an address we have, and the end-customer email is
optional when you mint a session. Pass it and the receipt goes out:

```bash
curl https://api.llmgateway.io/v1/sessions \
  -H "Authorization: Bearer $LLM_GATEWAY_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"externalId":"user_123","email":"user@example.com"}}'
```

A bare `"customer": "user_123"` leaves the end-customer without an email and no
receipt is sent. Supplying it on a later session now updates the stored record,
so an integration that started without one can add it without losing history.
Test-mode wallets never receive receipts, matching Stripe's own behaviour for
sandbox payments.

## Airside listing fees are receipted too

Carriers paying the one-time Airside listing fee previously got nothing from us
directly. They now receive a plain LLM Gateway receipt with a PDF, the same as
any other direct purchase — no brand, and none of the merchant-of-record
explanation, which only belongs on a receipt where the payer bought from
somebody else.

Branded receipts are available on projects with the **Payments SDK** enabled,
which is in preview and opt-in per project.

---

**[Embeddable Payments docs →](https://docs.llmgateway.io/features/embeddable-payments)** | **[Configure your project →](https://llmgateway.io/dashboard)**
