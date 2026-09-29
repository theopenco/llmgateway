---
id: "blog-openai-subscription-update-devpass"
slug: "openai-subscription-update-devpass"
date: "2026-09-29"
title: "OpenAI Subscription Update: ChatGPT Pro vs DevPass"
summary: "The OpenAI subscription update changes the $200 Pro usage calculation. Compare the new Codex/Work tiers with DevPass, including its October 15 move from 3× to 2× monthly allowance and new daily caps."
categories: ["Guides", "Product"]
faqs:
  - question: "What changes in OpenAI's $200 Pro subscription?"
    answer: "OpenAI announced that reopening $200 Pro subscriptions comes with a new usage calculation worth half the old tier in API-dollar terms. That puts the old 20× Plus allowance at a 10× equivalent for Codex/Work usage. It does not mean every ChatGPT feature is halved or that every coding task now consumes twice as much."
  - question: "Is DevPass cutting its monthly allowance in half?"
    answer: "No. The announced change is from 3× to 2× the subscription price in provider-rate usage, a one-third reduction. Lite, Pro, and Max keep their $29, $79, and $179 monthly prices, with new standard allowances of $58, $158, and $358."
  - question: "When do the DevPass changes take effect?"
    answer: "New subscriptions start with the 2× allowance on October 15, 2026. Existing subscribers move to it at their first renewal on or after that date. Daily caps, tighter premium weekly caps, and Reset Pass changes apply on October 15, including during existing billing cycles."
  - question: "Can I use DevPass with Codex CLI?"
    answer: "Yes. Configure Codex CLI with LLM Gateway as a custom provider and use your DevPass key for supported coding models. Those requests use your DevPass allowance, not your ChatGPT subscription. DevPass does not include ChatGPT Pro membership or its native product features."
image:
  src: "/blog/openai-subscription-update-devpass.png"
  alt: "ChatGPT Pro vs DevPass: new usage limits at the same monthly prices, on an LLM Gateway branded card"
  width: 1200
  height: 630
---

The subscription price can stay the same while the usage behind it changes.
The **OpenAI subscription update** does exactly that for the $200 Pro tier:
OpenAI says its new usage calculation represents half the old allowance in
API-dollar terms.

DevPass, the coding subscription from **LLM Gateway**, is changing too. Its
planned October 15 update reduces monthly included usage from 3× to 2× the
plan price and adds daily caps. A useful comparison needs both changes on the
table, not yesterday's more generous numbers.

Here's what each subscription buys, where the limits differ, and which one
fits your coding workflow. Pricing and announcements checked September 29, 2026;
amounts below are in USD.

## Understand the OpenAI subscription update

In [OpenAI's announcement](https://x.com/thsottiaux/status/2104823812042940713),
Tibo says new $200 Pro subscriptions are reopening with a revised usage
calculation. The stated change is **half the API-dollar equivalent of the old
$200 Pro plan**, not a lower subscription price.

For Codex/Work usage, the revised comparison is:

| ChatGPT plan   | Monthly price |                           Usage relative to Plus |
| -------------- | ------------: | -----------------------------------------------: |
| Plus           |           $20 |                                               1× |
| Pro, $100 tier |          $100 |                                               5× |
| Pro, $200 tier |          $200 | 10× equivalent under the announced recalculation |

The 10× figure reflects the halving of the previous 20× tier. At publication,
OpenAI's [Pro help page](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)
still describes the earlier 20× allowance and signup pause. Treat this table as
the announced Codex/Work change, not a claim that every account or every ChatGPT
feature has already switched. Check your account for the limits that apply to
your subscription.

The practical difference: the $200 tier now scales proportionally with the
$100 tier in this comparison. Twice the price buys twice the relative usage,
not four times.

There is an important benefit on OpenAI's side. The announcement commits to
**not bringing back the five-hour limit**, so subscribers can use their weekly
allowance when they need it. OpenAI also argues that cheaper, more capable
models can deliver more work per dollar. A 50% reduction in API-dollar
allowance is not proof of 50% fewer completed coding tasks.

## Include DevPass's upcoming 2× allowance

[PR #4039](https://github.com/theopenco/llmgateway/pull/4039) contains the
upcoming DevPass allowance and pacing changes. It is still open as of this
post. The [published October 15 notice](https://devpass.llmgateway.io/legal/terms#october-2026-plan-changes)
sets out when they apply.

**The reduction is from 3× to 2×, not a halving.** You lose one-third of the
standard monthly allowance; the subscription price stays the same.

| DevPass plan | Monthly price, unchanged | Current 3× monthly allowance | Upcoming 2× monthly allowance |
| ------------ | -----------------------: | ---------------------------: | ----------------------------: |
| Lite         |                      $29 |                          $87 |                           $58 |
| Pro          |                      $79 |                         $237 |                          $158 |
| Max          |                     $179 |                         $537 |                          $358 |

These allowance amounts measure eligible model usage at provider rates. They
are not cash, unrestricted API credits, or a promise of a fixed number of
prompts. The model, context length, output, and caching affect how fast you
use them. Check the [live DevPass model directory](https://devpass.llmgateway.io/models)
for supported models and their categories.

The rollout has two clocks:

- **Monthly allowance:** new subscriptions from October 15, 2026 start at 2×.
  Existing subscriptions move to 2× at their first renewal on or after that
  date. Immediate upgrades starting a new billing cycle from that date also
  use 2×, subject to the upgrade rollover rule.
- **Daily caps, premium weekly caps, and Reset Pass changes:** these apply on
  October 15, including during a billing cycle that started earlier. Cap
  percentages use the new standard monthly allowance, even while that cycle
  retains its earlier monthly pool.

### Budget for daily and premium limits

The monthly number is not the amount you can spend in one sitting. PR #4039
adds a rolling 24-hour cap across all models and tightens the premium weekly
cap from 12% / 15% / 18% to 10% / 12% / 15% for Lite / Pro / Max.

| Planned limit or benefit                |        Lite |          Pro |          Max |
| --------------------------------------- | ----------: | -----------: | -----------: |
| Daily cap, all models                   |  8% ($4.64) |  9% ($14.22) | 10% ($35.80) |
| Premium weekly cap                      | 10% ($5.80) | 12% ($18.96) | 15% ($53.70) |
| Price per Reset Pass                    |          $5 |          $15 |          $45 |
| Included Reset Passes per billing cycle |           0 |            0 |            2 |

Daily and weekly amounts above are portions of the monthly pool, not extra
usage. Premium requests count against both caps. **Pro loses its included
Reset Pass; Max keeps two.** A Reset Pass restores only the premium weekly
allowance. It does not replenish the daily or monthly allowance.

At a cap, requests pause unless you have opted into pay-as-you-go overflow
and have credits available. Overflow costs extra; it is not included in the
subscription. The PR adds an overflow choice at signup, off by default.

## Compare the workflow, not just the multiplier

OpenAI's **10×** means usage relative to ChatGPT Plus. DevPass's **2×** means
provider-rate usage relative to the subscription price. They have different
baselines. Dividing one by the other tells you nothing about how many coding
tasks either plan can complete.

| What matters to you    | ChatGPT subscription                                                        | DevPass after the planned update                              |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Where you work         | Native ChatGPT and Codex experience                                         | Supported coding tools with one DevPass key                   |
| Model choice           | OpenAI's subscription offering                                              | Eligible models across providers in the DevPass directory     |
| How usage is expressed | Relative plan allowances and product-specific limits                        | Provider-rate monthly pool, daily cap, and premium weekly cap |
| Bursty coding sessions | Announced $200 Pro plan: no five-hour limit; weekly allowance still applies | Rolling 24-hour cap, plus premium weekly cap                  |
| Beyond coding          | ChatGPT's broader product features                                          | Not a replacement for ChatGPT's general-purpose subscription  |

**Choose ChatGPT Plus or Pro if you want OpenAI's native experience.** If your
work stays in ChatGPT and Codex, switching providers may solve no problem for
you. For the announced $200 Pro plan, concentrating weekly usage into a busy
day also matters. A ChatGPT subscription does not include OpenAI API billing
credits.

**Choose DevPass if you want your coding budget to follow your tools and
model choices.** Use one key across supported tools such as Codex CLI, Claude
Code, Cursor, and OpenCode. You can change the model you use for a task without
buying a separate subscription for each provider. For example, DevPass Pro's
planned $79 monthly price covers $158 of eligible usage, provided your work
fits its daily and premium limits.

DevPass is not unlimited. It does not grant ChatGPT Pro membership or every
native Codex feature. Under the
[upcoming scope terms](https://devpass.llmgateway.io/legal/terms), billing periods
starting on or after October 15 are for interactive software development
through approved coding tools only. General-purpose chat, content generation,
and automation are not included. For applications or direct API workloads,
use [standard LLM Gateway credits](/pricing) instead.

## Keep Codex CLI, change how you pay for inference

You do not have to abandon Codex CLI to try DevPass. Follow the
[Codex CLI custom-provider guide](https://docs.llmgateway.io/guides/codex-cli),
configure LLM Gateway as the provider, and use your DevPass key. Requests on
that configuration draw from DevPass, not your ChatGPT subscription allowance.
Your native ChatGPT subscription remains separate.

Before choosing a tier, look at a normal coding day and your busiest one.
Check total usage, premium-model usage, and whether a daily cap would interrupt
you. A larger monthly pool is useful only if you can use it when you need it.

- **[Choose your DevPass plan](https://devpass.llmgateway.io/signup)** after reviewing the [pricing and October changes](https://devpass.llmgateway.io/pricing).
- [Set up your coding tool](https://docs.llmgateway.io/guides).
- [Compare other AI coding plans](/blog/best-ai-coding-plans).
