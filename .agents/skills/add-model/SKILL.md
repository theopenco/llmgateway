---
name: add-model
description: Add a model or provider mapping to the catalogue, or verify one that was already written — pricing, capability and reasoning metadata, scoped e2e, and playground options for image/video models. Use when the user says "add a model", "add <model> on <provider>", "new provider mapping", "check the pricing for", "verify this model", or when a prompt or pull request touches packages/models/src/models.
---

# Add a model

Prove every declared value against the live provider. A wrong price mis-bills
every request until someone audits it; a wrong capability flag routes traffic to
a deployment that 400s. Values handed to you in a prompt or PR are unverified —
re-derive them.

## 1. Scope

List every `(model, provider, region)` triple that is new or changed. Regions in
a `regions: []` array are separate mappings with their own prices and e2e cases.
Report results per mapping at the end.

```bash
gh pr checkout <n>   # someone else's PR; sets the upstream too
git diff origin/main...HEAD -- packages/models/src/models/
```

## 2. Where things live

| What | Where |
| --- | --- |
| Definitions, field docs | `packages/models/src/models/<family>.ts`, types in `models.ts` |
| Providers, env vars, regions, service tiers | `packages/models/src/providers.ts` |
| Catalogue invariants | `model-metadata.spec.ts`, `providers.spec.ts`, `realtime-models.spec.ts` |
| Cost engine | `apps/gateway/src/lib/costs.ts` |
| Token extraction | `apps/gateway/src/chat/tools/{extract-token-usage,parse-provider-response}.ts` |
| Request shaping | `packages/actions/src/prepare-request-body.ts` |
| New-provider endpoint wiring | `packages/actions/src/get-provider-endpoint.ts` |
| e2e | `apps/gateway/src/*.e2e.ts`, per capability (`CLAUDE.md`'s `api.e2e.ts` is stale — split into `chat-*`) |
| Playground options | `apps/playground/src/lib/{image-gen,video-gen}.ts` |

## 3. Pricing

Billing is tokens: `calculateCosts` multiplies token counts by the mapping's
per-token prices, and no code path reads a provider-reported cost. So research
the per-token rate card, then verify the token semantics — the more common
failure.

**Rates.** Prefer the provider's model-metadata endpoint; watch the units
(DeepInfra reports `cents_per_input_token`, Novita integers of 1/10,000 USD per
M). Aggregators are a cross-check only — they miss cached rates and
context-length bands. Cache prices are not always a clean ratio of input; don't
round them. Regional prices are verbatim, not multiples of the default region.
Listings both omit live models and keep retired ones, so probe when a listing
and reality disagree.

**Token semantics** — establish each from a live `usage` block:

- Reasoning inside `completion_tokens`? Usually yes. `costs.ts` keys this on the
  `completionIncludesReasoning` provider allowlist; a new provider that folds it
  in must be added there or output double-bills. xAI is the exception —
  reasoning is excluded and appears only in `completion_tokens_details`, which
  the generic parsers ignore unless wired up.
- Cached tokens inside `prompt_tokens`? `costs.ts` assumes yes and subtracts
  them.
- Cache writes priced (`cacheWriteInputPrice`, `cacheWriteInputPrice1h`)? A
  missing 1h rate silently bills 1h writes at the 5m rate.

**Reconcile.** Pin the provider and vary the prompt (Redis caches on the body):

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -H "Content-Type: application/json" \
  -d '{"model":"<provider>/<model>","messages":[{"role":"user","content":"hi"}]}'
```

For one small and one large request (crossing a tier boundary where there is
one): token counts must match between the upstream `usage` and the `log` row,
and a hand-computed cost must match `log.cost`. Where a provider echoes its own
cost (xAI `cost_in_usd_ticks`, DeepInfra `estimated_cost`), compare that too — a
bonus check, never a billing input. A gap that lands on a round percentage is an
account discount, not a metering bug.

If a handed-in price disagrees with the measurement, the measurement wins.

## 4. Metadata

Probe the deployment. The same model differs between providers, and an
`externalId` bump can silently drop a capability.

- `contextSize` / `maxOutput` — probe with an oversized prompt and read the
  rejection; listings under- and overstate.
- `vision` / `audio` / `document` — routing skips mappings lacking them. A
  deployment that 400s on images gets `vision: false`, never an error-text
  classification rule. `audio.e2e.ts` covers audio input.
- `supportedToolChoices` — probe `auto`, `none`, `required`, named function.
  Unlisted modes are downgraded to `auto`. Some deployments accept `required`
  only with thinking off.
- `jsonOutput` / `jsonOutputSchema` — probe `json_object` and `json_schema`
  separately.
- `supportedParameters` — probe before declaring; omission elsewhere is not a
  claim of non-support.
- `supportsDeveloperRole` / `supportsAssistantPrefill` — default true, flip only
  on a 400.
- `serviceTiers` — declaring one narrows routing pre-flight.
- `stability: "unstable"` / `test: "skip"` for flaky, paid-per-call or
  region-locked mappings; comment why.
- `releasedAt`, plus an `output` entry per capability flag — both enforced by
  `model-metadata.spec.ts`.

A new provider also needs a `providers.ts` entry, endpoint wiring in
`get-provider-endpoint.ts`, and possibly a `completionIncludesReasoning` entry.

## 5. Reasoning efforts

Efforts are forwarded as-is, so a declared tier the upstream rejects is a 4xx for
users, and each declared tier becomes an e2e case. Probe `none | minimal | low |
medium | high | xhigh | max` individually and declare the accepted subset in
ascending order — docs and reality diverge often, including between chat
completions and the Responses API.

| Toggle | Field |
| --- | --- |
| Standard effort tiers | `reasoningEfforts` alone |
| Thinks by default, vLLM chat-template flag | `chatTemplateThinkingKey: "<key>"` |
| Off by default, needs an enable flag | `requiresEnableThinking: true` |
| Off only via `thinking: {type:"disabled"}` | `requiresDisableThinkingParam: true` |
| Explicit token budget | `reasoningMaxTokens: true` |
| Anthropic adaptive thinking | `reasoningMode: "adaptive"` |
| Reasons but returns no reasoning content | `reasoningOutput: "omit"` |

Verify the toggle takes effect rather than just returning 200 — a provider can
accept `enable_thinking: false` and still return `reasoning_content`. Declare it
only on mappings where it works.

## 6. Image, video, and other endpoints

Probe the size/quality/duration grid; rate cards list tiers deployments refuse.
Leave rejected values off the mapping with a comment.

**Video** — `supportedVideoSizes`, `supportedVideoDurationsSeconds`,
`supportedVideoDurationsSecondsImageToVideo`, `supportsVideoAudio`,
`supportsVideoWithoutAudio`, `perSecondPrice`, model-level
`maxVideoDurationSeconds`. The studio derives its menus from those, but
frame/reference input is gated by hardcoded allowlists in
`mappingSupportsVideoRequest` and the `supportsVideoFrameInput` /
`supportsVideoReference*Input` helpers — add the model there, matched on root
model id, never `externalId`. Cover it in `video-gen.spec.ts`.

**Image** — `perImagePrice` (keyed by resolution, or `"<quality>/<resolution>"`
when both are priced), or `imageOutputPrice` + `imageOutputTokensByResolution`;
`imageInputPrice` / `imageInputTokensByResolution` for edit models;
`imageInputRequired` when it cannot run text-only. A `perImagePrice` map without
a `"default"` key falls back to its most expensive tier, so a wrong key
overcharges silently. `getModelImageConfig` is a hardcoded per-model switch — a
new model has no correct options until it is added, defaulting to the tier a
bare API call gets. If a newly priced knob isn't forwarded by
`prepare-request-body.ts`, you price tiers you never serve. Cover it in
`image-gen.spec.ts` and `costs.spec.ts`.

| Flag | Prices | e2e |
| --- | --- | --- |
| `imageGenerations` | above | `images.e2e.ts` |
| `embeddings` | input tokens only | `embeddings.e2e.ts` |
| `speechGenerations` | `outputAudioPrice`, `inputCharacterPrice`, `supportedVoices` | `speech.e2e.ts` |
| `transcriptions` | `inputAudioHourPrice` | `transcriptions.e2e.ts` |
| `ocr` | `ocrPagePrice` | `ocr.e2e.ts` |
| `rerank` | token prices | `rerank.e2e.ts` |

`realtime` has no e2e file — it is covered by `apps/gateway/src/realtime/*.spec.ts`
plus `realtime-models.spec.ts`, which fails any realtime mapping missing its
per-modality token prices. `realtimeTranscription` only on token-metered ASR
mappings.

Image and video are the one docs exception to never enumerating models: update
`apps/docs/content/features/{image,video}-generation.mdx`.

## 7. Verify

Use an isolated stack so another worktree can't corrupt the run.

The gateway resolves models from the catalogue, so a rebuild is enough for API
requests. The playground and dashboard read the DB via `/internal/models`, so
run `pnpm seed` before expecting a new model in any UI.

```bash
pnpm test:unit
pnpm build:core && pnpm exec vitest run packages/models packages/actions apps/gateway/src/lib/costs.spec.ts

TEST_MODELS="deepinfra/ling-3.0-flash,novita/ling-3.0-flash" FULL_MODE=true pnpm test:e2e
```

- Scope e2e with `TEST_MODELS` — never run the full suite, and don't invoke the
  `*.e2e.ts` files one by one. It overrides `test: "skip"`, takes regions as
  `provider/model:region`, and fails loudly when an entry matches no mapping.
- `FULL_MODE=true` expands the per-effort cases and includes free models.
- API key env names aren't derivable from the provider id — read
  `env.required.apiKey` from `providers.ts` (xAI is `LLM_X_AI_API_KEY`, Vertex
  uses a service-account JSON). Keys can be region-scoped: a 401 on one region
  while a sibling works is the key, not the code.
- `CI=true` adds retries and longer timeouts for slow or quota-limited models.
- e2e asserts shape, not cost — the §3 reconciliation is the only pricing check.

For image/video models, open the studio and confirm the offered
sizes/qualities/durations match exactly what the deployment accepted in §6.

## 8. When something fails

| Symptom | Cause |
| --- | --- |
| JSON output cases fail | deployment rejects `response_format`; set `jsonOutput: false` and drop it from `supportedParameters` |
| Reasoning-effort case 400s | trim the tier from `reasoningEfforts` |
| Forced tool_choice 400s | narrow `supportedToolChoices` |
| Vision case 400s | `vision: false` on that mapping |
| Cost ~2x the provider's on reasoning requests | reasoning double-counted — add the provider to `completionIncludesReasoning` |
| Cost far below on reasoning requests | reasoning tokens never extracted (nested `completion_tokens_details`) |
| Cost mismatch only on long prompts | wrong or missing `pricingTiers` band |
| `thought_signature` / 404 flakes in Gemini or Responses suites | known cross-suite cache race; re-run |
| Sporadic 429/502 on Vertex/partner models | quota; re-run with `CI=true` |
| Manual curl hits the wrong provider | missing `x-no-fallback: true` |

If a failure predates the change, fix what's in scope and say in the PR that it
also fails on `main`.

## 9. Finish

`pnpm format`, `pnpm build`, conventional title, then the `pull-request` skill.

Never merge — and never enable auto-merge on — a mapping that does not actually
work: it could not serve a live request, or its scoped e2e fails with no fix
available from our side. `stability: "unstable"` and `test: "skip"` keep CI green
and keep the mapping out of routing, but they do not make the model work. Say
plainly that it does not work and why, leave the PR open, and hand the merge
decision to the user. Same for prices nobody could verify.

The PR body carries the evidence:

- Per mapping: external id, prices, context, max output, capabilities.
- How each price was verified — rates, token counts, hand-computed cost,
  `log.cost`.
- Reasoning tiers accepted vs rejected; for image/video, the accepted grid.
- The scoped e2e command and its result per mapping.
- Anything corrected from the handed-in values, with both numbers.
- Anything not verified, and why.

Screenshots only for image and video models: the studio selector and the
generated result, both themes, via the `pull-request` skill's screenshot
workflow. Text models need none — scoped e2e is the evidence.
