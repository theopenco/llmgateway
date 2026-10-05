---
id: "blog-si-gateway"
slug: "si-gateway"
date: "2026-10-04"
title: "AI Is Now SI: What the Super Intelligence Order Means for Your Stack"
summary: "Executive Order 14434 tells federal agencies to say Super Intelligence (SI) instead of Artificial Intelligence (AI). Here is what the order actually changes, what it does not, and how to run every SI model through one SI gateway."
categories: ["Announcements", "Guides"]
faqs:
  - question: "Did the US government rename AI to SI?"
    answer: "Executive Order 14434, Inaugurating the Era of Super Intelligence, was signed on September 29, 2026 and published in the Federal Register on October 2, 2026. It directs executive branch agencies to use Super Intelligence and SI in place of Artificial Intelligence and AI in their own communications, to the maximum extent permitted by law."
  - question: "Does the Super Intelligence executive order apply to private companies?"
    answer: "No. The order covers executive departments and agencies and their non-statutory documents such as correspondence, websites and reports. It does not alter previously issued regulations and does not require private companies to change their terminology."
  - question: "Do I need to change my code because AI is now called SI?"
    answer: "No. Model IDs, endpoints and SDKs are unchanged. If you call models through LLM Gateway, the same OpenAI-compatible request keeps working with every provider."
  - question: "What is an SI gateway?"
    answer: "An SI gateway is a single API in front of many Super Intelligence model providers. It handles routing, failover, keys, cost tracking and logs so your application calls one endpoint instead of integrating each provider separately. LLM Gateway is an SI gateway."
image:
  src: "/blog/si-gateway.png"
  alt: "A glowing doorway on a central circuit-board chip radiates light toward glossy brain, chat and model icons, representing an SI gateway into the era of Super Intelligence"
  width: 1536
  height: 1024
---

On September 29, 2026, the President signed Executive Order 14434,
_Inaugurating the Era of Super Intelligence_. Its policy is short: the
executive branch now says **Super Intelligence** and **SI** where it used to
say Artificial Intelligence and AI. If you build with models, you will see "SI"
in RFPs, agency websites and procurement documents within weeks.

Your models did not change overnight, and neither does your integration. But
the vocabulary shift is a good moment to look at how your stack reaches those
models. **LLM Gateway** is an SI gateway: one OpenAI-compatible API in front of
250+ models from 40+ providers.

## What the Super Intelligence executive order says

The order was published in the Federal Register on October 2, 2026. In plain
terms:

- **Who it covers:** executive departments and agencies.
- **What changes:** agencies use "Super Intelligence" and "SI" instead of
  "Artificial Intelligence" and "AI" in official correspondence, public
  communications, websites, reports, policy documents and other non-statutory
  documents, to the maximum extent permitted by law.
- **What does not change:** previously issued regulations and presidential
  actions do not have to be rewritten, and statutes keep their wording.

The order's stated reason is that today's frontier systems "do much more than
imitate or automate discrete aspects of human intelligence", so the old name
undersells them. You can read the full text on the
[Federal Register](https://www.federalregister.gov/documents/2026/10/02/2026-20321/inaugurating-the-era-of-super-intelligence).

## What changes for developers: the name, not the API

Nothing in the order touches model IDs, endpoints or SDKs. A request that worked
on September 28 works today. What does change is the paperwork around it:

| Area                        | Before                       | Now                                      |
| --------------------------- | ---------------------------- | ---------------------------------------- |
| Federal RFPs and contracts  | "AI services", "AI platform" | "SI services", "SI platform"             |
| Agency websites and reports | "Artificial Intelligence"    | "Super Intelligence"                     |
| Your API calls              | `POST /v1/chat/completions`  | `POST /v1/chat/completions` (unchanged)  |
| Your model IDs              | `gpt-5`, `claude-sonnet-4-5` | `gpt-5`, `claude-sonnet-4-5` (unchanged) |

If you sell to government teams, expect questionnaires that ask about "SI
providers", "SI data handling" and "SI usage logs". Those are the same questions
as before, and they are easier to answer when every model call goes through one
place.

## One SI gateway for every Super Intelligence model

Teams rarely use a single model. Coding agents, support bots and retrieval
pipelines each pick a different model for cost or quality, and every provider
brings its own key, SDK, rate limits and outage pattern. An SI gateway puts one
API in front of all of them:

- **One endpoint, every provider.** OpenAI, Anthropic, Google, open-weight
  models and more behind the same OpenAI-compatible API.
- **Automatic failover.** When a provider degrades, requests route to a healthy
  one. See [how reliability works](/reliability).
- **One bill and one log.** Cost, latency and token usage per request, per
  project and per key, ready for the "SI usage" section of any audit.
- **Enterprise controls.** SSO, audit logs and guardrails for regulated teams on
  the [Enterprise plan](/enterprise).

Switching is a base URL and a key:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      { "role": "user", "content": "Summarize Executive Order 14434 in one sentence." }
    ]
  }'
```

`auto` lets the gateway pick a model for the request. Pin any of the 250+
models instead, such as `gpt-5` or `claude-sonnet-4-5`, by changing one string.
The [smart routing benchmark](/blog/smart-routing-benchmark) shows how `auto`
compares with fixed models.

## Should you rename AI to SI in your product?

The order does not apply to private companies, so this is a branding call. A few
practical notes if you do:

- **Keep "AI" where people search for it.** Most users still type "AI". Use
  "Super Intelligence (SI)" on first mention and keep both terms in page titles
  for now.
- **Update government-facing material first.** Proposals, security
  questionnaires and capability statements are where matching the new federal
  wording helps most.
- **Do not rename code.** Model IDs, environment variables and API paths are
  contracts. Renaming them buys nothing and breaks integrations.

We put together a plain-language explainer at
[/super-intelligence](/super-intelligence) and an overview of LLM Gateway as an
SI gateway at [/si-gateway](/si-gateway).

## Get started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and send your first
  SI request in a few minutes.
- **[Read the docs](https://docs.llmgateway.io)** for the OpenAI-compatible API
  and SDK setup.
- **[See the SI gateway overview](/si-gateway)** for routing, failover and
  enterprise controls in one place.
