---
id: "96"
slug: "gemini-3-8-flash-muse-spark-new-models"
date: "2026-09-05"
title: "Gemini 3.8 Flash, Muse Spark 1.3 & More Models"
summary: "Gemini 3.8 Flash lands on Google AI Studio and Vertex AI with a 1M context at $0.75/M input, Meta's Muse Spark 1.3 arrives with a 1M context and a $0.10/M Contributor tier, and Kimi K3, GLM-5.3 Flash, and Qwen3.8 Flash pick up new deployments across Runware, Novita, SCX.ai, and Alibaba Cloud."
image:
  src: "/changelog/gemini-3-8-flash-muse-spark-new-models.png"
  alt: "A cluster of glowing new model chips shaped as a lightning bolt, a sparkle, and a picture frame on a circuit board, surrounded by brains, lenses, and rockets"
  width: 1536
  height: 1024
---

Two weeks of catalogue work in one place: a new Google Flash generation on both Google clouds, Meta's next Muse Spark, and extra deployments for the open-weight models people route the most.

## Gemini 3.8 Flash

```bash
google-ai-studio/gemini-3.8-flash
google-vertex/gemini-3.8-flash
```

| Spec         | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Context      | 1,048,576 tokens                                               |
| Max output   | 65,536 tokens                                                  |
| Input        | $0.75 per 1M tokens                                            |
| Cached input | $0.075 per 1M tokens, 4,096-token cache minimum                |
| Output       | $3.75 per 1M tokens                                            |
| Reasoning    | `low`, `medium`, `high`                                        |
| Inputs       | Text, image, audio, document                                   |
| Also         | Tools, JSON schema output, web search, Flex and Priority tiers |

Both mappings were verified live, including cache reads and hand-checked costs. Completion tokens include reasoning tokens.

## Muse Spark 1.3

`muse-spark-1.3` brings Meta's agentic reasoning model to the gateway in beta: a 1M-token context, reasoning effort from `minimal` to `xhigh`, vision, tools, and structured JSON, at $1.25/M input, $0.15/M cached input, and $4.25/M output.

`muse-spark-1.3-contributor` is the same model at **$0.10/M input, $0.002/M cached input, and $0.20/M output** for workloads that allow Meta to train on their data. It is modelled as a separate, training-eligible provider, so a compliance policy that blocks API training never routes to it unless you explicitly allow it.

## More Deployments for the Open-Weight Favorites

- **Kimi K3 on Runware** (`runware/kimi-k3`): 1M context, reasoning `none` through `max`, vision, tools, JSON schema, and prompt caching at $3/M input, $0.30/M cached, $15/M output.
- **GLM-5.3 Flash** (`glm-5.3-flash`): Z.ai's lightweight 1M-context coding model with vision and `low`, `high`, `max` reasoning at $0.15/M input, $0.03/M cached, $0.50/M output first party, now also on Novita and Runware, and on [SCX.ai](https://llmgateway.io/providers/scx-ai-gp) at $0.13/M input and $0.40/M output.
- **Qwen3.8 Flash** (`qwen3.8-flash`): 1M context and 131K output at $0.15/M input, $0.016/M cached, $0.47/M output on Alibaba Cloud Model Studio's Singapore region, with a Novita deployment alongside.
- **DeepSeek V4 Flash Vision Exp** (`deepseek/deepseek-v4-flash-vision-exp`, beta): image input for DeepSeek's V4 Flash line with time-based pricing, reasoning, tools, and JSON output.
- **Consensus Protocol** joins as a provider, serving DeepSeek V4 Flash over an OpenAI-compatible API at $0.14/M input and $0.28/M output with a 524K context.

## Stable Image Model IDs

`gemini-3-pro-image` and `gemini-3.1-flash-image` are now the canonical IDs for Google's image models, matching the stable upstream releases. The `-preview` IDs keep working as aliases with identical provider mappings, so nothing changes for existing callers.

---

**[Browse all models →](https://llmgateway.io/models)** | **[Providers →](https://llmgateway.io/providers)**
