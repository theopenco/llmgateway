---
id: "86"
slug: "devpass-no-ai-training"
date: "2026-08-28"
title: "No AI Training for DevPass"
summary: "DevPass subscribers can now restrict routing to providers that explicitly state API inputs are not used for training. Unknown policies fail closed, and retries or fallbacks never escape the setting. Available on every active DevPass tier."
image:
  src: "/changelog/devpass-no-ai-training.png"
  alt: "A glowing privacy shield protecting a prompt on a circuit board while routing traces avoid a neural-network training node"
  width: 1536
  height: 1024
---

Keeping prompts out of LLM Gateway logs does not control what an upstream AI provider may do with them. **No AI training for DevPass** adds that missing routing guarantee: turn it on once and DevPass uses only providers whose published policy explicitly says API inputs are not used for training.

## Fail Closed Across Every Route

Open **Settings → Privacy & compliance** and enable **No AI training**. The setting applies to every request funded through the DevPass organization, including pay-as-you-go overflow.

| Setting            | Routing behavior                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| **Off — Standard** | Uses normal DevPass routing                                                                        |
| **On**             | Allows only providers with an explicit no-training policy; unknown or missing policies are blocked |

The policy is enforced during initial selection, retries, and fallbacks. If no eligible provider can serve a model, the gateway rejects the request instead of silently routing to a provider that may train on API inputs. That means some models may become unavailable while the setting is enabled.

## Separate From Gateway Storage

This setting controls the upstream provider, not LLM Gateway storage. DevPass remains metadata-only: request statistics, cost, model, and routing metadata are retained for the dashboard, while prompt and response payloads are not stored in DevPass logs. Turning **No AI training** off does not enable payload storage.

The preference is available on every active DevPass tier and stays attached to the DevPass organization across tier changes, cancellation, and later resubscription.

---

**[Compliance docs →](https://docs.llmgateway.io/features/compliance)** | **[Open DevPass settings →](https://devpass.llmgateway.io/dashboard/settings)**
