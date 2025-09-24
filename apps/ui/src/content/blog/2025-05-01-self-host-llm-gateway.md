---
id: blog-self-host-llm-gateway
slug: how-to-self-host-llm-gateway
date: 2025-05-01
title: How to Self-Host LLM Gateway
summary: Deploy LLM Gateway locally or in the cloud using our unified Docker image or split services.
categories: ["Guides"]
image:
  src: "/blog/how-to-self-host-llm-gateway.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

## Option 1: Unified Docker Image (Easiest)

```bash
docker run -d \
  --name llmgateway \
  --restart unless-stopped \
  -p 3002:3002 -p 3003:3003 -p 3005:3005 -p 4001:4001 -p 4002:4002 \
  -v ~/llmgateway_data:/var/lib/postgresql/data \
  -e AUTH_SECRET=your-secret-key-here \
  ghcr.io/theopenco/llmgateway-unified:latest
```

Prefer pinning the image to the latest release tag. You can also run it via Docker Compose.

## Option 2: Split Services via Docker Compose

```bash
git clone https://github.com/theopenco/llmgateway.git
cd llmgateway
cp .env.example .env
# edit .env
docker compose -f infra/docker-compose.split.yml up -d
```

### Access

- Web: http://localhost:3002
- Docs: http://localhost:3005
- API: http://localhost:4002
- Gateway: http://localhost:4001

See the full guide: [`Self Host`](https://raw.githubusercontent.com/theopenco/llmgateway/refs/heads/main/apps/docs/content/self-host.mdx).
