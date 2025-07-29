---
id: "8"
slug: "nextjs-migration"
date: "2025-07-28"
title: "Next.js migration"
summary: "We’ve moved from TanStack Start to Next.js. Here’s why it matters"
image:
  src: "/changelog/nextjs-migration.png"
  alt: "Next.js migration"
  width: 800
  height: 400
---

## 🚀 Next.js Migration

**We migrated from TanStack Start to Next.js — here’s why**

After building on TanStack Start for a while, we made the leap to **Next.js** — and the results speak for themselves.

We're on GCP.

### 📈 Performance Gains

We went from solid to stellar:

| Metric             | TanStack Start | Next.js |
| ------------------ | -------------- | ------- |
| **Performance**    | 85             | ✅ 100  |
| **Accessibility**  | 85             | 84      |
| **Best Practices** | 74             | 78      |
| **SEO**            | 80             | ✅ 100  |
| **FCP**            | 0.3s           | 0.3s    |
| **Speed Index**    | ❌ 2.4s        | ✅ 1.1s |
| **TBT**            | 50ms           | 60ms    |
| **CLS**            | 0              | 0       |

### 🧠 Why We Switched

**Better SEO and performance** out of the box with Next.js’ built-in optimizations

**Simpler mental model** for routing, layouts, and deployment

**Edge-ready** and more compatible with our future plans (middleware, streaming, etc.)

**Improved observability**: CPU and memory usage became more stable and efficient after the switch

### 🔍 What Changed?

**Before**: Higher CPU + memory spikes, inconsistent rendering, lower SEO

**Now**: Lower system resource usage, sub-1.2s paint speeds, and perfect Lighthouse scores in key areas

---

💡 We're just getting started, this migration sets the foundation for faster feature delivery, lower latency, and a smoother developer experience. More updates soon!

## TanStack Start

![Speed insights](/changelog/insights-tanstack.png)

![Lighthouse test](/changelog/tanstack-lighthouse.png)

![CPU / Memory usage](/changelog/tanstack.jpeg)

## Next.js

![Speed insights](/changelog/insights-next.png)

![Lighthouse test](/changelog/next-lighthouse.png)

![CPU / Memory usage](/changelog/next.jpeg)
