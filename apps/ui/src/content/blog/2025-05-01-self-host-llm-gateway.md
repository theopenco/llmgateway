---
id: blog-self-host-llm-gateway
slug: how-to-self-host-llm-gateway
date: 2025-05-01
title: How to Self-Host LLM Gateway
summary: Run LLM Gateway on your own infrastructure in under 5 minutes. Full control, zero platform fees.
categories: ["Guides"]
faqs:
  - question: "How do I self-host LLM Gateway?"
    answer: "Run the unified Docker image for a single-command setup, or use Docker Compose to run the services separately when you want to scale or debug them individually. Pin a specific release tag in production to avoid unexpected updates."
  - question: "Why self-host LLM Gateway?"
    answer: "Self-hosting means no platform fees on your API spend, the gateway and its logs run on your own infrastructure, and you can modify the code to fit your needs. Requests are still sent to the model providers you call."
image:
  src: "/blog/how-to-self-host-llm-gateway.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

Want full control over your LLM infrastructure? Self-host LLM Gateway on your own servers—keep your data in-house, avoid platform fees, and customize everything. Here's how to get running in under 5 minutes.

## Option 1: Unified Docker Image (Easiest)

```bash
docker run -d \
  --name llmgateway \
  --restart unless-stopped \
  -p 3002:3002 -p 3003:3003 -p 3005:3005 -p 3006:3006 -p 4001:4001 -p 4002:4002 \
  -v ~/llmgateway_data:/var/lib/postgresql/data \
  -e AUTH_SECRET=your-secret-key-here \
  -e GATEWAY_API_KEY_HASH_SECRET=your-api-key-hash-secret-here \
  ghcr.io/theopenco/llmgateway-unified:latest
```

One command. All services. Running in seconds.

> **Tip:** Pin to a specific release tag (e.g., `v1.2.3`) in production to avoid unexpected updates.

## Option 2: Split Services via Docker Compose

For more control over individual services (useful for scaling or debugging):

```bash
git clone https://github.com/theopenco/llmgateway.git
cd llmgateway
cp .env.example .env
# edit .env
docker compose -f infra/docker-compose.split.yml up -d
```

### Access Your Instance

Once running, your services are available at:

| Service    | URL                   | Description                    |
| ---------- | --------------------- | ------------------------------ |
| Web UI     | http://localhost:3002 | Dashboard and analytics        |
| Playground | http://localhost:3003 | Chat playground                |
| Docs       | http://localhost:3005 | Local documentation            |
| Admin      | http://localhost:3006 | Platform administration        |
| API        | http://localhost:4002 | Management API                 |
| Gateway    | http://localhost:4001 | LLM request gateway (use this) |

## What You Get

Self-hosting gives you:

- **Zero platform fees** — No percentage taken from your API spend
- **Data sovereignty** — All requests stay on your infrastructure
- **Unlimited customization** — Modify the codebase to fit your needs
- **Same features** — Analytics, caching, and routing work just like the hosted version

For the full setup guide with environment configuration and production tips, see the [Self-Host documentation](https://docs.llmgateway.io/self-host).

<BlogCta variant="gateway" location="bottom" />
