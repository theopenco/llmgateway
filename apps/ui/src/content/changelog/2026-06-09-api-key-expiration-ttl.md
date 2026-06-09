---
id: "53"
slug: "api-key-expiration-ttl"
date: "2026-06-09"
title: "API Key Expiration (TTL)"
summary: "Give any API key a time-to-live when you create it — minutes, hours, or days. Expired keys are disabled automatically, and you can bring them back online anytime with a fresh expiration."
image:
  src: "/changelog/api-key-expiration-ttl.png"
  alt: "API key expiration with TTL on LLM Gateway"
  width: 1536
  height: 1024
---

API keys can now expire on a schedule. Set a **time-to-live (TTL)** when you create a key and it will be disabled automatically once the clock runs out — perfect for short-lived integrations, demos, CI runs, and temporary access.

## Set a TTL on Creation

When creating an API key, flip on **Set expiration (TTL)** and choose how long it should live:

- Pick a value and a unit — **minutes**, **hours**, or **days**
- The key works normally until it expires
- Leave it off for a key that never expires (the default)

## Automatic Expiration

Once a key's expiration passes, it's disabled — no manual cleanup required:

- The gateway rejects expired keys immediately with a `401 Unauthorized`
- A background job flips expired keys to **inactive**, so the dashboard always reflects reality

## Reactivate With a Fresh Expiration

An expired key isn't gone — it's just paused. To bring it back online, reactivate it and set a **new future expiration**. This keeps short-lived keys short-lived: you can't accidentally revive an expired key without consciously extending its lifetime.

Keys with no TTL, or whose TTL is still in the future, can be enabled and disabled as before.

---

**[Open your dashboard →](https://llmgateway.io/dashboard)** | **[Read the API Keys docs →](https://docs.llmgateway.io/features/api-keys)**
