---
id: "83"
slug: "hash-only-key-storage"
date: "2026-08-27"
title: "Hash-Only API Key Storage"
summary: "Gateway API keys are now stored only as keyed HMAC-SHA-256 fingerprints and provider credentials only as AES-256-GCM ciphertext. Every plaintext read path is gone, so a key's secret is visible exactly once per issuance — at creation or roll."
image:
  src: "/changelog/hash-only-key-storage.png"
  alt: "Hash-only key storage: a glowing key dissolving into a fingerprint pattern on a circuit board"
  width: 1536
  height: 1024
---

A dashboard that can re-display an API key you created last month is telling you something about its database: the secret is sitting there in readable form. **Hash-only key storage** removes that property from LLM Gateway. Gateway API keys are stored solely as keyed HMAC-SHA-256 fingerprints, and the remaining plaintext read paths — for API keys, provider credentials, and end-user sessions — have been deleted.

## The Secret Is Shown Once

When you create or roll a key, the full secret appears once in the dialog. Copy it then. The dashboard, the keys API, and support can no longer recover it, because nothing stores it: authentication fingerprints the secret you present and compares the result. A masked preview is kept so you can still tell keys apart in the list.

The payoff is what a database dump is worth: fingerprints cannot be replayed against the gateway, so a copy of the keys table is no longer a copy of your keys.

If a key is lost, **Roll Key** issues a new secret and keeps everything else — the name, usage history and statistics, all-time and recurring limits including the current period window, IAM rules, and expiration.

## Provider Credentials

Bring-your-own-provider keys are a different problem: the gateway has to recover them to call the upstream, so they are encrypted at rest with AES-256-GCM rather than hashed. Requests now fail closed when a credential is missing its ciphertext instead of falling back to a plaintext column.

## Self-Hosting

Both protections derive from one variable, set to the same value on every service:

```bash
GATEWAY_API_KEY_HASH_SECRET=$(openssl rand -base64 32)
```

To rotate, prepend a new secret to the comma-separated keyring on every service and retain the old entries while credentials and fingerprints still reference them. Authentication checks every retained entry, while new fingerprints and ciphertext use the first. Removing an entry too early makes its provider credentials undecryptable and its remaining keys unusable.

---

**[API keys docs →](https://docs.llmgateway.io/features/api-keys)** | **[Self-hosting setup →](https://docs.llmgateway.io/self-host/docker-compose)**
