---
id: "52"
slug: "referrals-cache-controls-product-updates"
date: "2026-06-01"
title: "Referrals, Cache Controls & Product Updates"
summary: "Share a referral link and reward new signups, toggle provider cache writes per project, see cache and audio costs in your logs, plus a faster Chat and more."
image:
  src: "/changelog/referrals-cache-controls-product-updates.png"
  alt: "Referrals, cache controls and product updates on LLM Gateway"
  width: 1536
  height: 1024
---

A roundup of everything else that shipped recently — a new referral program, finer cost controls, and a stack of product polish.

## Refer Friends, Reward Signups

Every organization now has a shareable referral link. Send it to a friend and they get a bonus credit on their first top-up.

```text
https://llmgateway.io/ref/<your-org-id>
```

- Grab your link from the dashboard and share it anywhere
- New users who sign up through it get a bonus percentage on their first top-up
- Track who you've referred right from your org settings

## Provider Cache-Write Controls

You can now **enable or disable provider-level cache writes** as an organization or project setting. Keep cache writes on to save on repeated prompts, or turn them off when you'd rather not persist prompt content upstream — your call, per project.

## Clearer Cost Breakdowns in Logs

Request logs now break out **cache-write** and **audio** tokens and cost separately, so you can see exactly where spend is going — not just a single blended number.

## Chat & Playground

- **Faster long conversations** — Chat now virtualizes the message list, so threads with hundreds of messages scroll smoothly
- **Comparison mode remembers your setup** — your side-by-side model comparison persists between sessions
- **Image & video history** — generated images and videos now have a dedicated history you can browse and revisit

## Enterprise

- **Per-project routing overrides** — apply different routing rules to different projects within the same org
- **Per-project source usage** — break down usage by source (`x-source`) for each project
- **IP CIDR IAM rules** — restrict access to specific IP ranges, available on the Enterprise plan

---

**[Open your dashboard →](https://llmgateway.io/dashboard)** | **[Try Chat →](https://chat.llmgateway.io)** | **[Talk to sales →](https://llmgateway.io/enterprise)**
