---
id: "blog-llm-routing-savings-100k"
slug: "llm-routing-savings-100k"
date: "2026-09-25"
title: "LLM Cost Optimization at $100k a Month"
summary: "A worked model of LLM cost optimization for a team spending $100k a month: what difficulty-based model routing saves at three traffic mixes, what the classifier costs, and the break-even point. Real catalogue prices, explicit assumptions, and the arithmetic to run on your own numbers."
categories: ["Guides", "Engineering"]
faqs:
  - question: "How much can LLM routing actually save?"
    answer: "It depends on what fraction of your traffic is easy enough for a cheaper model. Moving from a single pinned frontier model to a difficulty-routed mix of Claude Haiku, Sonnet and Opus saves roughly 36% at a conservative mix and 60% at an aggressive one, on 2k-in/500-out requests at list prices. Against a Sonnet baseline the range is about 9% to 33%. Your number depends on your own difficulty distribution, which you should measure rather than assume."
  - question: "What does the classifier itself cost?"
    answer: "TypeSafe's Jev model is $0.042 per million input tokens with free output. A classification runs about 1,100 to 4,000 input tokens depending on how long the request is and how many models you configured, so roughly $0.0001 per call — about 10,000 classifications per dollar. At $100k a month it lands between $50 and $800 depending on request volume and whether you use sticky sessions."
  - question: "When is routing not worth it?"
    answer: "When your traffic is uniformly hard, when your average request is so cheap that the classifier is a large fraction of it, or when a wrong model choice is expensive in ways the bill does not show. Routing moves a quality risk onto the cheaper model for part of your traffic, so measure output quality on the band you push down, not just the invoice."
  - question: "Does the classifier run on every request?"
    answer: "Only when you enable it, and a request carrying a session id is classified once for the whole conversation. For agent and chat traffic that divides the classifier cost by your average turn count, which is usually what makes it a rounding error."
image:
  src: "/blog/llm-routing-savings-100k.png"
  alt: "Glossy circuit board with a glowing balance scale on a central chip weighing stacked coins against ascending tiers, representing LLM cost optimization through model routing"
  width: 1536
  height: 1024
---

If you spend $100,000 a month on inference, the largest line item is usually
not a model that is too expensive. It is a model that is too expensive **for
part of your traffic**. The same endpoint answers "reword this paragraph" and
"find the race condition in this scheduler", and if you pinned a frontier model
to be safe, you are paying frontier prices for the first one several million
times a month.

This post is a worked model of **LLM cost optimization** through difficulty-based
routing at that scale. Every price below is the current list price from the
[LLM Gateway catalogue](https://llmgateway.io/models); every assumption is
stated so you can substitute your own.

## The assumptions, stated up front

This is a model, not a measurement. It rests on four things, and if any of them
are wrong for you the answer changes:

- **A representative request is 2,000 input tokens and 500 output tokens.** Long
  context shifts the arithmetic toward input price; heavy generation shifts it
  toward output.
- **Prices are Anthropic first-party list prices**, as served through the gateway.
- **Traffic mixes are illustrative.** The whole result hinges on what fraction of
  your requests are genuinely easy, and that is the number you should measure
  rather than borrow from a blog post.
- **Quality is held constant by assumption.** In reality, routing trades some
  quality risk on the traffic you push down. More on that at the end.

At those token counts the three models cost:

| Model             | Input / output per 1M | Cost per request |
| ----------------- | --------------------- | ---------------- |
| Claude Haiku 4.5  | $1.00 / $5.00         | $0.0045          |
| Claude Sonnet 4.6 | $3.00 / $15.00        | $0.0135          |
| Claude Opus 4.6   | $5.00 / $25.00        | $0.0225          |

## Case 1: you pinned the frontier model

$100,000 a month at $0.0225 a request is about **4.4 million requests**. Now
route them by difficulty instead, into Low / Medium / High bands backed by those
three models:

| Traffic mix (Haiku / Sonnet / Opus) | Inference | Classifier | Net saving        |
| ----------------------------------- | --------- | ---------- | ----------------- |
| Conservative — 20 / 50 / 30         | $64,000   | $467       | **$35,500 (36%)** |
| Typical — 40 / 40 / 20              | $52,000   | $467       | **$47,500 (48%)** |
| Aggressive — 60 / 30 / 10           | $40,000   | $467       | **$59,500 (60%)** |

Even the conservative mix — where 30% of traffic still goes to Opus and only a
fifth drops to Haiku — takes a third off the bill. The classifier is under half
a percent of the saving in every row.

## Case 2: you pinned the mid-tier model

Pinning Sonnet is the more common starting point, and the honest one to model,
because the headline number is smaller. $100,000 at $0.0135 is about **7.4
million requests**, and now routing cuts both ways: some traffic moves down to
Haiku, but some moves _up_ to Opus.

| Traffic mix (Haiku / Sonnet / Opus) | Inference | Classifier | Net saving        |
| ----------------------------------- | --------- | ---------- | ----------------- |
| Conservative — 30 / 55 / 15         | $90,000   | $778       | **$9,200 (9%)**   |
| Typical — 45 / 40 / 15              | $80,000   | $778       | **$19,200 (19%)** |
| Aggressive — 60 / 30 / 10           | $66,700   | $778       | **$32,600 (33%)** |

Smaller, but note what you are buying alongside it: 15% of your traffic now
reaches a frontier model it previously did not. That is a quality gain you were
not getting before, paid for out of the savings on the easy half.

## What the classifier costs

[TypeSafe's Jev](https://docs.llmgateway.io/features/routing) decision model is
**$0.042 per million input tokens, with output free**. One classification is the
rubric plus a bounded slice of the request:

| Scenario                          | Input tokens | Cost per call |
| --------------------------------- | ------------ | ------------- |
| Short prompt, 3 configured models | ~1,100       | $0.000046     |
| Mid prompt, ~10 models            | ~2,500       | $0.000105     |
| Capped state, 30 models           | ~4,000       | $0.000168     |

About **$0.0001 a call, or 10,000 classifications per dollar**. The rubric grows
with your model list — each configured model contributes its name, description
and price band to the question — so a 30-model list costs roughly twice a
3-model list per call.

And a request carrying a session id is classified **once for the whole
conversation**, not once per turn. For agent or chat traffic averaging ten turns,
every classifier figure above divides by ten.

## The break-even is about 1%

The cleanest way to think about whether this is worth switching on:

> Moving one request from Sonnet to Haiku saves $0.009. A classification costs
> $0.000105. The classifier pays for itself if **more than about 1.2%** of your
> requests move down a band.

Below that threshold your traffic is uniformly hard and you should pin a model
and skip the classifier. Above it — and almost all mixed production traffic is
well above it — the classifier is noise against the saving. That asymmetry is
the actual argument for difficulty routing: the downside is bounded at a tenth
of a percent of spend, and the upside is tens of percent.

## Where this model is optimistic

Three honest caveats, because a savings estimate with no failure modes is a
sales pitch:

**Quality is not free.** Every request you push to a cheaper model is a bet that
the cheaper model handles it. A classifier makes that bet better than a coin
flip, but it does not make it free. Measure output quality on the traffic that
moves down, not just the invoice.

**Your mix is probably not ours.** The 40/40/20 row is an illustration. Run your
own traffic through a classifier in observe-only mode — point the Low and Medium
bands at the model you already use — and read the recorded difficulty
distribution off your logs before you change any routing.

**Cheap traffic changes the ratio.** These numbers assume a $0.0135–$0.0225
average request. If your average request costs $0.002, the classifier is around
5% of spend rather than 0.5%, and the case is weaker unless sessions amortize it.

## Running it

On LLM Gateway this is configuration, not code. Choose the models `smart` may
resolve to and the classifier, and the gateway sorts them into price bands and
routes each request to the matching one. Every decision — the difficulty, the
task type, the candidates, the model chosen — lands on the request's log entry,
so you can audit the mix you actually got against the mix you assumed here.

Smart routing is **free while in beta** for every organization, including
pay-as-you-go; it is not available on DevPass yet. If you want
the routing logic explicit instead, a
[dynamic route](https://docs.llmgateway.io/features/dynamic-routes) can branch on
the same verdict.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Smart routing documentation](https://docs.llmgateway.io/features/routing)**
- **[Automatic model selection by request difficulty](/blog/automatic-model-selection)**
