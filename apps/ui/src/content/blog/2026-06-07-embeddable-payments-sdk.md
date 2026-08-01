---
id: blog-embeddable-payments-sdk
slug: embeddable-payments-sdk
date: 2026-06-07
title: "Stripe for AI: Embeddable Payments for Your App"
summary: Our new Payments SDK lets your end-users buy credits inside your app and pay per request for any model — billed through LLM Gateway, with your markup as margin. Here's how it works and how to ship it in ~40 lines.
categories: ["Engineering"]
image:
  src: "/blog/embeddable-ai-credits.png"
  alt: "A digital wallet streaming credit tokens into an AI chat interface"
  width: 1024
  height: 1024
---

If you're building an AI feature into your product, you hit the same two problems fast: **how do your users pay for the AI they use**, and **how do you not rebuild billing, wallets, and model plumbing from scratch?**

Today we're shipping the **Payments SDK** — think Stripe + Stripe Elements, but for AI. It's a payments product, not a normal AI client SDK like the OpenAI SDK: it embeds end-user **payments and sessions** into your own site. Your end-users get their own wallet, buy credits **inside your app**, and pay per request for any model the gateway supports. LLM Gateway is the merchant of record, you set a markup, and the margin is yours.

<video src="/blog/llmgateway-topup-flow.webm" controls autoplay muted loop playsinline style="width: 100%; border-radius: 12px; margin: 1.5rem 0;">
  Your browser does not support the video tag.
</video>

## The model: platform wallets

Most "add AI to your app" stories assume _you_ eat the model cost and reconcile it later. We wanted the opposite: each of **your** users holds their own balance, tops it up themselves, and is billed per request — while you earn a margin on top.

So the Payments SDK is built around three ideas:

1. **Per-end-user wallets.** Every one of your users has a wallet with a real USD balance, separate from your org credits.
2. **Markup at top-up time.** You set a markup percent. When a user buys $10 of credits, their wallet is credited the net spend power and your margin accrues to your organization for payout. The per-request path stays simple — it just debits raw cost.
3. **Browser-safe sessions.** Your secret key never touches the browser. Your backend mints a short-lived, scoped **session token** (`es_…`) bound to one wallet; the browser uses only that.

```
Your backend ──(sk_)──▶ POST /v1/sessions ──▶ es_ token (~15 min, scoped to one wallet)
        │                                              │
        └──────── returns es_ to your frontend ◀───────┘
                              │
   Browser (es_) ──▶ chat / images / embeddings ──▶ debits that user's wallet
                 └──▶ buy credits (Stripe Elements) ─▶ net credited, your margin accrues
```

## Three packages

- **`@llmgateway/server`** — your backend, holds the secret key. Mints sessions, manages wallets/customers, verifies webhooks, triggers payouts.
- **`@llmgateway/client`** — a headless, browser-safe client (chat/stream/image/embeddings + balance/top-up) with automatic session refresh.
- **`@llmgateway/elements`** — React drop-ins: `<Chat/>`, `<BuyCredits/>`, `<CreditBalance/>`, plus `useBalance`/`useChat`.

## Shipping it in ~40 lines

**Backend — mint a session with your secret key:**

```ts
// app/api/llmgateway/session/route.ts
import { LLMGateway } from "@llmgateway/server";

const lg = new LLMGateway({ secretKey: process.env.LLMGATEWAY_SECRET_KEY! });

export async function POST() {
  const session = await lg.sessions.create({
    customer: { externalId: "user_123" }, // your signed-in user
    scope: { models: ["openai/gpt-4o-mini"] }, // lock down what they can call
  });
  return Response.json(session); // { sessionToken, walletId, endCustomerId, expiresAt, publishableKey }
}
```

**Frontend — drop in the widgets:**

```tsx
"use client";
import {
  LLMGatewayProvider,
  Chat,
  CreditBalance,
  BuyCredits,
} from "@llmgateway/elements";

const fetchSession = () =>
  fetch("/api/llmgateway/session", { method: "POST" }).then((r) => r.json());

export default function App({ session }) {
  return (
    <LLMGatewayProvider
      session={session}
      fetchSession={fetchSession}
      mode={process.env.NODE_ENV === "production" ? "prod" : "test"}
    >
      <CreditBalance /> {/* live wallet balance */}
      <BuyCredits amount={10} />{" "}
      {/* Stripe checkout → credits land in the wallet */}
      <Chat model="openai/gpt-4o-mini" />{" "}
      {/* streams, debits the wallet per request */}
    </LLMGatewayProvider>
  );
}
```

That's the whole integration. The session token auto-refreshes before it expires, `<BuyCredits>` loads LLM Gateway's bundled Stripe publishable key, confirms the payment, and the balance updates once the webhook credits the wallet. Pass `mode="test"` while developing to use Stripe test mode (`"prod"` is the default); you don't need to ship a Stripe publishable key of your own for LLM Gateway payments.

## Safe by default

- **Your secret key never leaves your server.** The browser only ever holds a short-lived, revocable session token scoped to a single wallet.
- **Sessions are scoped.** Lock each one to an allow-list of models and an optional per-session spend cap, and restrict which browser origins can reach the gateway.
- **Top-ups can't double-credit.** A wallet is credited exactly once per payment, even if Stripe re-delivers the webhook.
- **Webhooks are signed and SSRF-safe.** Events are signed so you can verify them, and only public HTTPS endpoints can be registered.

## Try it

There's a complete, runnable Next.js example — backend session route, provider, chat, and buy-credits — in the templates repo:

➡️ **[theopenco/llmgateway-templates → templates/embeddable-credits](https://github.com/theopenco/llmgateway-templates/tree/main/templates/embeddable-credits)**

Full reference is in the [Embeddable Payments docs](https://docs.llmgateway.io/features/embeddable-payments). Embeddable Payments is currently in preview and opt-in only — [contact us](mailto:contact@llmgateway.io) to enable it for your project. Once it's on, open your project's **Settings → Payments SDK** to enable end-user sessions and create a platform secret key — and you can be live in an afternoon.
