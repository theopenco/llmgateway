---
id: "44"
slug: "multi-region-content-filters"
date: "2026-04-02"
title: "Multi-Region Routing, Content Filters & More"
summary: "Route requests to regional providers, protect your apps with built-in content moderation, enforce API key rate limits, and explore new models."
draft: false
image:
  src: "/changelog/multi-region-content-filters.png"
  alt: "Multi-region routing and content filters on LLM Gateway"
  width: 1768
  height: 677
---

## Multi-Region Provider Routing

LLM Gateway now supports **regional routing** — send requests to geographically specific provider endpoints for lower latency and data residency compliance.

- Route to specific regions per provider (e.g. `us-east`, `eu-west`)
- Region-specific pricing automatically applied
- Regional mapping statistics tracked separately
- Fallback to root mappings when regional endpoints are unavailable

---

## Content Filters & Moderation

Built-in **content moderation** gives you control over what passes through your gateway:

- **Configurable moderation modes** — choose between blocking, logging, or passthrough
- **Content filter routing** — automatically route requests based on content classification
- **Provider exclusion** — exclude providers from content-filtered requests
- **Moderation payloads stored** for audit and review
- Separate image moderation pipeline for multimodal requests

**[Read the moderation docs](https://docs.llmgateway.io/features/moderations)**

---

## API Key Period Limits

Set **time-based rate limits** on individual API keys — cap usage by hour, day, or month to control spend and prevent runaway costs.

---

## Provider RPM Caps

Configure **requests-per-minute caps** at the provider level. When a provider hits its RPM limit, requests automatically fall back to the next available provider.

---

## New Models

### MiniMax Reasoning

MiniMax models now support **split reasoning** — separating thinking tokens from response tokens for better transparency and cost tracking.

---

## Token Cost Calculator

New **[Token Cost Calculator](/token-cost-calculator)** tool — estimate costs across models and providers before committing to a workflow.

---

## UI & Platform Improvements

- **Redesigned provider page** — Model cards on provider pages rebuilt with clearer pricing, status badges, and capability tags
- **Diff syntax highlighting** — Code blocks now render diffs with proper `+`/`-` line coloring
- **Model CTA** — Contextual call-to-action on model pages to guide new users
- **Admin log filters** — Improved filtering in the admin dashboard activity logs
- **Credit top-up cap** — Maximum cap on credit top-ups for safer billing
- **Auto top-up expiry** — Auto top-up now disables after 7 days of inactivity

---

## Fixes & Reliability

- OpenAI streaming keepalive events no longer cause parsing errors
- OpenAI response done events handled correctly in streaming
- Streamed provider errors now surface proper error messages
- ByteDance sensitive content blocks properly classified
- Moonshot thinking disabled for tool calls to prevent errors
- Regional gateway routing simplified for better reliability
- E2E tool call test failures resolved
