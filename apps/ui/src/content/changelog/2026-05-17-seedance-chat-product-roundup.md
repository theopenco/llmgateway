---
id: "48"
slug: "seedance-chat-product-roundup"
date: "2026-05-17"
title: "Seedance Video Models, Pinned Chats, Sharing Across Orgs & More"
summary: "ByteDance Seedance video models land in the gateway, Chat gets pinning and cross-org sharing, plus vertex-anthropic, grok-4.20, and a stack of fixes."
image:
  src: "/changelog/seedance-video-models.png"
  alt: "LLM Gateway now supports all ByteDance Seedance video generation models"
  width: 1024
  height: 1024
---

## ByteDance Seedance Video Generation

LLM Gateway now supports the full **ByteDance Seedance** family — three models for text-to-video, image-to-video, and reference-image generation through the same API key you use for chat.

```bash
bytedance/seedance-2-0          # high-quality text & image-to-video
bytedance/seedance-2-0-fast     # accelerated, faster turnaround
bytedance/seedance-1-5-pro      # complex instructions + native audio
```

- Supported resolutions: 1280×720, 720×1280, 1920×1080, 1080×1920
- Supported durations: 5s and 10s
- Native audio generation on `seedance-1-5-pro` (toggle via `generate_audio`)
- Auto-select routes to the cheapest healthy provider — or pin to ByteDance directly

**[Browse video models →](https://llmgateway.io/models?filters=1&video=true)** | **[Read the announcement →](/blog/seedance-video-generation)**

---

## Chat Product Updates

### Pin Important Chats

Keep your most-used conversations one click away. The chat sidebar now has a dedicated **Pinned** section that floats above the date groups.

<img src="/changelog/pinned-chats.jpg" alt="Pin important chats in LLM Gateway Chat" width="1024" height="1024" />

- Pin/unpin from the chat row menu
- Pinned chats stay grouped at the top, unpinned chats keep their date grouping
- Mobile sidebar now auto-closes on selection — fewer taps to get back to the conversation

### Share Chats Across Organizations

If you belong to more than one org, a single share link can now reach all of them.

<img src="/changelog/share-chats-across-orgs.png" alt="Share chats across multiple LLM Gateway organizations" width="1024" height="1024" />

- Pick any subset of your orgs in the share dialog
- One link works across every selected org — no duplicating chats per workspace
- Set "anyone with the link" or restrict to org members
- One-click share to X, LinkedIn, and Reddit

### Team Chat List

A new **team chat list** view surfaces chats shared inside your organization — great for spotting what teammates are exploring and reusing prompts that already work.

### Canvas Wrap-Up

[Canvas](https://chat.llmgateway.io) graduated from preview. The JSON editor and live preview now ship with six chart types (bar, line, area, pie, radar, radial bar), streaming AI spec generation, PNG and PDF export, and reusable Card and Chart primitives. Canvas now has its own entry in the sidebar across mobile and desktop.

### Smarter Model Selector

The model picker got a refresh — clearer filters, faster search, and a cleaner provider grid for the 200+ models you can route to.

---

## New Models & Providers

### Grok 4.20 via Vertex AI

```bash
xai/grok-4.20
```

xAI's Grok 4.20 is now available through the Vertex AI OpenAI-compatible endpoint — useful for teams already standardized on Google Cloud billing and IAM.

### Vertex Anthropic Provider

A dedicated **vertex-anthropic** provider is live for routing Claude models through Vertex AI. Bring your own Google Cloud project and serve Claude with Vertex billing, regions, and quotas. The UI now shows the right Vertex logo for `vertex-anthropic` and `vertex-openai` mappings.

---

## Onboarding

- **Optional name on signup** — Sign-up now captures an optional display name. If you skip it, the gateway falls back to the local part of your email so dashboards and invites don't show "anonymous user."

---

## Fixes & Reliability

- **Anthropic**: gateway now respects the caller's requested `max_tokens` instead of capping at the legacy 1024 default
- **Worker**: collapsed three sequential history scans into one — faster activity log loads on busy projects
- **Playground**: share-index threshold now scans every turn, JSON-LD is properly escaped, and the sitemap routes through the typed API client
- **UI**: org switcher and share-chat dialog are now responsive on small screens
- **Security**: bumped `jspdf` (GHSA-p5xg-68wr-hm3m) and patched additional high-severity Dependabot alerts
- **Routing**: increased price weight in the auto-select scoring so cost-equivalent providers tie-break toward the cheaper option

---

**[Try Chat →](https://chat.llmgateway.io)** | **[Generate a video →](https://docs.llmgateway.io/features/video-generation)** | **[Browse all models →](https://llmgateway.io/models)**
