---
id: "blog-ai-coding-model-benchmark"
slug: "ai-coding-model-benchmark"
date: "2026-09-14"
title: "AI Coding Model Benchmark: One Prompt, Six Models"
summary: "We ran the same AI coding model benchmark across six models on LLM Gateway — two budget models, two mid-tier, two flagships — and measured wall clock, requests, tokens and cost for each. The most expensive run cost 2,888x the cheapest and was not 2,888x better."
categories: ["Guides", "Engineering"]
faqs:
  - question: "What did the AI coding model benchmark actually measure?"
    answer: "Wall-clock time, request count, total tokens and total cost for one agentic coding task run end to end in Claude Code, plus a visual review of the artifact each model produced. All six runs used the same prompt, the same three reference images and the same harness."
  - question: "Are flagship models worth the price for coding tasks?"
    answer: "Not proportionally. In this benchmark the two flagships produced the two best artifacts, but cost 1,840x and 2,888x the cheapest model. A mid-tier model reached roughly 80% of the visual quality for around 1% of the flagship cost."
  - question: "Why is input the overwhelming majority of token spend?"
    answer: "Agentic coding loops resend accumulated context on every turn. Across all six runs input was around 99% of tokens. Models that self-verify with a browser pay for that verification in re-read context, not in generated output."
  - question: "How do I compare model costs on my own workload?"
    answer: "Point any Anthropic-compatible harness at https://api.llmgateway.io with your LLM Gateway key, set the model to any provider/model pair, and read per-model cost from the dashboard or the llmgateway CLI's usage command."
image:
  src: "/blog/ai-coding-model-benchmark.png"
  alt: "A glowing holographic retro desktop computer on a central chip, surrounded by 3D stopwatch, coin stack, bar chart and paintbrush icons on a dark circuit board"
  width: 1536
  height: 1024
---

Model cards tell you price per million tokens. They do not tell you what a real coding task costs, because the cost of an agentic run is set by how many turns the model takes, not by its sticker price. A model that is 30x cheaper per token can still lose on total cost if it loops 30 times, and a model that is 100x more expensive can look reasonable if it one-shots the task.

So we ran an AI coding model benchmark the honest way: one prompt, one harness, six models, and a stopwatch. Every run went through **LLM Gateway**, which meant switching models was a single environment variable and the per-model tokens and cost landed in one place.

The prompt and the idea come from [@bytrishalim on Instagram](https://www.instagram.com/bytrishalim/), who posted the retro girly desktop concept that started this whole thing. Credit where it is due — it turned out to be a genuinely good coding eval.

## The Prompt

Each model got the same brief, plus three reference images read off disk:

> design a windows retro girly desktop. there needs to be a couple of windows open like winamp player. a paint app. a notepad. sticky note. word document maybe. attached are some inspo
>
> Use a simple HTML + CSS layout to keep it simple. Write the result to index.html (plus a style.css if you want). No build tools, no frameworks, no JS required.

This is a good eval because it is open-ended but objectively checkable. Every run has to read three images, hold a visual style in mind, produce a large amount of hand-written CSS, and lay out six overlapping windows without clipping them. There is no library to import that does it for you.

## The Harness

Claude Code, pointed at LLM Gateway, running headless in a clean directory with bypassed permissions. The only thing that changed between runs was the model:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=novita/deepseek-v4.1-flash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=$ANTHROPIC_MODEL

claude -p "$(cat prompt.txt)" --permission-mode bypassPermissions
```

Any Anthropic-compatible agent works the same way. Pick any model from the [live model directory](https://llmgateway.io/models), set it as `ANTHROPIC_MODEL`, and the gateway handles the protocol translation to OpenAI, Google, Meta or whichever provider actually serves it.

## Results

All six runs finished and produced a working `index.html` plus `style.css`. Costs are the full agent run as billed by the gateway, including a one-request smoke test per model and, for the two flagships, their failed first attempts.

| Model                        | Provider         | Wall clock | Requests | Tokens | Cost        | vs. cheapest |
| ---------------------------- | ---------------- | ---------- | -------- | ------ | ----------- | ------------ |
| `muse-spark-1.3-contributor` | meta-contributor | 123s       | 10       | 2.13M  | **$0.10**   | 1x           |
| `glm-5.3-flash`              | runware          | **103s**   | 8        | 1.23M  | $0.11       | 1.1x         |
| `deepseek-v4.1-flash`        | novita           | 419s       | 48       | 5.95M  | $1.19       | 12x          |
| `gemini-3.8-flash`           | google-vertex    | 916s       | 63       | 7.63M  | $3.35       | 34x          |
| `gpt-6-astra`                | openai           | 2402s      | 79       | 16.13M | $167.53     | 1,675x       |
| `claude-fable-5-1`           | anthropic        | 1045s      | 61       | 30.09M | **$288.82** | 2,888x       |

Astra additionally spent **$16.48** on `claude-sonnet-5` subagents it spawned for its own code review and documentation passes, bringing its true total to **$184.01**. We had pinned the main and Haiku models but not the Sonnet tier — a good reminder that with agentic harnesses, the model you set is not always the only model you pay for.

Total for the whole benchmark: **$477** across 269 requests and 74 million tokens.

## What Each Model Built

### Muse Spark 1.3 Contributor — $0.10, 123s

![Retro pink Windows desktop by Muse Spark 1.3 Contributor, with Winamp, Paint, Notepad, a Word diary and a sticky note](/blog/ai-coding-model-benchmark/muse.png)

The cheapest run, and the best _writing_ of the six. The diary entry lands the Xanga-era voice exactly — "today i customized my desktop, everything is PINK now!!", a mood field, a guestbook sign-off from `glitter_gurl_98`. The Winamp window has a real playlist widget with track times.

The chrome is the weakest, though: a flat pink wallpaper with no texture, the smallest CSS file of the six at 7.2K, and everything crowded into the top-left with a large empty area below. One shot, no verification.

### GLM 5.3 Flash — $0.11, 103s

![Retro pink Windows 98 desktop by GLM 5.3 Flash, with an animated Winamp equalizer, Paint doodle, Notepad and Word letter](/blog/ai-coding-model-benchmark/glm.png)

The fastest run of the benchmark, finishing in under two minutes with 8 requests and no iteration loop at all. The Win98 bevels are properly pinkified, the Winamp equalizer is a pure-CSS animation, the Paint canvas holds an inline-SVG smiley with a star and a heart, and the taskbar has working per-window task buttons.

The middle of the desktop is sparse and the Notepad window slides behind the taskbar at shorter viewports. For 11 cents and 103 seconds, it is remarkable how little is actually wrong with it.

### DeepSeek V4.1 Flash — $1.19, 419s

![Retro pink desktop by DeepSeek V4.1 Flash, showing a detailed Winamp LCD, Microsoft Word letter, Paint heart and Notepad to-do list](/blog/ai-coding-model-benchmark/deepseek.png)

The first model to self-verify. It installed a browser loop, took four screenshots, found that its own layout overflowed the viewport, built a `.stage` scale-to-fit system to fix it, and re-checked at four viewport tiers before finishing.

The detail work shows: a Winamp LCD with seek bar and volume knob, Word with a ruler and a complete status bar (`At 4.5" Ln 8 Col 12 REC`), Notepad reporting `Ln 9, Col 28 · 100% · Windows (CRLF) · ANSI`, and MSN Messenger sitting in the taskbar. It is the highest-fidelity artifact that renders correctly at any size.

### Gemini 3.8 Flash — $3.35, 916s

![Retro pink Windows 98 desktop by Gemini 3.8 Flash, featuring a hand-vectored kawaii bunny in Paint, a 16-tool palette and a WordPad journal](/blog/ai-coding-model-benchmark/gemini.png)

The richest artwork per dollar anywhere in the benchmark. Gemini produced a 47K `index.html` — more than twice any other model — containing a hand-vectored kawaii bunny holding a strawberry under a rainbow, a 16-tool Paint palette with pixel-accurate SVG icons, a gingham wallpaper with a Windows 98 watermark, nine desktop icons, a Quick Launch bar and a WordPad with a graduated ruler and sliding indent markers.

It is also the only run that shipped visibly broken layout: Paint covers WordPad's titlebar and Winamp covers Notepad's. Lots of craft, not enough checking.

### GPT-6 Astra — $184.01, 2402s

![Muted mauve and rose retro desktop by GPT-6 Astra, with a pixel-art heart in Paint, a Winamp playlist editor and a Word document](/blog/ai-coding-model-benchmark/astra.png)

The best-_designed_ result, and the only one that reads as art-directed rather than decorated. Astra chose a muted mauve and rose palette instead of saturated pink, added a "hello, daydreamer / Make yourself at home" masthead, and put a pixel-art heart in Paint with flowers and sparkles around it. The Winamp window has a separate playlist editor pane labelled "the main character mix".

It is the only run with zero window overlap and nothing clipped, and it verified at five widths down to 320px. It also ran a full product process on its own initiative: it wrote a `PRODUCT.md`, a 15K `DESIGN.md`, and spawned review subagents. That process is precisely why it took 40 minutes and $184.

### Claude Fable 5.1 — $288.82, 1045s

![Hot pink retro desktop by Claude Fable 5.1, with a Winamp player and playlist, a bow-wearing cat in Paint, a Word diary and three sticky notes](/blog/ai-coding-model-benchmark/fable.png)

The most convincing period artifact. Fable's diary is written by an actual teenager in 2003 — "he sent me a smiley face. a SMILEY FACE. i'm gonna die." — the Paint canvas holds a bow-wearing cat, the Winamp playlist is a real nine-track Y2K pop set with runtimes, Word carries the full status bar (`At 4.2" Ln 17 Col 3 · REC TRK EXT OVR`), and there are three tilted sticky notes including one with a password hint. MSN Messenger has its own desktop icon.

It caught and fixed its own bug during verification: the playlist window had rendered below the taskbar, so it moved it up beside the player and raised the minimum canvas size.

## Both Flagships Failed Their First Run

This is worth its own section, because it is the kind of thing a benchmark table hides.

Claude Code sizes its context budget from the model id. Gateway-prefixed ids like `openai/gpt-6-astra` are not in its catalogue, so it falls back to assuming a 200k window regardless of what the model actually supports. For the four cheaper models that assumption never mattered. For the two flagships, which take far more context per turn, it did:

- **Astra** thrashed autocompact — the context refilled to the limit within three turns, three times in a row — and aborted at 279 seconds. Raising the assumed window to 1M then overshot the model's real limit and returned a 400 at 56 seconds. 400k worked.
- **Fable** ran for 526 seconds, wrote both files, and then died on `Prompt is too long` before it could report. 150k worked.

Both are configuration problems, not model failures, and both are one environment variable away from fixed:

```bash
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=400000
```

The cost figures above include these failed attempts, because that is what the runs actually cost. If you are wiring a harness to a model it does not recognize, set the context budget explicitly before you start burning flagship tokens on compaction loops.

## Input Is 99% of What You Pay For

The single clearest pattern in the data: **generation is not the cost driver, context re-reading is.** Across every run, input accounted for roughly 99% of tokens. Astra read 16.1 million tokens to produce a 19K HTML file. Fable read 30.1 million to produce 17K.

That reframes the whole comparison. The expensive models were not expensive because they write more; they were expensive because they take more turns, and every turn resends the accumulated context. The two models that hired a browser to check their own work — DeepSeek and Astra — paid for that verification in re-read context rather than in output.

It also means the cheap-model advantage is larger than the per-token prices suggest. GLM finished in 8 requests. Fable took 61. That 7.6x gap in turns, compounded by a growing context on each one, is where a 2,888x cost difference actually comes from.

## The Quality Gap Is Real. It Is Not 2,888x.

The flagships won on quality. Astra and Fable are the two artifacts we would actually ship, and neither of the budget models is close on craft. That is a genuine result and worth stating plainly.

But the curve flattens fast:

- **Gemini 3.8 Flash at $3.35** delivers roughly 80% of Fable's visual richness for **1.2%** of the cost.
- **DeepSeek V4.1 Flash at $1.19** delivers roughly 75% for **0.4%**, and unlike Gemini it renders correctly.
- **GLM 5.3 Flash at $0.11** delivers roughly 60% in 103 seconds with no iteration at all.

If you are running a coding agent at any volume, the decision is not "which model is best". It is "at what quality threshold does the next dollar stop buying anything". On this task that threshold sits somewhere between the mid-tier and flagship tiers, and it is much closer to the cheap end than the price list implies.

Our recommendation from this run:

- **Volume agentic work, price-sensitive:** DeepSeek V4.1 Flash or Gemini 3.8 Flash.
- **Fast one-shot generation:** GLM 5.3 Flash.
- **Final output quality, taste-driven:** Claude Fable 5.1.
- **Final output quality, rigor and responsive correctness:** GPT-6 Astra.

## Run This Yourself

Every number in this post came out of the [llmgateway CLI](https://docs.llmgateway.io/developers/cli), which reads the same per-model aggregates as the dashboard:

```bash
llmgateway usage --by model --range 24h
```

That is the part worth stealing regardless of which models you care about. Point your agent at the gateway, run your own real task, and read the cost per model afterwards instead of estimating it from a price table. The two numbers rarely match.

A few caveats on ours, for honesty: the test project had unrelated traffic on it during the window, the flagship totals include their failed attempts, and quality scoring is a judgement call — the screenshots above are there so you can disagree with ours.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — run any model through one Anthropic-compatible endpoint
- **[Browse the model directory](https://llmgateway.io/models)** — live pricing and capabilities for every model in this post
- **[Track LLM usage and spend](/blog/track-llm-usage-spend-api)** — per-model tokens, cache hits and costs via the API
- **[@bytrishalim on Instagram](https://www.instagram.com/bytrishalim/)** — for the prompt and the idea behind this benchmark
