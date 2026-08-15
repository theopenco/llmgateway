---
id: "blog-what-is-an-ai-coding-plan"
slug: "what-is-an-ai-coding-plan"
date: "2026-08-15"
title: "What Is an AI Coding Plan? Limits and Costs Explained"
summary: "An AI coding plan is a flat monthly fee that covers model usage inside your coding agent. This explains what a coding plan actually includes, how monthly allowances and weekly premium caps work, and how to size one against your real usage."
categories: ["Guides"]
faqs:
  - question: "Is an AI coding plan cheaper than paying per token?"
    answer: "For steady daily use, usually yes, because the allowance is metered at provider list rates with no markup. For occasional or bursty use, per-token credits cost less — you pay for the days you actually code instead of a monthly floor."
  - question: "What is a premium model on a coding plan?"
    answer: "The frontier flagships, the most expensive models per token. They draw on both the monthly allowance and a weekly ceiling. Standard models — the open-weight and mid-tier options — have no weekly cap."
  - question: "Can I use my own coding agent, or am I locked into theirs?"
    answer: "That depends on the vendor, and it is worth checking. A plan built on an OpenAI- or Anthropic-compatible endpoint works across the approved coding and agent tools — Claude Code, Cline, OpenCode, Cursor — rather than only inside one vendor's editor, which stops being useful the day you switch editors. What a flat-rate plan does not cover is wiring the key into your own application or batch job: that is general API traffic, and it belongs on pay-as-you-go credits. Check the [DevPass terms](https://devpass.llmgateway.io/legal/terms) for the current approved-tool list."
  - question: "What happens to unused allowance at the end of the month?"
    answer: "On most plans it expires at renewal rather than rolling over. The exception worth knowing about is a mid-cycle upgrade, where the unused remainder carries onto the new tier because you already paid for it."
image:
  src: "/blog/what-is-an-ai-coding-plan.png"
  alt: "Glossy 3D circuit board with a central meter dial surrounded by coin and terminal icons, representing a metered flat-rate coding plan"
  width: 1536
  height: 1024
---

Everyone selling you an AI coding plan quotes a monthly price and a model list. Almost nobody tells you what happens in week three, when the allowance you did not know you had runs out mid-refactor. The price is the easy part. The limits are the product.

An **AI coding plan** is a flat monthly fee that covers model usage inside a coding agent — Claude Code, Cursor, Cline, OpenCode and the like — instead of billing you per token. Flat-rate pricing works because the usage is interactive, so plans cover approved coding and agent tools rather than general API traffic. This is what that actually buys, and how to tell whether a given plan fits how you work.

## The three ways coding tools charge

Every plan on the market is one of these, and the differences matter more than the sticker price.

| Model              | You pay for                 | Runs out when                        | Suits                             |
| ------------------ | --------------------------- | ------------------------------------ | --------------------------------- |
| **Per token**      | Exact usage, no floor       | Never — it just costs more           | Spiky, unpredictable work         |
| **Per seat**       | A named user, model bundled | The vendor's opaque "limits" kick in | Teams who want one line on a bill |
| **Flat-rate plan** | A monthly usage allowance   | The allowance is spent               | Steady daily agent use            |

Per-seat pricing is where most of the confusion lives, because the limit is usually undisclosed and enforced by throttling rather than by a number you can see. A flat-rate plan with a published allowance is the same economics with the ceiling written down.

## What a coding plan includes

Three things, and you should be able to name all three before you buy:

1. **A monthly usage allowance** — how much model usage the fee covers, in dollars of usage rather than a vague "requests" count.
2. **A model list** — which models the allowance can be spent on, and whether new flagship releases are included or cost extra.
3. **A rate** — whether usage is metered at the provider's list price or marked up before it draws down your allowance.

On [DevPass](https://devpass.llmgateway.io), those are public numbers: Lite is $29/month and includes $87 of model usage, Pro is $79 for $237, and Max is $179 for $537. Usage is metered at provider list rates, so a dollar of allowance buys a dollar of tokens — there is no markup between the two.

<BlogCta variant="devpass" location="mid_article" />

## Why plans have a weekly cap on the best models

Here is the mechanic that surprises people, and it exists for a real reason.

Frontier flagship models cost several times what a strong open-weight model costs per token. If a plan let you spend the entire monthly allowance on the most expensive model in the catalogue during the first four days, two things would follow: the plan would have to be priced for that worst case, and everyone who does not code that way would subsidise the people who do.

So plans separate models into two categories:

- **Standard models** — the open-weight and mid-tier options. These draw only on the monthly allowance, with no weekly limit.
- **Premium models** — the frontier flagships. These draw on the monthly allowance _and_ a weekly ceiling, so a single heavy week cannot consume the month.

The weekly ceiling is a fraction of your monthly allowance, and the fraction gets more generous as the tier goes up: 12% on Lite, 15% on Pro, 18% on Max. Higher tiers are not just a bigger pool — they let you spend a larger share of it on the expensive models in any given week.

## What happens when you hit a limit

This is the question worth asking before you subscribe, not after.

- **Weekly premium cap reached** — standard models keep working with no interruption. For premium models you can wait for the window to roll, move up a tier, or redeem a [Reset Pass](https://devpass.llmgateway.io/pricing), which restores the weekly allowance immediately. Pro includes one pass a month and Max includes two; beyond those, extra passes are $9 on Lite, $29 on Pro, $79 on Max.
- **Monthly allowance spent** — the plan's ceiling by default. Requests stop there unless you opt into pay-as-you-go overflow, which lets work continue on your regular credits balance at pass-through token prices. Without the opt-in, the allowance is a hard stop even if the account holds credits.

Note which of those is a real ceiling. A Reset Pass lifts the _weekly_ cap, but the unlocked spend still comes out of the monthly pool — the pool is always the cost ceiling, which is the point of a flat-rate plan.

## How to size a plan against your actual usage

Guessing a tier is how people end up angry in week two. Two approaches that work:

**Measure first.** Run a week on pay-as-you-go credits with your normal workload. The dashboard reports spend per model and per day, so you get a real monthly number instead of a vibe. Then pick the tier whose allowance covers it with headroom.

**Start one tier below your guess.** Upgrades are immediate and the unused remainder of your current cycle rolls over onto the new tier's allowance rather than being forfeited, so moving up mid-month costs you nothing in wasted allowance. Moving down is a downgrade at renewal. Given that asymmetry, guessing low is cheaper than guessing high.

If you mostly drive standard models and reach for a flagship on hard problems, Lite goes further than its price suggests. If a frontier model is your default and the agent runs all day, the weekly cap — not the monthly pool — is what you will hit, and that is a Pro or Max question.

## Getting started

- **[Compare coding plans](https://devpass.llmgateway.io/pricing)** — allowance, weekly cap, and model list for each tier, in public numbers
- **[Try LLM Gateway free](https://llmgateway.io/signup)** — measure a week of real usage on credits before committing to a tier
- Shopping around? Read [10 Best AI Coding Plans](/blog/best-ai-coding-plans) for the head-to-head
- Already have an agent? Point it at the gateway with the [Claude Code](/guides/claude-code), [Cursor](/guides/cursor), or [OpenCode](/guides/opencode) guide

<BlogCta variant="devpass" location="bottom" />
