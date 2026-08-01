---
id: "43"
slug: "video-gen-sessions-and-more"
date: "2026-03-23"
title: "Video Generation, Sessions & More"
summary: "Generate videos via the API, track conversations with sessions, and more — plus new models and providers."
image:
  src: "/changelog/video-gen-update.png"
  alt: "Video generation and sessions now available on LLM Gateway"
  width: 1768
  height: 677
---

## Video Generation

LLM Gateway now supports **video generation** via the API. Generate videos from text prompts using supported models, with job-based async processing and status tracking.

- Submit a video generation request and receive a job ID
- Poll for job status — completed jobs return the video URL
- Failed jobs are properly marked with error details

**[Read the video generation docs](https://docs.llmgateway.io/features/video-generation)**

---

## Agents (formerly Sessions)

**Agents** let you track and organize conversations across multiple requests:

- Group related requests by coding agent
- Filter activity logs by agent
- View streaming cost breakdowns per agent
- Improved empty state UI when no agents exist

---

## New Models

### GPT-5.4 Mini & Nano

```bash
openai/gpt-5.4-mini
openai/gpt-5.4-nano
```

OpenAI's smaller GPT-5.4 variants are now available — offering the same architecture at lower cost for lighter workloads.

**[View GPT-5.4 Mini](/models/gpt-5.4-mini)** | **[View GPT-5.4 Nano](/models/gpt-5.4-nano)**

### MiniMax M2.7

```bash
minimax/minimax-m2.7
```

New MiniMax M2.7 model mappings added across providers.

**[View MiniMax M2.7](/models/minimax-m2.7)**

---

## New Provider: EmberCloud

**[EmberCloud](/providers/embercloud)** is now available as a provider, expanding your routing options with additional model coverage.

---

## UI & Platform Improvements

- **[Redesigned Code app](https://devpass.llmgateway.io)** — Fresh look for the dev plans and coding tools dashboard
- **Revamped admin dashboard** — Improved performance on models, mappings, and providers pages
- **[Cost simulator](/cost-simulator) revamp** — Updated cost simulator with better navigation
- **Activity log filters** — Improved filtering in activity logs
- **Status page indicator** — Quick link to the status page from the dashboard
- **[OpenCode support](https://docs.llmgateway.io/guides/opencode)** — Added OpenCode to the [integrations](/integrations) list
- **Free icon visibility** — Free icon now correctly hidden for paid provider mappings

---

## Documentation & Guides

- **[Codex CLI guide](https://docs.llmgateway.io/guides/codex-cli)** — Step-by-step guide for using LLM Gateway with OpenAI Codex CLI
- **[Autohand guide](https://docs.llmgateway.io/guides/autohand)** — Integration guide for Autohand
- **[OpenClaw guide](https://docs.llmgateway.io/guides/openclaw)** — Integration guide for OpenClaw
- **[Introduction page](https://docs.llmgateway.io)** — New docs introduction page
- **Themed screenshots** — Light/dark themed screenshots in the learn section

---

## Fixes & Reliability

- Moonshot thinking disabled for tool calls to prevent errors
- ByteDance sensitive content blocks now properly classified
- Cached tokens no longer double-counted in storage cost calculations
- Bedrock cached tokens correctly included in streaming responses
- Streaming error diagnostics improved with better logger serialization
- Canopywave marked as unstable due to availability issues
- Top-tier model provider compatibility fixes
- XAI reasoning output option added to configuration
