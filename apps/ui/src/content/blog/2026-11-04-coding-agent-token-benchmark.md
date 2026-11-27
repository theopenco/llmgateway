---
id: "blog-coding-agent-token-benchmark"
slug: "coding-agent-token-benchmark"
date: "2026-11-04"
title: "Coding Agent Token Benchmark: Empryo vs Claude Code vs OpenCode"
summary: "We ran Empryo, Claude Code and OpenCode on the same three real bug fixes with six models, 594 runs and $105 of inference, and counted every token at the LLM Gateway proxy. OpenCode used the fewest tokens with every model and solved 197 of 198 runs. Claude Code and Empryo cost about the same, but Empryo used 69% more tokens, almost all of them on the cheap models. Here is the coding agent benchmark, why the numbers come out this way, and how to reproduce it."
categories: ["Guides", "Engineering"]
faqs:
  - question: "Which coding agent uses the fewest tokens?"
    answer: "In this benchmark, OpenCode. Across 594 runs on three real bug fixes it used 45.1M tokens, against 102.0M for Claude Code and 172.7M for Empryo, and it used the fewest tokens with every one of the six models. It also solved the most runs: 197 of 198, against 195 for Claude Code and 188 for Empryo."
  - question: "Why do coding agents use such different amounts of tokens for the same task?"
    answer: "Fixed prompt overhead and the number of turns. Every request resends the system prompt and the tool definitions: Empryo's first request averaged 16.2K tokens, Claude Code's 14.5K and OpenCode's 8.2K. Empryo also took the most turns, 22.2 requests per run against 19.2 for Claude Code and 14.1 for OpenCode, and the gap was widest on the cheaper models."
  - question: "How were tokens counted?"
    answer: "All three agents sent their traffic to https://api.llmgateway.io through a local proxy that forwards each request unchanged and records the usage block the gateway returned. The same code counted every agent. The computed cost of the 594 runs was $104.70; the API key was billed $104.81 while the suite ran."
  - question: "Can I reproduce this coding agent benchmark?"
    answer: "Yes. The harness, task definitions, prices, raw per-request logs, patches and grading logs are in scripts/agent-benchmark in the LLM Gateway repository. You need Node 24, Bun, the three CLIs and an LLM Gateway API key."
image:
  src: "/blog/coding-agent-token-benchmark.png"
  alt: "Three glowing agent pods racing on a light track on the central chip of a dark circuit board, each trailing a different length of token cubes, surrounded by terminal, stopwatch, coin, chart and bug icons, representing a coding agent token benchmark"
  width: 1536
  height: 1024
---

Give three coding agents the same model and the same bug, and one of them will spend twice the tokens of another. The model sets the price per token. The agent decides how many tokens you buy.

We wanted a number for that, so we ran a **coding agent token benchmark**: Empryo, Claude Code and OpenCode, six models, three real bug fixes, eleven runs of each, 594 runs in total and $105 of inference. Every request went through **LLM Gateway**, and every token was counted by the same code at the same place, between the agent and the gateway.

## How the benchmark worked

**Tasks.** Three merged bug fixes from [hono](https://github.com/honojs/hono), a web framework with about 190 source files:

- [LinearRouter matched an empty path segment as a route param](https://github.com/honojs/hono/pull/5373)
- [The AWS Lambda adapter dropped empty query parameters](https://github.com/honojs/hono/pull/5292)
- [`prettyJSON()` turned unparseable JSON bodies into 500 errors](https://github.com/honojs/hono/pull/5377)

Each run started from the commit before the fix, with no git history, and got an issue-style prompt that describes the bug but not the files to change. The prompt asks for a fix, a regression test and a test run.

**Grading.** After the agent exits, the fix commit's own test file replaces the agent's copy and runs. A run only counts as solved if the upstream tests pass. Runs are cut off after 25 minutes.

**Models.** Claude Fable 5.1, Claude Opus 5.5, GPT-6.1 Sol, GPT-6 Luna, DeepSeek V4.1 Flash and GLM 5.3 Flash, each pinned to one provider so all three agents hit the same upstream and the same prompt cache.

**Agents.** Claude Code 2.1.317, OpenCode 1.18.29 and Empryo 3.12.4-beta, each headless with its defaults and a fresh home directory, so no personal instructions, memory, plugins or MCP servers were loaded:

```bash
claude -p "$PROMPT" --dangerously-skip-permissions --output-format json
opencode run --auto --format json --model "llmgateway/$MODEL" "$PROMPT"
empryo --headless --json --mode auto --model "llmgateway/$MODEL" "$PROMPT"
```

Claude Code pointed at `https://api.llmgateway.io` with every model slot, including subagents, set to the model under test. OpenCode and Empryo used their built-in LLM Gateway providers. Empryo ran with its shipped defaults and experimental features off, and asked Anthropic for the same five-minute prompt cache the other two use.

**Counting.** The agents report their own usage in different formats, so we did not use those numbers. Each agent's HTTPS traffic went through a local proxy that forwards requests to `api.llmgateway.io` unchanged and records the usage the gateway returned. Input tokens include cache reads and cache writes.

## Results: OpenCode used the fewest tokens and solved the most

| Agent       | Solved  | Requests | Input tokens | Output tokens | Total tokens | Cost   |
| ----------- | ------- | -------- | ------------ | ------------- | ------------ | ------ |
| OpenCode    | 197/198 | 2,786    | 44.20M       | 0.94M         | **45.14M**   | $31.93 |
| Claude Code | 195/198 | 3,801    | 100.11M      | 1.90M         | 102.01M      | $36.72 |
| Empryo      | 188/198 | 4,404    | 170.97M      | 1.74M         | 172.71M      | $36.05 |

With Fable, Opus and Sol, every agent solved all 33 runs. All 14 misses came from the three cheaper models. Empryo missed 10: six on the `prettyJSON()` task with DeepSeek V4.1 Flash, three with GLM 5.3 Flash and one with GPT-6 Luna. Claude Code missed 3 and OpenCode 1.

OpenCode used the fewest tokens with every model. Claude Code used 2.3 times as many in total and Empryo 3.8 times as many. Empryo used fewer tokens than Claude Code in 65 of 198 head-to-head runs, and fewer than OpenCode in 32.

![Average tokens per run by model for Empryo, Claude Code and OpenCode. OpenCode is lowest for every model.](/blog/coding-agent-token-benchmark/tokens-per-run.png)

| Model               | Empryo | Claude Code | OpenCode | Empryo cost | Claude Code cost | OpenCode cost |
| ------------------- | ------ | ----------- | -------- | ----------- | ---------------- | ------------- |
| Claude Fable 5.1    | 261K   | 249K        | 231K     | $19.99      | $21.12           | $21.05        |
| Claude Opus 5.5     | 200K   | 179K        | 158K     | $7.55       | $7.08            | $6.94         |
| GPT-6.1 Sol         | 286K   | 241K        | 167K     | $3.91       | $5.59            | $2.78         |
| GPT-6 Luna          | 1,170K | 420K        | 259K     | $0.75       | $0.51            | $0.27         |
| DeepSeek V4.1 Flash | 651K   | 1,132K      | 239K     | $0.65       | $1.20            | $0.35         |
| GLM 5.3 Flash       | 2,666K | 870K        | 314K     | $3.20       | $1.21            | $0.55         |

Token columns are the average per run. Cost columns are the total for 33 runs: three tasks, eleven runs each.

## On frontier models the agents were close

With Fable and Opus, the three agents landed within 9% of each other on cost. Tokens spread a little wider: 13% from lowest to highest on Fable, 27% on Opus. Empryo was the cheapest agent on Fable, $19.99 against $21.12 for Claude Code, because it wrote 30% less output at $50 per million tokens. OpenCode took more turns with the Anthropic models, 14.2 requests per run on Fable against about 9.5 for the other two, but each of its requests was small enough to come out level.

Sol shows that tokens and cost can point in different directions. Empryo used 19% more tokens than Claude Code and cost 30% less, $3.91 against $5.59: Claude Code sent about 50% more of its prompt uncached and wrote 60% more output tokens.

## Why the gap is so wide: fixed prompt overhead and turns

![Tokens in the first request: Empryo 16.2K, Claude Code 14.5K, OpenCode 8.2K](/blog/coding-agent-token-benchmark/first-request.png)

Before an agent reads a single file, its first request already holds the system prompt and every tool definition. Empryo's first request averaged 16.2K tokens, Claude Code's 14.5K and OpenCode's 8.2K. Agentic loops resend that prefix on every turn, and the context grows as the agent reads files, so the average request was 38.8K input tokens for Empryo, 26.3K for Claude Code and 15.9K for OpenCode.

Turns multiply it. Empryo averaged 22.2 requests per run, Claude Code 19.2 and OpenCode 14.1. Output was small for everyone, 1.0% to 2.1% of tokens. Prompt caching makes the overhead cheaper, not smaller: 89% to 96% of input tokens were cache reads, and you pay for every one of them.

## Where the cheap models changed the picture

The cheaper models are where the agents pulled apart, in both directions:

- **GLM 5.3 Flash.** One Empryo run on the `prettyJSON()` task looped for the full 25 minutes: 346 requests and 53.4M tokens, 61% of Empryo's GLM total. Without that run Empryo still averaged 1.08M tokens per run with GLM, 24% more than Claude Code.
- **GPT-6 Luna.** Empryo averaged 36.4 requests per run against 17.3 for Claude Code and used 2.8 times as many tokens. Its Luna runs on the AWS Lambda task ranged up to 128 requests.
- **DeepSeek V4.1 Flash.** Here Claude Code ran long: 39.4 requests per run and four runs cut off at 25 minutes. Empryo used 42% fewer tokens and cost 46% less, but solved only 5 of its 11 `prettyJSON()` runs.

On a cheap model a long run costs cents, so these differences barely move the bill: Empryo's 88M tokens on GLM cost $3.20. They do move the wall clock and the solve rate.

## What this benchmark does not show

- **Small, well-specified bugs.** Each fix touched one or two files. On long, exploratory tasks, an agent that makes fewer, better-targeted requests could recover its larger prompt. We did not test that here.
- **Runs vary.** Eleven runs per combination smooth the noise, but single runs still swing, as the 346-request GLM run shows.
- **Defaults only.** Every agent ran with a fresh install and its default settings. Tuned setups will differ.
- **One day of pricing.** Costs use the pinned providers' list prices from November 4, 2026.

## Reproduce it

The harness, task definitions, prices, per-request logs, patches and grading logs are in [`scripts/agent-benchmark`](https://github.com/theopenco/llmgateway/tree/main/scripts/agent-benchmark):

```bash
export LLM_GATEWAY_API_KEY=your_key
node scripts/agent-benchmark/setup.mjs
node scripts/agent-benchmark/run.mjs --suite my-run --reps 11 --concurrency 6 --max-spend 120
node scripts/agent-benchmark/report.mjs my-run
```

`setup.mjs` clones hono, installs each task's starting commit, saves the hidden tests and creates a local certificate authority for the counting proxy. `run.mjs` takes `--agents`, `--models`, `--tasks` and `--reps`, resumes a suite where it stopped and stops queuing runs at `--max-spend`. The computed cost of our 594 runs was $104.70; the API key was billed $104.81 while the suite ran.

## Measure your own agent

You do not need the harness to see what your agent spends. Point it at LLM Gateway and every request lands in your dashboard with its model, tokens, cache reads and cost:

- [Claude Code](https://docs.llmgateway.io/guides/claude-code): set `ANTHROPIC_BASE_URL=https://api.llmgateway.io` and `ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY`.
- [OpenCode](https://docs.llmgateway.io/guides/opencode): select the built-in **LLM Gateway** provider with `/connect`.
- [Empryo](https://docs.llmgateway.io/guides/empryo): run `empryo --login llmgateway` or use `/login`.

Then run the same task with two agents or two models and compare the numbers.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- [Browse models and prices](https://llmgateway.io/models)
- [Cheap vs flagship AI models: $0.10 vs $198](/blog/ai-coding-model-benchmark)
