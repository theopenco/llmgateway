---
id: "88"
slug: "claude-fable-5-1-mythos-5-1"
date: "2026-09-01"
title: "Claude Fable 5.1 & Mythos 5.1"
summary: "Anthropic's Claude Fable 5.1 is live on the gateway with a 1M context window, always-on adaptive thinking, and cache reads at a quarter of Fable 5's price. Claude Mythos 5.1, the same model for Project Glasswing participants, is listed for invite holders who bring their own key."
image:
  src: "/changelog/claude-fable-5-1-mythos-5-1.png"
  alt: "Anthropic's logo on a glowing chip surrounded by a storybook, a crystal, and a sealed invitation on a circuit board"
  width: 1536
  height: 1024
---

Long agentic sessions re-read the same prefix hundreds of times, and on a $10-per-million model those cache reads add up faster than the output does. **Claude Fable 5.1** extends Claude Fable 5 at the same input and output prices, but cache reads now cost **$0.25 per 1M tokens** — a quarter of Fable 5's rate — and the model brings stronger long-running agentic coding, multistep research, and document, spreadsheet, and slide work.

## Claude Fable 5.1

```bash
anthropic/claude-fable-5-1
```

It also routes through AWS Bedrock as `aws-bedrock/claude-fable-5-1` (global and US regions) and Microsoft Foundry as `azure-anthropic/claude-fable-5-1`, all at the same price.

| Spec           | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Context        | 1,000,000 tokens                                                       |
| Max output     | 128K tokens                                                            |
| Input / output | $10 / $50 per 1M tokens                                                |
| Cache read     | $0.25 per 1M tokens                                                    |
| Cache write    | $12.50 (5-minute) / $20 (1-hour) per 1M tokens                         |
| Thinking       | Adaptive, always on — steer it with `reasoning_effort`, `low` to `max` |
| Modalities     | Text and images in, text out; tool use and JSON schema output          |

Before you switch a pinned `claude-fable-5` workload over, note what carries across and what changed:

- Thinking cannot be turned off and the raw chain of thought is never returned. `reasoning_effort` (default `high`) is the only lever.
- The model accepts `max_tokens` and effort only. The gateway strips sampling parameters such as `temperature` and `top_p` before forwarding, so a request that sets them still succeeds.
- **New in 5.1:** Anthropic rejects forced tool use — `tool_choice: "required"` or a named function — with a `400`. The gateway forwards these requests with `auto` instead, so existing code keeps working; use `response_format` with a JSON schema when you need schema-valid output.
- Anthropic requires 30-day data retention for this model. A provider key from a zero-data-retention Anthropic organization is rejected upstream.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{
		"model": "anthropic/claude-fable-5-1",
		"reasoning_effort": "xhigh",
		"messages": [{ "role": "user", "content": "Plan the migration from SQLite to PostgreSQL." }]
	}'
```

## Claude Mythos 5.1

Anthropic offers the same model as **Claude Mythos 5.1** to Project Glasswing participants, by invitation only. It is listed on the gateway with identical specifications and pricing:

```bash
anthropic/claude-mythos-5-1
```

The gateway's own credentials are not enrolled in the program, so requests only succeed with a provider key that Anthropic, AWS, or Google Cloud has approved for Glasswing. Add that key as a [provider key](https://docs.llmgateway.io/learn/provider-keys) on your project and pin the model — Bedrock (`aws-bedrock/claude-mythos-5-1`) and Foundry (`azure-anthropic/claude-mythos-5-1`) mappings are available too.

---

**[Provider cache control docs →](https://docs.llmgateway.io/features/caching/provider-cache-control)** | **[Claude Fable 5.1 on the models page →](https://llmgateway.io/models/claude-fable-5-1)**
