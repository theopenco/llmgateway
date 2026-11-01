---
id: "blog-coding-agent-token-benchmark"
slug: "coding-agent-token-benchmark"
date: "2026-10-14"
title: "Coding Agent Token Benchmark: Empryo vs Claude Code vs OpenCode"
summary: "We ran Empryo, Claude Code and OpenCode on the same three real bug fixes with six models, 594 runs and $114 of inference, and counted every token at the LLM Gateway proxy. OpenCode used about half the tokens of the other two. Empryo solved the most runs and beat Claude Code on DeepSeek and GLM, but used 6% more tokens overall and cost the most. Here is the coding agent benchmark, why the numbers come out this way, and how to reproduce it."
categories: ["Guides", "Engineering"]
faqs:
  - question: "Which coding agent uses the fewest tokens?"
    answer: "In this benchmark, OpenCode. Across 594 runs on three real bug fixes it used 46.5M tokens, against 90.6M for Claude Code and 96.2M for Empryo, and it used the fewest tokens with every one of the six models. Solve rates were close: Empryo 195 of 198 runs, OpenCode 194, Claude Code 189."
  - question: "Why do coding agents use such different amounts of tokens for the same task?"
    answer: "Mostly fixed prompt overhead. Every request resends the system prompt and the tool definitions. Before reading any code, Empryo's first request averaged 24.3K tokens, Claude Code's 19.3K and OpenCode's 8.2K. With 14 to 16 requests per run, that overhead dominates the total on small tasks."
  - question: "How were tokens counted?"
    answer: "All three agents sent their traffic to https://api.llmgateway.io through a local proxy that forwards each request unchanged and records the usage block the gateway returned. The same code counted every agent. The computed cost of the 594 runs was $113.70; the API key was billed $114.07 in total, including smoke tests and the OG image."
  - question: "Can I reproduce this coding agent benchmark?"
    answer: "Yes. The harness, task definitions, prices, raw per-request logs, patches and grading logs are in scripts/agent-benchmark in the LLM Gateway repository. You need Node 24, Bun, the three CLIs and an LLM Gateway API key."
image:
  src: "/blog/coding-agent-token-benchmark.png"
  alt: "Three glowing agent pods racing on a light track on the central chip of a dark circuit board, each trailing a different length of token cubes, surrounded by terminal, stopwatch, coin, chart and bug icons, representing a coding agent token benchmark"
  width: 1536
  height: 1024
---

Give three coding agents the same model and the same bug, and one of them will spend twice the tokens of another. The model sets the price per token. The agent decides how many tokens you buy.

We wanted a number for that, so we ran a **coding agent token benchmark**: Empryo, Claude Code and OpenCode, six models, three real bug fixes, eleven runs of each, 594 runs in total and $114 of inference. Every request went through **LLM Gateway**, and every token was counted by the same code at the same place, between the agent and the gateway.

## How the benchmark worked

**Tasks.** Three merged bug fixes from [hono](https://github.com/honojs/hono), a web framework with about 190 source files:

- [LinearRouter matched an empty path segment as a route param](https://github.com/honojs/hono/pull/5373)
- [The AWS Lambda adapter dropped empty query parameters](https://github.com/honojs/hono/pull/5292)
- [`prettyJSON()` turned unparseable JSON bodies into 500 errors](https://github.com/honojs/hono/pull/5377)

Each run started from the commit before the fix, with no git history, and got an issue-style prompt that describes the bug but not the files to change. The prompt asks for a fix, a regression test and a test run.

**Grading.** After the agent exits, the fix commit's own test file replaces the agent's copy and runs. A run only counts as solved if the upstream tests pass.

**Models.** Claude Fable 5.1, Claude Opus 5.5, GPT-6.1 Sol, GPT-6 Luna, DeepSeek V4.1 Flash and GLM 5.3 Flash, each pinned to one provider so all three agents hit the same upstream and the same prompt cache.

**Agents.** Each ran headless with its defaults and a fresh home directory, so no personal instructions, memory, plugins or MCP servers were loaded:

```bash
claude -p "$PROMPT" --dangerously-skip-permissions --output-format json
opencode run --auto --format json --model "llmgateway/$MODEL" "$PROMPT"
empryo --headless --json --mode auto --model "llmgateway/$MODEL" "$PROMPT"
```

Claude Code pointed at `https://api.llmgateway.io` with every model slot, including subagents, set to the model under test. OpenCode and Empryo used their built-in LLM Gateway providers.

**Counting.** The agents report their own usage in different formats, so we did not use those numbers. Each agent's HTTPS traffic went through a local proxy that forwards requests to `api.llmgateway.io` unchanged and records the usage the gateway returned. Input tokens include cache reads and cache writes.

## Results: OpenCode used half the tokens

| Agent       | Solved  | Requests | Input tokens | Output tokens | Total tokens | Cost   |
| ----------- | ------- | -------- | ------------ | ------------- | ------------ | ------ |
| OpenCode    | 194/198 | 2,820    | 45.54M       | 0.94M         | **46.47M**   | $30.26 |
| Claude Code | 189/198 | 3,217    | 89.22M       | 1.42M         | 90.64M       | $35.71 |
| Empryo      | 195/198 | 2,773    | 94.89M       | 1.29M         | 96.18M       | $47.74 |

All three agents fixed nearly every bug. Every one of the 16 misses was on the `prettyJSON()` task, the one with the most edge cases. Claude Code missed 9, five of them with GLM 5.3 Flash. Empryo missed 3 and OpenCode 4.

OpenCode used the fewest tokens with every model, about half of what the other two used. Empryo used 6% more tokens than Claude Code overall and fewer in 90 of 198 head-to-head runs. It used more than OpenCode in 177 of 198.

![Average tokens per run by model for Empryo, Claude Code and OpenCode. OpenCode is lowest for every model.](/blog/coding-agent-token-benchmark/tokens-per-run.png)

| Model               | Empryo | Claude Code | OpenCode | Empryo cost | Claude Code cost | OpenCode cost |
| ------------------- | ------ | ----------- | -------- | ----------- | ---------------- | ------------- |
| Claude Fable 5.1    | 336K   | 319K        | 226K     | $29.83      | $20.77           | $19.53        |
| Claude Opus 5.5     | 243K   | 243K        | 153K     | $11.74      | $7.25            | $6.78         |
| GPT-6.1 Sol         | 273K   | 272K        | 174K     | $4.16       | $5.57            | $2.83         |
| GPT-6 Luna          | 801K   | 457K        | 234K     | $0.52       | $0.46            | $0.25         |
| DeepSeek V4.1 Flash | 762K   | 864K        | 312K     | $0.63       | $0.78            | $0.36         |
| GLM 5.3 Flash       | 500K   | 592K        | 309K     | $0.85       | $0.88            | $0.52         |

Token columns are the average per run. Cost columns are the total for 33 runs: three tasks, eleven runs each.

## Why the gap is so wide: fixed prompt overhead

The three agents made a similar number of requests: 14.0 per run for Empryo, 14.2 for OpenCode and 16.2 for Claude Code. Output was small for all of them, 1.3% to 2.0% of tokens. The difference is how much each request carries.

![Tokens in the first request: Empryo 24.3K, Claude Code 19.3K, OpenCode 8.2K](/blog/coding-agent-token-benchmark/first-request.png)

Before an agent reads a single file, its first request already holds the system prompt and every tool definition. Empryo sends 26 tools and averaged 24.3K tokens. Claude Code sends 20 tools and averaged 19.3K. OpenCode sends 9 or 10 tools and averaged 8.2K. Agentic loops resend that prefix on every turn, so the average request was 34.2K input tokens for Empryo, 27.7K for Claude Code and 16.2K for OpenCode.

On a bug that takes 10 to 20 turns, that fixed cost is most of the bill. Prompt caching makes it cheaper, not smaller: 90% to 92% of input tokens in this benchmark were cache reads, and you pay for every one of them.

## Where Empryo came out ahead

Empryo solved the most runs, 195 of 198. It made fewer requests than Claude Code with four of the six models, and with the two open-weight models that was enough to win on tokens: 12% fewer than Claude Code with DeepSeek V4.1 Flash and 16% fewer with GLM 5.3 Flash. With Opus and Sol the two were level, within 1%.

GPT-6 Luna is where Empryo lost the most ground. It averaged 21.8 requests per run against 16.2 for Claude Code and used 75% more tokens. On the AWS Lambda task alone, its Luna runs ranged from 12 to 49 requests. Leave Luna out and Empryo used 8% fewer tokens than Claude Code across the other five models.

## Fewer tokens did not mean a lower bill

With Opus, Empryo and Claude Code used the same number of tokens, and Empryo cost 62% more: $11.74 against $7.25. Empryo asks Anthropic for a one-hour prompt cache. A one-hour cache write costs $8 per million tokens on Opus and $20 on Fable, against $5 and $12.50 for the default five-minute cache. On runs that finish in a minute or two, the longer cache never pays for itself.

It works the other way with Sol: the same token count as Claude Code, 25% cheaper. Claude Code wrote more than twice as many output tokens with Sol, at $10 per million, and sent more of its prompt uncached.

Tokens tell you how much context an agent moves. The bill also depends on cache settings and on the model's price per token. Measure both.

## What this benchmark does not show

- **Small, well-specified bugs.** Each fix touched one or two files. On long, exploratory tasks, an agent that makes fewer, better-targeted requests could recover its larger prompt. We did not test that here.
- **Runs vary.** Eleven runs per combination smooth the noise, but single runs still swing. Claude Code with GLM took between 16 and 62 requests on the same `prettyJSON()` bug.
- **Defaults only.** Every agent ran with a fresh install and its default settings. Tuned setups will differ.
- **One day of pricing.** Costs use the pinned providers' list prices from October 14, 2026.

## Reproduce it

The harness, task definitions, prices, per-request logs, patches and grading logs are in [`scripts/agent-benchmark`](https://github.com/theopenco/llmgateway/tree/main/scripts/agent-benchmark):

```bash
export LLM_GATEWAY_API_KEY=your_key
node scripts/agent-benchmark/setup.mjs
node scripts/agent-benchmark/run.mjs --suite my-run --reps 11 --concurrency 8 --max-spend 120
node scripts/agent-benchmark/report.mjs my-run
```

`setup.mjs` clones hono, installs each task's starting commit, saves the hidden tests and creates a local certificate authority for the counting proxy. `run.mjs` takes `--agents`, `--models`, `--tasks` and `--reps`, resumes a suite where it stopped and stops queuing runs at `--max-spend`. The computed cost of our 594 runs was $113.70; the API key was billed $114.07 in total, including smoke tests and the OG image.

## Measure your own agent

You do not need the harness to see what your agent spends. Point it at LLM Gateway and every request lands in your dashboard with its model, tokens, cache reads and cost:

- [Claude Code](https://docs.llmgateway.io/guides/claude-code): set `ANTHROPIC_BASE_URL=https://api.llmgateway.io` and `ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY`.
- [OpenCode](https://docs.llmgateway.io/guides/opencode): select the built-in **LLM Gateway** provider with `/connect`.
- [Empryo](https://docs.llmgateway.io/guides/empryo): run `empryo --login llmgateway` or use `/login`.

Then run the same task with two agents or two models and compare the numbers.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- [Browse models and prices](https://llmgateway.io/models)
- [Cheap vs flagship AI models: $0.10 vs $198](/blog/ai-coding-model-benchmark)
