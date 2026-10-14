---
id: "blog-coding-agent-token-benchmark"
slug: "coding-agent-token-benchmark"
date: "2026-10-14"
title: "Coding Agent Token Benchmark: Empryo vs Claude Code vs OpenCode"
summary: "We ran Empryo, Claude Code and OpenCode on the same three real bug fixes with six models, 108 runs in total, and counted every token at the LLM Gateway proxy. OpenCode used the fewest tokens by a wide margin. Empryo used slightly fewer tokens than Claude Code overall but cost the most. Here is the coding agent benchmark, why the numbers come out this way, and how to reproduce it."
categories: ["Guides", "Engineering"]
faqs:
  - question: "Which coding agent uses the fewest tokens?"
    answer: "In this benchmark, OpenCode. Across 108 runs on three real bug fixes it used 7.82M tokens, against 16.20M for Empryo and 16.60M for Claude Code, and it used the fewest tokens with every one of the six models. All three agents solved 35 or 36 of their 36 runs."
  - question: "Why do coding agents use such different amounts of tokens for the same task?"
    answer: "Mostly fixed prompt overhead. Every request resends the system prompt and the tool definitions. Before reading any code, Empryo's first request averaged 24.3K tokens, Claude Code's 19.3K and OpenCode's 8.2K. With 13 to 17 requests per run, that overhead dominates the total on small tasks."
  - question: "How were tokens counted?"
    answer: "All three agents sent their traffic to https://api.llmgateway.io through a local proxy that forwards each request unchanged and records the usage block the gateway returned. The same code counted every agent. The computed cost of the 108 runs was $20.49; the API key was billed $20.54, including about $0.04 of smoke tests."
  - question: "Can I reproduce this coding agent benchmark?"
    answer: "Yes. The harness, task definitions, prices, raw per-request logs, patches and grading logs are in scripts/agent-benchmark in the LLM Gateway repository. You need Node 24, Bun, the three CLIs and an LLM Gateway API key."
image:
  src: "/blog/coding-agent-token-benchmark.png"
  alt: "Three glowing agent pods racing on a light track on the central chip of a dark circuit board, each trailing a different length of token cubes, surrounded by terminal, stopwatch, coin, chart and bug icons, representing a coding agent token benchmark"
  width: 1536
  height: 1024
---

Give three coding agents the same model and the same bug, and one of them will spend twice the tokens of another. The model sets the price per token. The agent decides how many tokens you buy.

We wanted a number for that, so we ran a **coding agent token benchmark**: Empryo, Claude Code and OpenCode, six models, three real bug fixes, two runs of each, 108 runs in total. Every request went through **LLM Gateway**, and every token was counted by the same code at the same place, between the agent and the gateway.

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

| Agent       | Solved | Requests | Input tokens | Output tokens | Total tokens | Cost  |
| ----------- | ------ | -------- | ------------ | ------------- | ------------ | ----- |
| OpenCode    | 35/36  | 493      | 7.66M        | 0.17M         | **7.82M**    | $5.49 |
| Empryo      | 36/36  | 475      | 15.99M       | 0.21M         | 16.20M       | $8.55 |
| Claude Code | 36/36  | 595      | 16.35M       | 0.26M         | 16.60M       | $6.45 |

All three agents fixed the bugs. The one miss was OpenCode with GLM 5.3 Flash on the `prettyJSON()` task, where 2 of 12 upstream tests failed.

OpenCode used the fewest tokens with every model. Empryo used 2.4% fewer tokens than Claude Code overall and fewer in 21 of 36 head-to-head runs, but it used more than OpenCode in 33 of 36.

![Average tokens per run by model for Empryo, Claude Code and OpenCode. OpenCode is lowest for every model.](/blog/coding-agent-token-benchmark/tokens-per-run.png)

| Model               | Empryo | Claude Code | OpenCode | Empryo cost | Claude Code cost | OpenCode cost |
| ------------------- | ------ | ----------- | -------- | ----------- | ---------------- | ------------- |
| Claude Fable 5.1    | 280K   | 310K        | 226K     | $5.30       | $3.70            | $3.47         |
| Claude Opus 5.5     | 229K   | 274K        | 172K     | $2.10       | $1.37            | $1.33         |
| GPT-6.1 Sol         | 305K   | 244K        | 163K     | $0.81       | $1.00            | $0.51         |
| GPT-6 Luna          | 792K   | 441K        | 230K     | $0.09       | $0.08            | $0.04         |
| DeepSeek V4.1 Flash | 630K   | 901K        | 222K     | $0.11       | $0.15            | $0.06         |
| GLM 5.3 Flash       | 465K   | 597K        | 290K     | $0.14       | $0.15            | $0.09         |

Token columns are the average per run. Cost columns are the total for six runs: three tasks, two runs each.

## Why the gap is so wide: fixed prompt overhead

The three agents made a similar number of requests: 13.2 per run for Empryo, 13.7 for OpenCode and 16.5 for Claude Code. Output was small for all of them, under 2% of tokens. The difference is how much each request carries.

![Tokens in the first request: Empryo 24.3K, Claude Code 19.3K, OpenCode 8.2K](/blog/coding-agent-token-benchmark/first-request.png)

Before an agent reads a single file, its first request already holds the system prompt and every tool definition. Empryo sends 26 tools and averaged 24.3K tokens. Claude Code sends 20 tools and averaged 19.3K. OpenCode sends 9 or 10 tools and averaged 8.2K. Agentic loops resend that prefix on every turn, so the average request was 33.7K input tokens for Empryo, 27.5K for Claude Code and 15.5K for OpenCode.

On a bug that takes 10 to 15 turns, that fixed cost is most of the bill. Prompt caching makes it cheaper, not smaller: 92% of input tokens in this benchmark were cache reads, and you pay for every one of them.

## Where Empryo came out ahead

Empryo made the fewest requests per run, and with Anthropic, DeepSeek and GLM models that was enough to beat Claude Code on tokens: 10% fewer with Fable, 16% with Opus, 30% with DeepSeek and 22% with GLM. It was also faster than Claude Code, at 129 seconds per run against 161. OpenCode averaged 81.

With the two OpenAI models it went the other way. Empryo used 25% more tokens than Claude Code with Sol and 80% more with Luna, where one task took it 49 requests on the first run and 35 on the second.

## Fewer tokens did not mean a lower bill

With Fable and Opus, Empryo used fewer tokens than Claude Code and still cost the most. It asks Anthropic for a one-hour prompt cache, and a one-hour cache write costs $20 per million tokens on Fable against $12.50 for the default five-minute cache. On runs that finish in about a minute, the longer cache never pays for itself. Empryo cost $5.30 on Fable against $3.70 for Claude Code and $3.47 for OpenCode.

Tokens tell you how much context an agent moves. The bill also depends on cache settings and on the model's price per token. Measure both.

## What this benchmark does not show

- **Small, well-specified bugs.** Each fix touched one or two files. On long, exploratory tasks, an agent that makes fewer, better-targeted requests could recover its larger prompt. We did not test that here.
- **Two runs per combination.** Single runs vary. Claude Code with GLM took 29 requests on one `prettyJSON()` run and 51 on the other.
- **Defaults only.** Every agent ran with a fresh install and its default settings. Tuned setups will differ.
- **One day of pricing.** Costs use the pinned providers' list prices from October 14, 2026.

## Reproduce it

The harness, task definitions, prices, per-request logs, patches and grading logs are in [`scripts/agent-benchmark`](https://github.com/theopenco/llmgateway/tree/main/scripts/agent-benchmark):

```bash
export LLM_GATEWAY_API_KEY=your_key
node scripts/agent-benchmark/setup.mjs
node scripts/agent-benchmark/run.mjs --suite my-run --reps 2 --concurrency 6
node scripts/agent-benchmark/report.mjs my-run
```

`setup.mjs` clones hono, installs each task's starting commit, saves the hidden tests and creates a local certificate authority for the counting proxy. `run.mjs` takes `--agents`, `--models`, `--tasks` and `--reps`, and resumes a suite where it stopped. The computed cost of our 108 runs was $20.49; the API key was billed $20.54, including about $0.04 of smoke tests.

## Measure your own agent

You do not need the harness to see what your agent spends. Point it at LLM Gateway and every request lands in your dashboard with its model, tokens, cache reads and cost:

- [Claude Code](https://docs.llmgateway.io/guides/claude-code): set `ANTHROPIC_BASE_URL=https://api.llmgateway.io` and `ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY`.
- [OpenCode](https://docs.llmgateway.io/guides/opencode): select the built-in **LLM Gateway** provider with `/connect`.
- [Empryo](https://docs.llmgateway.io/guides/empryo): run `empryo --login llmgateway` or use `/login`.

Then run the same task with two agents or two models and compare the numbers.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- [Browse models and prices](https://llmgateway.io/models)
- [Cheap vs flagship AI models: $0.10 vs $198](/blog/ai-coding-model-benchmark)
