---
name: add-model
description: Add a model or provider mapping to the catalogue, or verify one that was already written. Researches and double-checks per-token pricing, sets capability and reasoning metadata, runs scoped e2e for every new mapping, and validates playground options for image/video models. Use when the user says "add a model", "add <model> on <provider>", "new provider mapping", "check the pricing for", "verify this model", or when a prompt or pull request touches packages/models/src/models.
---

# Add a model

Every model in this repo is a billing surface. A wrong price silently over- or
under-charges every request until someone audits it, and a wrong capability flag
routes traffic to a deployment that 400s. So the job is never "write the object
literal" — it is **prove every declared value against the live provider**.

Two entry points, same work:

- **Nothing written yet** — research everything, then write the mapping.
- **Values already provided** (a prompt, a PR, a provider's announcement) — treat
  every number as unverified. Re-derive it independently and reconcile. Handed-in
  prices have been wrong in merged-review PRs (a 44% output under-bill was caught
  during review), so "it was in the ticket" is not evidence.

## 0. Enumerate the scope first

Never work on one mapping when the change has several. Build the list before
touching anything:

```bash
# your own branch
git diff origin/main...HEAD -- packages/models/src/models/

# someone else's PR — check it out (this also sets the upstream), then diff the same way
gh pr checkout <n>
git diff origin/main...HEAD -- packages/models/src/models/
```

`gh pr diff <n> --name-only` is a quick way to see which files a PR touches
without checking it out. It takes no path argument — `gh pr diff <n> -- <path>`
fails with "accepts at most 1 arg(s)".

Write down every `(rootModelId, providerId, region)` triple that is new or
changed — regions inside a `regions: []` array each count as their own mapping,
because each has its own prices and its own e2e case. Carry that list through
every later step and report per-mapping results at the end. A model is not done
because one of its four mappings passed.

## 1. Where things live

| What | Where |
| --- | --- |
| Model + mapping definitions | `packages/models/src/models/<family>.ts` |
| Family registration | `packages/models/src/models.ts` (`models` array) |
| Field documentation | `packages/models/src/models.ts` (`ProviderModelMapping`, `ModelDefinition`) |
| Provider definitions, env vars, regions, service tiers | `packages/models/src/providers.ts` |
| Catalogue invariants (tests) | `packages/models/src/model-metadata.spec.ts`, `providers.spec.ts` |
| Cost engine | `apps/gateway/src/lib/costs.ts` (+ `costs.spec.ts`) |
| Token extraction | `apps/gateway/src/chat/tools/extract-token-usage.ts`, `parse-provider-response.ts` |
| Request shaping (reasoning, tool_choice, image/video knobs) | `packages/actions/src/prepare-request-body.ts` |
| Endpoint/auth wiring for a new provider | `packages/actions/src/get-provider-endpoint.ts` |
| e2e suites | `apps/gateway/src/*.e2e.ts` — per-capability files (`chat-*.e2e.ts`, `images.e2e.ts`, …). `CLAUDE.md` still points at `api.e2e.ts`; that file no longer exists, it was split into the `chat-*` suites |
| Playground image options | `apps/playground/src/lib/image-gen.ts` |
| Playground video options | `apps/playground/src/lib/video-gen.ts` |
| Image/video docs | `apps/docs/content/features/{image,video}-generation.mdx` |

Hard rules from `CLAUDE.md` that bite here:

- Write each model and mapping out **in full as a plain object literal**. Never a
  `makeModel()`-style helper — `packages/models` is the one place duplication wins.
- Per-token prices use **`e-6` notation** so the coefficient reads as USD per
  million (`"1.4e-6"` = $1.40/M). Not `e-3`. Does not apply to `requestPrice`,
  `perImagePrice`, `perSecondPrice` (flat USD amounts).
- **Never two mappings with the same `providerId`** under one model. The lookup
  keys on `(providerId, region)`, so the second is unaddressable and bills at the
  first one's prices. Regional variants → `regions: []`. A genuinely different
  upstream deployment → its own root model `id`.
- Models and mappings are **never deleted** — set `deactivatedAt: new Date("YYYY-MM-DD")`.
- Comments that merely cite a source or restate a value are banned. Comments
  explaining **why** a value is non-obvious (a `false` capability flag, a trimmed
  `reasoningEfforts`, a `test: "skip"`, a resolution the deployment rejects) are
  required — they stop the next person from "fixing" it back.

## 2. Pricing: the cost model is tokens, so verify tokens

**How billing actually works here.** `calculateCosts` in
`apps/gateway/src/lib/costs.ts` takes counts — prompt tokens, completion tokens,
cached tokens, reasoning tokens, cache-write tokens, audio tokens, image counts,
web-search counts, seconds of video — multiplies them by the per-token (or
per-unit) prices on the mapping, and sums with `decimal.js`. **Nothing in the
product ever reads a cost the provider reports.** There is no code path that
bills from `usage.estimated_cost` or similar. (`log.estimatedCost` is unrelated:
it is a boolean marking that our own token counts were estimated.)

Two consequences that shape all of this work:

1. The research target is the provider's **per-token rate card**, in the same
   units the catalogue stores.
2. A price can be perfect and the bill still wrong, because the **token
   semantics** were misread. That is the more common failure.

### 2a. Get the rates

Use at least two sources and make one of them the provider itself:

1. **The provider's model-metadata endpoint** (`/models`, `/models/list`, console
   API) — machine-readable and usually authoritative. Watch the units: DeepInfra
   reports `cents_per_input_token`; Novita reports integers in 1/10,000 USD per M.
2. **The provider's published pricing page** (web search / fetch).
3. Aggregators (OpenRouter, models.dev) — cross-check only. They confirm base
   rates but routinely miss cached-input rates and context-length price bands.

Known traps:

- **Tiers are what aggregators miss.** Long-context bands (e.g. doubling above
  200K), Alibaba's input-length bands, and cached-input rates must come from the
  provider. Verify tiers, not just the base rate.
- **Cache prices are not always a clean ratio** of input price. Do not round an
  odd ratio to a tidy one — use the published number.
- **Regional prices are verbatim**, not the default region's price times a
  multiplier. Odd-looking ratios between regions are usually real.
- **Listings lie in both directions**: a model can be missing from `/models` yet
  serve fine, and a retired model can still be listed. Probe with a cheap
  inference call when the listing and reality disagree.

### 2b. Get the token semantics right

For each new mapping, establish from a **live `usage` block** — not from docs:

- **Are reasoning tokens already inside `completion_tokens`?** For almost every
  provider, yes; billing them again roughly doubles output cost on reasoning
  requests. `costs.ts` encodes this as an explicit provider allowlist,
  `completionIncludesReasoning`. A **new provider** that folds reasoning into
  `completion_tokens` must be added to that list. The known exception is xAI,
  whose `completion_tokens` *excludes* reasoning and reports it only under
  `completion_tokens_details.reasoning_tokens` — and nested details fields are not
  read by the generic parsers unless wired up
  (`extract-token-usage.ts` / `parse-provider-response.ts`).
- **Are cached tokens inside `prompt_tokens`?** `costs.ts` assumes yes and
  subtracts them before applying the uncached input rate. A provider that reports
  cached tokens *additively* would be double-counted.
- **Are cache-write tokens reported separately**, and does the mapping price them
  (`cacheWriteInputPrice`, `cacheWriteInputPrice1h`)? A missing 1h price silently
  bills 1h writes at the 5m rate.
- **For image-output models on OpenAI/Azure/xAI**, image tokens are folded into
  `prompt_tokens` and `costs.ts` apportions the cached share by ratio.

### 2c. Reconcile against a real request

Run the model through a locally running gateway, pinned so a failure cannot fall
back to another provider, and vary the prompt between runs — the gateway caches
responses (and errors) in Redis keyed on the request body:

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -H "Content-Type: application/json" \
  -d '{"model":"<provider>/<model>","messages":[{"role":"user","content":"hi"}]}'
```

Then, for at least one small and one large request (large enough to cross a tier
boundary if the mapping has tiers):

1. Read the token counts off the upstream `usage` block and off the gateway's
   `log` row — they must agree, including cached and reasoning counts.
2. Recompute the cost by hand from those counts and the catalogue rates, and
   compare to `log.cost`. A mismatch is a mapping bug or a token-semantics bug.
3. **If the provider happens to echo its own cost** — xAI's
   `usage.cost_in_usd_ticks`, DeepInfra's `usage.estimated_cost` — compare against
   it too. Most providers have no such field, so this is a bonus independent
   check, never a substitute for the token arithmetic and never a billing input.
   When it disagrees with our computed cost, the cause is almost always our rates
   or our token semantics.

A measured/list ratio that lands on a round percentage (e.g. 0.7) is an account
discount, not a metering bug — check that before hunting a gateway defect.

If a price you were handed disagrees with what you measured, **the measurement
wins** — fix the mapping and show both numbers in the PR body.

## 3. Metadata: verify, don't assume

Every flag below is a routing decision. Probe the deployment rather than copying
the model card — the same model on two providers regularly differs, and an
`externalId` bump on the *same* provider can silently drop a capability.

- `contextSize` / `maxOutput` — provider listings both understate and overstate
  these. When it matters, probe: send an oversized prompt and read the rejection
  message for the real number.
- `streaming` — `true`, `false`, or `"only"` (non-streaming auto-converted).
- `vision`, `audio`, `document` — routing skips mappings that lack these when the
  request carries that content. If the deployment 400s on image input, set
  `vision: false` on that mapping. **Do not** add an error-text reclassification
  rule instead; that is explicitly forbidden by `CLAUDE.md`. Audio *input* on a
  chat model is exercised by `audio.e2e.ts`, which is `TEST_MODELS`-aware like
  the rest.
- `tools`, `parallelToolCalls`, `supportedToolChoices` — probe each `tool_choice`
  mode (`auto`, `none`, `required`, named function). Unsupported modes go in
  `supportedToolChoices`, and `prepare-request-body.ts` downgrades to `auto`
  instead of letting the request 400. Several deployments accept `required` only
  while thinking is off.
- `jsonOutput`, `jsonOutputSchema` — probe both `json_object` and `json_schema`.
  A provider advertising "structured outputs" may reject it per model.
- `supportedParameters` — the parameters we forward raw. Omission is not a claim
  of non-support; never route on their silence. Probe `stop`,
  `frequency_penalty`, `presence_penalty` before declaring them.
- `supportsDeveloperRole`, `supportsAssistantPrefill` — default `true`; set
  `false` only after seeing the 400.
- `quantization` — only when the provider documents the serving precision.
- `serviceTiers` — declaring a tier narrows routing pre-flight. Only add tiers the
  upstream actually prices and serves.
- `stability` / `test` — a flaky or throttled deployment gets
  `stability: "unstable"`, and `test: "skip"` when a run costs real money per call
  (video, image) or the model is region-locked. Always comment why.
- `releasedAt` — **required on every model**; `model-metadata.spec.ts` fails
  without it.
- `output` — must include the matching entry for every capability flag
  (`imageGenerations`→`"image"`, `videoGenerations`→`"video"`, `embeddings`,
  `speechGenerations`, `ocr`, `transcriptions`, `rerank`). Enforced by
  `model-metadata.spec.ts`.

New provider entirely? It needs a `providers.ts` entry (env vars, data policy,
headquarters, terms/privacy URLs) plus endpoint and auth wiring in
`get-provider-endpoint.ts`, and possibly a `completionIncludesReasoning` entry
(§2b). That is a substantially bigger change than a mapping — say so rather than
burying it.

## 4. Reasoning efforts

`reasoningEfforts` is not documentation — it drives the models APIs, the
playground selector, and one e2e case **per declared tier**. Efforts are
forwarded to the provider **as-is**, with no downgrading of unsupported values
(see the comment in `prepare-request-body.ts`), so a tier you declare but the
upstream rejects is a guaranteed 4xx for users.

Probe every tier of `none | minimal | low | medium | high | xhigh | max`
individually against the live deployment and declare the exact accepted subset,
in ascending order. Documented and accepted tiers differ constantly — a model may
accept an undeclared tier, reject a documented one, or accept an effort on the
Responses API while rejecting it on chat completions.

Pick the field that matches how the model actually toggles thinking:

| Situation | Field |
| --- | --- |
| Standard `reasoning_effort` tiers | `reasoningEfforts` alone |
| Thinks by default, only a vLLM chat-template flag | `chatTemplateThinkingKey: "<key>"` |
| Off by default, needs an explicit enable flag | `requiresEnableThinking: true` |
| Only turns off via top-level `thinking: {type:"disabled"}` | `requiresDisableThinkingParam: true` |
| Explicit token budget supported | `reasoningMaxTokens: true` |
| Anthropic adaptive thinking (Opus 4.7+) | `reasoningMode: "adaptive"` |
| Model reasons but returns no reasoning content | `reasoningOutput: "omit"` |

Verify the toggle actually takes effect — do not trust a 200. A provider can
accept `enable_thinking: false` and keep returning `reasoning_content`; when that
happens, declare the control only on the mappings where it works and comment why
the sibling mapping differs.

Whatever you declare here, re-check the token accounting in §2b: reasoning tiers
are exactly where a double-billed or unbilled reasoning token shows up.

## 5. Image, video, and other non-chat models

The catalogue drives the playground selectors, so wrong metadata here surfaces as
a user picking an option the provider rejects.

**Probe the grid, don't copy the rate card.** Console rate cards list tiers the
deployment refuses. For every size/resolution/quality/duration value, send one
real request and record accepted vs rejected. Leave the rejected ones **off** the
mapping with a comment saying the deployment rejects them.

**Video** (`videoGenerations: true`):

- `supportedVideoSizes`, `supportedVideoDurationsSeconds`,
  `supportedVideoDurationsSecondsImageToVideo`, `supportsVideoAudio`,
  `supportsVideoWithoutAudio`, `perSecondPrice` (keyed `default`/`4k`/`*_audio`/
  `*_video`), model-level `maxVideoDurationSeconds`.
- The studio derives its size/duration menus from those fields in
  `apps/playground/src/lib/video-gen.ts` — but frame-input and reference-input
  support is gated by **hardcoded provider/model allowlists** in
  `mappingSupportsVideoRequest` and the `supportsVideoFrameInput` /
  `supportsVideoReference*Input` helpers. A new model that accepts image/video/
  audio conditioning must be added there, matched on the **root model id**, never
  the `externalId`.
- Add a `video-gen.spec.ts` case asserting both the accepted grid and a rejected
  combination.

**Image** (`imageGenerations: true`):

- `perImagePrice` (keyed by resolution tier, or `"<quality>/<resolution>"` when
  both knobs are priced), or `imageOutputPrice` +
  `imageOutputTokensByResolution`; `imageInputPrice` /
  `imageInputTokensByResolution` for edit models; `imageInputRequired` on the
  model when it cannot run text-only. A `perImagePrice` map without a `"default"`
  key falls back to its **most expensive** tier on a lookup miss, so a wrong tier
  key overcharges rather than failing loudly — get the keys right.
- `getModelImageConfig` in `apps/playground/src/lib/image-gen.ts` is a
  **hardcoded per-model substring switch** — sizes, qualities, defaults, aspect
  ratios, max input images. A new image model gets no correct options until it is
  added there. Default the playground to the same tier a bare API call gets, so
  the playground and the API produce the same image at the same price.
- If a quality/resolution knob is newly priced, check that the gateway actually
  forwards it (`prepare-request-body.ts`) and that billing resolves the tier
  through the same mappers. Otherwise you price four tiers and only ever serve
  the default.
- Cover it in `image-gen.spec.ts` and `costs.spec.ts`.

**Other endpoints** — each routes to a dedicated gateway endpoint and has its own
e2e file, which the scoped `TEST_MODELS` run picks up automatically:

| Flag | Prices it needs | e2e file |
| --- | --- | --- |
| `imageGenerations` | see above | `images.e2e.ts` |
| `embeddings` | input tokens only | `embeddings.e2e.ts` |
| `speechGenerations` | `outputAudioPrice`, `inputCharacterPrice`, plus `supportedVoices` | `speech.e2e.ts` |
| `transcriptions` | `inputAudioHourPrice` | `transcriptions.e2e.ts` |
| `ocr` | `ocrPagePrice` | `ocr.e2e.ts` |
| `rerank` | token prices | `rerank.e2e.ts` |

`realtime` is the exception: there is **no** `realtime.e2e.ts`. It is covered by
unit specs under `apps/gateway/src/realtime/*.spec.ts` (session, pricing,
Gemini session/pricing, transcription, upstream connect), plus a catalogue
invariant in `packages/models/src/realtime-models.spec.ts` that fails any
realtime mapping missing the per-modality prices billing depends on — so a
realtime mapping must declare its text, audio and image token prices, and
`realtimeTranscription` only on token-metered ASR mappings.

**Docs**: the general rule is never to enumerate models in docs — the single
exception is image and video generation, where per-model sizes/durations/
resolutions are how users call them. Update
`apps/docs/content/features/{image,video}-generation.mdx` for those.

## 6. Verify

Work on an isolated stack (own Postgres/Redis/ports per `CLAUDE.md`) so another
worktree cannot corrupt the run.

**Where a new model shows up, and when.** The gateway resolves models from the
catalogue package, so a rebuild is enough for API requests. The playground and
dashboard read `model_provider_mapping` from the **database** (via
`/internal/models`), which the seed generates from the catalogue — so run
`pnpm seed` (or `pnpm setup`) before expecting a new model in any UI.

**Unit tests.** Catalogue invariants plus anything you touched:

```bash
pnpm test:unit
# faster loop:
pnpm build:core && pnpm vitest run packages/models packages/actions apps/gateway/src/lib/costs.spec.ts
```

**Scoped e2e — required for every new mapping.** Never run the full suite; scope
with `TEST_MODELS`, which overrides `test: "skip"` and runs *all* e2e files for
just those mappings. Do not invoke the `*.e2e.ts` files one by one.

```bash
TEST_MODELS="deepinfra/ling-3.0-flash,novita/ling-3.0-flash" FULL_MODE=true pnpm test:e2e
```

- List **every** new mapping, comma-separated; regional ones as
  `provider/model:region` (a bare `provider/model` matches all its regions). The
  harness fails loudly when an entry matches zero mappings — a good typo check.
- `FULL_MODE=true` is what expands the per-reasoning-effort cases and includes
  free models. Without it you never exercise the tiers you declared.
- Each provider needs its API key in the environment. The variable name is **not
  mechanically derivable** from the provider id — read `env.required.apiKey` from
  `packages/models/src/providers.ts` (e.g. xAI is `LLM_X_AI_API_KEY`, Novita is
  `LLM_NOVITA_AI_API_KEY`, Vertex uses a service-account JSON). Some keys are
  region- or account-scoped: a 401/403 on one region while a sibling works is
  usually the key, not the code. Say which mappings you could not exercise and why.
- `CI=true` adds retries and longer timeouts — appropriate for slow image/video
  models and providers that 429 under quota.

**e2e does not check cost.** The cost assertions in the chat suites are commented
out; only a couple of suites assert cost at all. Green e2e says the shape is
right, never that the bill is. The §2c reconciliation is the only thing that
covers pricing.

**Playground check for image/video models.** Start the stack, seed, open the
image or video studio, select the new model, and confirm the offered
sizes/qualities/durations exactly match what the deployment accepted in §5 — no
extra option, no missing one. **Screenshot the selector** — this is the one place
a model addition needs screenshots, and it is the evidence that the catalogue
metadata and the UI agree.

**Text models need no screenshots.** Scoped e2e is the required and sufficient
verification for them. Do not run the playground to illustrate a text model.

## 7. When something fails

Fix it — a failing e2e case is the deliverable, not an obstacle. Common causes:

| Symptom | Likely cause |
| --- | --- |
| `JSON output` / `JSON output streaming` fail | `jsonOutput` / `jsonOutputSchema` declared but the deployment rejects `response_format`. Set to `false` and drop `response_format` from `supportedParameters`. |
| A reasoning-effort case 400s | tier declared in `reasoningEfforts` that the upstream rejects. Trim the list. |
| Tool-call case 400s on forced choice | narrow `supportedToolChoices`. |
| Vision case 400s | set `vision: false` on that mapping. Never add an error-text reclassification rule. |
| Computed cost is ~2x the provider's on reasoning requests | reasoning tokens counted twice — the provider belongs in `completionIncludesReasoning`. |
| Computed cost far below the provider's on reasoning requests | reasoning tokens not extracted at all (nested `completion_tokens_details`). |
| Cost mismatch only on long prompts | missing or wrong `pricingTiers` band. |
| `thought_signature` / 404 flakes in the Gemini or Responses suites | `clearCache` preserves only the Responses storage prefix; a known cross-suite race, not your mapping. Re-run before investigating. |
| Sporadic 429/502 on Vertex/partner models | quota, not a bug. Re-run with `CI=true`. |
| A manual curl passes but hits the wrong provider | missing `x-no-fallback: true`. |

If a failure is a pre-existing defect or an upstream limitation rather than
something this change introduced, fix what is in scope and state plainly in the
PR which case fails, why, and that it also fails on `main`.

## 8. Finish

```bash
pnpm format
pnpm build
```

Commit with a conventional title ≤50 chars (`feat(models): add <model>`), then use
the `pull-request` skill.

The PR body should carry the evidence, because that is the only place a reviewer
can check it:

- A table per mapping: external id, prices (in/out/cached, tiers), context,
  max output, capabilities.
- **How each price was verified** — the provider's per-token rates, the token
  counts from a real request, the hand-computed cost, and `log.cost`. Include the
  provider's own cost figure when it publishes one.
- The reasoning tiers probed, accepted vs rejected.
- For image/video: the accepted size/quality/duration grid, and what was rejected.
- The exact scoped e2e command and its result, per mapping.
- Anything corrected from the values you were handed, with both numbers.
- Anything **not** verified, and why (skipped e2e for a paid video model,
  region-locked key, and so on).

Screenshots:

- **Image and video models — required.** Attach playground screenshots of the
  image or video studio showing the new model's selector: the offered
  sizes/qualities/durations, and the generated result. Both themes, and
  before/after when an existing screen changed.
- **Text models — none.** Scoped e2e is the required and sufficient evidence.
  Don't spin up the playground for a text model.
- If the change also touches a dashboard UI (`apps/ui`, `apps/code`, `ee/admin`),
  the usual repo rule applies on top: before/after in both themes.

Use the `pull-request` skill's screenshot workflow to capture and attach them.

Keep it public-safe: no customer names, org/project IDs, key material, or
internal dollar amounts. Public provider pricing from `packages/models` is fine.
