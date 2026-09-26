---
id: "blog-smart-routing-benchmark"
slug: "smart-routing-benchmark"
date: "2026-09-26"
title: "Smart Routing Benchmark: Cost and Quality"
summary: "A live Smart Routing benchmark compares the same prompts across routed and fixed-model requests, including classifier charges, answer checks, and latency. See where routing saved money and where it missed."
categories: ["Engineering"]
faqs:
  - question: "Does Smart Routing always save money?"
    answer: "No. Savings depend on the fixed model you would otherwise use, your allowed candidates, the task mix, and the classifier's decisions. Compare both cost and task success against your actual baseline."
  - question: "Does the benchmark include classifier costs?"
    answer: "Yes. Each routed request is matched to its separately billed classifier entry. The comparison includes inference, classification, and storage for both entries."
  - question: "Does a small benchmark prove the same quality?"
    answer: "No. A pilot can reveal large cost differences and concrete failures. A single run on a small synthetic workload cannot establish quality equivalence or predict every production workload."
image:
  src: "/blog/smart-routing-benchmark.png"
  alt: "A glowing balance scale on a circuit board weighs task quality against inference cost"
  width: 1536
  height: 1024
---

Routing a prompt to a cheaper model only helps if the answer is useful. We ran a
live **Smart Routing benchmark** through **LLM Gateway** to measure both sides:
the complete request cost and whether the output passed its task's checks.

Smart Routing cost **33.2% less than the fixed premium baseline** in the primary run. It also cost **35.6× as much as the fixed low-cost baseline**. The savings estimate was uncertain, and the cheaper fixed baselines remained competitive on task success.

## Compare the same prompts

We fixed 80 prompts before collecting results and sent each through four arms:
Smart Routing, a fixed low-cost model, a fixed mid-priced model, and a fixed
premium model. We ran the full comparison at two output caps, for 640 measured requests.
Prompt order and arm order were shuffled using a recorded seed.

The&nbsp;[protocol](/benchmarks/smart-routing-2026-09-26-protocol.json) contains the
exact baseline model IDs, prompts, order, and dataset hash. The&nbsp;[results](/benchmarks/smart-routing-2026-09-26-results.json) contain the selected
models, responses, scores, token counts, normalized costs, and timing data.
These snapshots make the run auditable. The fixed mid-priced baseline was
outside the configured candidate pool; the low-cost and premium baselines were
in it. Baseline labels describe this comparison, not the router’s price bands.
The results record the actual eligible pool and decision for each routed call.
For current availability, use the&nbsp;[model catalogue](https://llmgateway.io/models).

| Workload               | Prompts | What the check measures                                            |
| ---------------------- | ------: | ------------------------------------------------------------------ |
| Easy tasks             |      25 | Arithmetic, extraction, sorting, case conversion, sentiment labels |
| Exact-answer reasoning |      15 | Reference answers for math, algorithms, logic, and code tracing    |
| Instruction following  |      40 | 40 sampled cases from 334 supported IFEval cases                   |

The IFEval subset uses&nbsp;[Google Research's dataset](https://github.com/google-research/google-research/tree/d36068b845da4c2b24927fee2cea1e6ef98dadda/instruction_following_eval).
Its score checks instructions such as avoiding commas or formatting an answer
as JSON. It does **not** establish factual accuracy or writing quality. We
cross-checked the stored outputs against the official evaluator and independently
verified all 15 exact-answer reference solutions. This is a
subset score, not a full IFEval leaderboard result.

The primary comparison uses the same 8,192-token output limit for every arm.
The initial run used a 4,096-token cap. During that run, we found that this
prevents Smart Routing from raising reasoning effort for high-difficulty
requests. We completed that round and repeated the entire comparison at
8,192 tokens to exercise that behavior. The&nbsp;[initial protocol](/benchmarks/smart-routing-2026-09-26-4096-protocol.json) and&nbsp;[initial results](/benchmarks/smart-routing-2026-09-26-4096-results.json) are also
available. Requests ran serially with
gateway response caching and cross-provider fallback disabled. The fixed-model
arms still use gateway provider selection; they do not pin a provider. Provider-side
prompt caching could still occur. We left reasoning and temperature at their
defaults, including Smart Routing's automatic reasoning adjustment. This tests
the configured service end to end, rather than isolating the classifier.

## Read the Smart Routing benchmark results

| Arm              | Cost index | Strict pass | Scoring sensitivity | Median client time |
| ---------------- | ---------: | ----------: | ------------------: | -----------------: |
| Smart Routing    |      66.82 |       75/80 |               75/79 |              6.48s |
| Fixed low-cost   |       1.88 |       74/80 |               74/79 |              5.12s |
| Fixed mid-priced |      18.13 |       76/80 |               76/79 |              4.86s |
| Fixed premium    |     100.00 |       74/80 |               79/79 |              6.85s |

![Total cost, strict task success, and ambiguity-adjusted task success at the 8,192-token cap](/blog/smart-routing-benchmark-results.png)

Cost is indexed to the fixed premium arm's total, set to 100. Lower is cheaper.
The total includes the response's inference charge, the separate Jev classifier
charge, and storage for both. Classifier charges came from the actual request
records; they were not inferred from a typical price per call.

Against the premium baseline, the paired 95% interval ranged from **4.3% higher cost to 66.1% lower cost**. It includes no savings, so this small sample does not establish a reliable reduction. Against the mid-priced baseline, Smart Routing cost 3.69× as much (paired interval: 1.90× to 5.99×). Against the low-cost baseline, Smart Routing cost 35.57× as much (paired interval: 20.11× to 51.97×).

Classification and its storage accounted for 0.53% of Smart Routing’s total bill. Most of the routed cost came from the selected models.

Latency is measured at the client and includes network and gateway delays.
During the run, some client timings substantially exceeded the logged inference
duration; both are available in the data. These timings describe this run’s
conditions, not a model-speed guarantee. Smart Routing’s client p95 was 66.57s,
compared with 41.09s for the premium baseline.

## Check the failures before switching

| Arm              | Easy tasks | Exact-answer reasoning | IFEval subset |
| ---------------- | ---------: | ---------------------: | ------------: |
| Smart Routing    |      25/25 |                  12/15 |         38/40 |
| Fixed low-cost   |      25/25 |                  12/15 |         37/40 |
| Fixed mid-priced |      25/25 |                  14/15 |         37/40 |
| Fixed premium    |      20/25 |                  15/15 |         39/40 |

Smart Routing had one provider access error and one client timeout. The low-cost baseline had one output-limit truncation. The other fixed arms completed without request errors or truncations. A timed-out stream counts as a failed, billed request; its recorded inference charge is included even though the client received only part of the answer.

We kept failures and truncated responses in the denominator. We also audited
the scoring rules. One IFEval prompt requires repeating text containing a word
twice while allowing that word fewer than twice in the response. Five easy
case-conversion prompts have ambiguous trailing punctuation. The original
strict scores remain above; a sensitivity check removes the contradictory
prompt for every arm and accepts an optional final period on those five tasks.

The sensitivity check puts Smart Routing at **75/79**, compared with **74/79** for the low-cost baseline, **76/79** for the mid-priced baseline, and **79/79** for the premium baseline. The premium arm’s six strict failures were all covered by these ambiguity adjustments; its original 74/80 should not be read as evidence that routing improved answer quality.

The original strict pass-rate difference versus premium was 1.25 percentage points, with a paired 95% interval from -5.00 to 7.50 points. This does not establish equivalent quality.

## Check sensitivity to the output cap

| Output cap | Smart cost vs premium | Smart strict pass | Low-cost strict pass | Mid-priced strict pass | Premium strict pass |
| ---------- | --------------------: | ----------------: | -------------------: | ---------------------: | ------------------: |
| 4,096      |           62.6% lower |             71/80 |                75/80 |                  74/80 |               73/80 |
| 8,192      |           33.2% lower |             75/80 |                74/80 |                  76/80 |               74/80 |

The higher-cap request logs confirm medium reasoning on both high-difficulty routed requests. On the recurrence task, the routed response changed from an incorrect answer in the lower-cap run to the correct answer in the higher-cap run. That routed request cost more in the higher-cap run.

These are separate live runs. Sampling and provider conditions can change
between them, so their difference does not isolate the causal effect of the cap.

## Treat this as a pilot

We built Smart Routing and ran this evaluation ourselves. The&nbsp;[runner and analysis scripts](https://github.com/theopenco/llmgateway/tree/main/scripts/benchmarks)
are available for inspection and reproduction.

This is a deliberately mixed, single-turn, text-only workload. It does not
represent a particular application's production traffic, long-context work,
tool use, or sessions. Enabling fallback can change failure rates and cost;
session reuse can spread classifier cost across multiple turns. The model pool
and provider conditions are a snapshot
from the run. One response per model and prompt also leaves sampling variation
unmeasured.

The confidence intervals resample paired prompts within the three workload
groups. They quantify uncertainty within this sample; they do not establish
quality equivalence or predict performance after model or routing changes.

Use the model you would actually replace as the baseline. The mid-priced arm cost 72.9% less than Smart Routing and passed 76/80 tasks against its 75/80. The low-cost arm was much cheaper again, with one fewer passing task than Smart Routing. Those fixed baselines deserve consideration alongside routing. Smart Routing can lower a premium-model bill, but this pilot does not justify a blanket claim of equal quality at lower cost. Repeat the paired comparison on representative application tasks and with the candidate pool you plan to deploy.

Smart Routing is available to every organization while in beta, excluding
DevPass. Choose the candidate models and Jev classifier under organization
Smart Routing settings or a project's Routing settings. There is no additional
routing platform fee; inference and successful classifier calls are billed.

---

- **[Try LLM Gateway](https://llmgateway.io/signup)**
- **[Read the Smart Routing documentation](https://docs.llmgateway.io/features/routing#smart-routing)**
- **[How automatic model selection works](/blog/automatic-model-selection)**
