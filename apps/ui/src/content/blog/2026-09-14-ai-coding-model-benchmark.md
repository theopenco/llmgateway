---
id: "blog-ai-coding-model-benchmark"
slug: "ai-coding-model-benchmark"
date: "2026-09-14"
title: "Cheap vs Flagship AI Models: $0.10 vs $198"
summary: "We gave six models the same coding task and measured what each one actually cost. The cheapest produced a working result for 10 cents. The most expensive spent $198 on a single index.html. This AI coding model benchmark shows where the money goes and where it stops buying quality."
categories: ["Guides", "Engineering"]
faqs:
  - question: "What did this AI coding model benchmark measure?"
    answer: "Wall-clock time, request count, total tokens and total cost for one agentic coding task run end to end in Claude Code, plus a visual review of the artifact each model produced. All six runs used the same prompt, the same three reference images and the same harness."
  - question: "Are flagship models worth the price for coding tasks?"
    answer: "Not proportionally. The two flagships produced the two best artifacts, but cost 1,270x and 1,979x the cheapest model. A mid-tier model reached roughly 80% of the visual quality for under 2% of the flagship cost."
  - question: "Why is input the overwhelming majority of token spend?"
    answer: "Agentic coding loops resend accumulated context on every turn. Across all six runs input was around 99% of tokens. Cost tracks how many turns a model takes, not how much code it writes."
  - question: "How do I compare model costs on my own workload?"
    answer: "Point any Anthropic-compatible harness at https://api.llmgateway.io with your LLM Gateway key, set the model to any provider/model pair, and read per-model cost from the dashboard or the llmgateway CLI's usage command."
image:
  src: "/blog/ai-coding-model-benchmark.png"
  alt: "A glowing holographic retro desktop computer on a central chip, surrounded by 3D stopwatch, coin stack, bar chart and paintbrush icons on a dark circuit board"
  width: 1536
  height: 1024
---

One model built this desktop for **10 cents**. Another built it for **$198**. Same prompt, same harness, same afternoon.

Model cards price tokens, not tasks. The cost of an agentic run is set by how many turns a model takes, and a model that is 30x cheaper per token can still lose if it loops 30 times. So we ran an AI coding model benchmark the honest way: one prompt, one harness, six models, and a stopwatch. Every run went through **LLM Gateway**, so switching models was one environment variable and the per-model cost landed in one place.

The prompt and the idea come from [@bytrishalim on Instagram](https://www.instagram.com/bytrishalim/), who posted the retro girly desktop concept that started this. It turned out to be a genuinely good coding eval.

## The Task

Each model got the same brief plus three reference images read off disk:

> design a windows retro girly desktop. there needs to be a couple of windows open like winamp player. a paint app. a notepad. sticky note. word document maybe. attached are some inspo
>
> Use a simple HTML + CSS layout to keep it simple. Write the result to index.html (plus a style.css if you want). No build tools, no frameworks, no JS required.

Open-ended but objectively checkable. Every run has to read three images, hold a visual style in mind, hand-write a lot of CSS, and lay out six overlapping windows without clipping them. There is no library that does it for you.

The harness was Claude Code running headless in a clean directory. The only thing that changed between runs was the model:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=novita/deepseek-v4.1-flash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=$ANTHROPIC_MODEL

claude -p "$(cat prompt.txt)" --permission-mode bypassPermissions
```

Pick any model from the [live model directory](https://llmgateway.io/models), set it as `ANTHROPIC_MODEL`, and the gateway handles protocol translation to whichever provider serves it.

## What It Cost

All six runs finished and produced a working `index.html` plus `style.css`.

| Model                        | Provider         | Wall clock | Requests | Tokens | Cost        | vs. cheapest |
| ---------------------------- | ---------------- | ---------- | -------- | ------ | ----------- | ------------ |
| `muse-spark-1.3-contributor` | meta-contributor | 123s       | 9        | 2.13M  | **$0.10**   | 1x           |
| `glm-5.3-flash`              | runware          | **103s**   | 7        | 1.23M  | $0.11       | 1.1x         |
| `deepseek-v4.1-flash`        | novita           | 419s       | 46       | 5.91M  | $1.18       | 12x          |
| `gemini-3.8-flash`           | google-vertex    | 916s       | 62       | 7.63M  | $3.35       | 34x          |
| `gpt-6-astra`                | openai           | 2402s      | 94       | 22.46M | $126.98     | 1,270x       |
| `claude-fable-5-1`           | anthropic        | 1045s      | 35       | 20.82M | **$197.91** | 1,979x       |

Astra’s figure includes **$16.48** of `claude-sonnet-5` requests from subagents it spawned for its own review passes — 35 of its 94 requests. With agentic harnesses, the model you set is not always the only model you pay for.

Total for the benchmark: **$329.63 across 253 requests and 60 million tokens** — of which two runs account for $324.89.

## What Each Model Built

### Muse Spark 1.3 Contributor — $0.10, 123s

![Retro pink Windows desktop by Muse Spark 1.3 Contributor, with Winamp, Paint, Notepad, a Word diary and a sticky note](/blog/ai-coding-model-benchmark/muse.png)

The cheapest run and the best _writing_ of the six. The diary nails the Xanga-era voice — a mood field, "everything is PINK now!!", a guestbook sign-off from `glitter_gurl_98` — and Winamp has a real playlist widget. The chrome is the weakest: flat wallpaper, the smallest CSS at 7.2K, everything crowded into the top-left. One shot, no verification.

### GLM 5.3 Flash — $0.11, 103s

![Retro pink Windows 98 desktop by GLM 5.3 Flash, with an animated Winamp equalizer, Paint doodle, Notepad and Word letter](/blog/ai-coding-model-benchmark/glm.png)

The fastest run, done in under two minutes across 8 requests with no iteration at all. Properly pinkified Win98 bevels, a pure-CSS Winamp equalizer, an inline-SVG Paint doodle, working taskbar buttons. The middle of the desktop is sparse and Notepad slides behind the taskbar at shorter viewports. For 11 cents, remarkably little is wrong with it.

### DeepSeek V4.1 Flash — $1.18, 419s

![Retro pink desktop by DeepSeek V4.1 Flash, showing a detailed Winamp LCD, Microsoft Word letter, Paint heart and Notepad to-do list](/blog/ai-coding-model-benchmark/deepseek.png)

The first model to check its own work. It opened a browser, found that its layout overflowed the viewport, built a scale-to-fit system to fix it, and re-verified at four widths. The detail shows: a Winamp LCD with seek bar and volume knob, Word with a full status bar (`At 4.5" Ln 8 Col 12 REC`), Notepad reporting `Ln 9, Col 28 · 100% · Windows (CRLF) · ANSI`, MSN Messenger in the taskbar. The highest-fidelity artifact that renders correctly at any size.

### Gemini 3.8 Flash — $3.35, 916s

![Retro pink Windows 98 desktop by Gemini 3.8 Flash, featuring a hand-vectored kawaii bunny in Paint, a 16-tool palette and a WordPad journal](/blog/ai-coding-model-benchmark/gemini.png)

The richest artwork per dollar anywhere in the benchmark. Gemini wrote a 47K `index.html` — more than twice any other model — holding a hand-vectored kawaii bunny under a rainbow, a 16-tool Paint palette with pixel-accurate SVG icons, gingham wallpaper, nine desktop icons and a WordPad with a graduated ruler. It is also the only run with visibly broken layout: Paint covers WordPad's titlebar, Winamp covers Notepad's. Lots of craft, not enough checking.

### GPT-6 Astra — $126.98, 2402s

![Muted mauve and rose retro desktop by GPT-6 Astra, with a pixel-art heart in Paint, a Winamp playlist editor and a Word document](/blog/ai-coding-model-benchmark/astra.png)

The best-_designed_ result, and the only one that reads as art-directed rather than decorated. Muted mauve and rose instead of saturated pink, a "hello, daydreamer" masthead, a pixel-art heart in Paint, a Winamp playlist editor labelled "the main character mix". The only run with zero window overlap and nothing clipped, verified at five widths down to 320px. It also wrote itself a `PRODUCT.md`, a 15K `DESIGN.md` and spawned review subagents — which is exactly why it took 40 minutes and $127.

### Claude Fable 5.1 — $197.91, 1045s

![Hot pink retro desktop by Claude Fable 5.1, with a Winamp player and playlist, a bow-wearing cat in Paint, a Word diary and three sticky notes](/blog/ai-coding-model-benchmark/fable.png)

The most convincing period artifact, and the single most expensive `index.html` we have ever generated. The diary is written by an actual teenager in 2003 — "he sent me a smiley face. a SMILEY FACE. i'm gonna die." — Paint holds a bow-wearing cat, the Winamp playlist is a real nine-track Y2K set with runtimes, Word carries the full status bar, and there are three tilted sticky notes including one with a password hint. It caught its own bug mid-run: the playlist had rendered below the taskbar, so it moved it up and raised the minimum canvas size.

## Where the $198 Went

Not into code. **Input was roughly 99% of tokens in every run.** Astra read 22.5 million tokens to produce a 19K HTML file. Fable read 20.8 million to produce 17K.

The expensive models are not expensive because they write more. They are expensive because they take more turns, and every turn resends the accumulated context. GLM finished in 7 requests. Fable took 35. That 5x gap in turns, compounded by a context that grows on each one, is where a 1,979x cost difference actually comes from.

Which also means the cheap-model advantage is bigger than the per-token prices suggest.

## The Quality Gap Is Real. It Is Not 1,979x.

The flagships won. Astra and Fable are the two artifacts we would actually ship, and neither budget model is close on craft. But the curve flattens fast:

- **Gemini 3.8 Flash at $3.35** — roughly 80% of Fable's visual richness for **1.7%** of the cost.
- **DeepSeek V4.1 Flash at $1.18** — roughly 75% for **0.6%**, and unlike Gemini it renders correctly.
- **GLM 5.3 Flash at $0.11** — roughly 60% in 103 seconds with no iteration at all.

If you run a coding agent at any volume, the question is not "which model is best". It is "at what point does the next dollar stop buying anything". On this task that point sits much closer to the cheap end than the price list implies:

- **Volume agentic work, price-sensitive:** DeepSeek V4.1 Flash or Gemini 3.8 Flash.
- **Fast one-shot generation:** GLM 5.3 Flash.
- **Final output quality, taste-driven:** Claude Fable 5.1.
- **Final output quality, rigor and responsive correctness:** GPT-6 Astra.

## Run This Yourself

Every number here came out of the [llmgateway CLI](https://docs.llmgateway.io/developers/cli), which reads the same per-model aggregates as the dashboard:

```bash
llmgateway usage --by model --range 24h
```

That is the part worth stealing regardless of which models you care about. Point your agent at the gateway, run your own real task, and read the cost per model afterwards instead of estimating it from a price table. The two numbers rarely match.

Caveats, for honesty: each figure is one full agent run per model, attributed by session id, and quality scoring is a judgement call — the screenshots are there so you can disagree with ours.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — run any model through one Anthropic-compatible endpoint
- **[Browse the model directory](https://llmgateway.io/models)** — live pricing and capabilities for every model in this post
- **[Track LLM usage and spend](/blog/track-llm-usage-spend-api)** — per-model tokens, cache hits and costs via the API
- **[@bytrishalim on Instagram](https://www.instagram.com/bytrishalim/)** — for the prompt and the idea behind this benchmark
