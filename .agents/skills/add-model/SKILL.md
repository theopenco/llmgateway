---
name: add-model
description: Add a model or provider mapping to the catalogue, or verify one that was already written. Researches and double-checks pricing, sets capability and reasoning metadata, runs scoped e2e for every new mapping, and validates playground options for image/video models. Use when the user says "add a model", "add <model> on <provider>", "new provider mapping", "check the pricing for", "verify this model", or when a prompt or pull request touches packages/models/src/models.
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
  prices have been wrong in real PRs (a 44% output under-bill shipped in review),
  so "it was in the ticket" is not evidence.

## 0. Enumerate the scope first

Never work on one mapping when the change has several. Build the list before
touching anything:

```bash
git diff origin/main -- packages/models/src/models/   # for a PR / existing branch
gh pr diff <n> -- packages/models/src/models/         # for someone else's PR
```

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
| Request shaping (reasoning, tool_choice, image/video knobs) | `packages/actions/src/prepare-request-body.ts` |
| e2e suites | `apps/gateway/src/*.e2e.ts` (per-capability files, **not** `api.e2e.ts`) |
| Playground image options | `apps/playground/src/lib/image-gen.ts` |
| Playground video options | `apps/playground/src/lib/video-gen.ts` |
| Image/video docs | `apps/docs/content/features/{image,video}-generation.mdx` |

Hard rules from `CLAUDE.md` that bite here:

- Write each model and mapping out **in full as a plain object literal**. Never a
  `makeModel()`-style helper — `packages/models` is the one place duplication wins.
- Per-token prices use **`e-6` notation** so the coefficient reads as USD per
  million (`"1.4e-6"` = $1.40/M). Not `e-3`. Does not apply to `requestPrice`,
  `perImagePrice`, `perSecondPrice` (flat USD).
- **Never two mappings with the same `providerId`** under one model. The lookup
  keys on `(providerId, region)`, so the second is unaddressable and bills at the
  first one's prices. Regional variants → `regions: []`. A genuinely different
  upstream deployment → its own root model `id`.
- Models and mappings are **never deleted** — set `deactivatedAt: new Date("YYYY-MM-DD")`.
- Comments that merely cite a source or restate a value are banned. Comments
  explaining **why** a value is non-obvious (a `false` capability flag, a trimmed
  `reasoningEfforts`, a `test: "skip"`, a resolution the deployment rejects) are
  required — they stop the next person from "fixing" it back.

## 2. Research the price

Prices are the highest-risk field. Use at least **two independent sources**, and
make one of them the provider itself.

**Source ranking (best first):**

1. **The provider's own cost echo on a live call.** The strongest evidence there
   is: compute what our rates would bill and compare to what the provider says it
   charged. Known echo fields:
   - DeepInfra → `usage.estimated_cost`
   - xAI → `usage.cost_in_usd_ticks`
   - Alibaba/Novita and others → check the response `usage` block for any cost field
2. **The provider's model-metadata endpoint** (`/models`, `/models/list`, console
   API). DeepInfra's listing carries authoritative per-token pricing; Novita
   reports integer units of 1/10,000 USD per M.
3. **The provider's published pricing page** (web search / fetch it).
4. Aggregators (OpenRouter, models.dev). Useful for a sanity check, never
   authoritative — they confirm base rates but routinely miss cached-input rates
   and context-length price bands.

**Known traps:**

- **Price tiers are what aggregators miss.** Long-context bands (e.g. doubling
  above 200K), Alibaba's input-length bands, and cached-input rates need to come
  from the provider directly. Verify tiers, not just the base price.
- **Cache prices are not always a clean ratio** of input price. Do not "fix" an
  odd ratio to a round one — use what the provider publishes.
- **Regional prices are verbatim**, not the default region's price times a
  multiplier. Odd-looking ratios between regions are usually real.
- **Discounts distort measured cost.** A measured/list ratio that is a round
  percentage (e.g. 0.7) is an account discount, not a metering bug — check the
  ratio before hunting for a gateway defect.
- **Reasoning tokens are already inside `completion_tokens`** for nearly every
  provider — never bill them on top. xAI is the known exception (nested under
  `completion_tokens_details.reasoning_tokens`, excluded from `completion_tokens`).
  If a new provider looks like an exception, prove it from a live `usage` block
  before changing the cost path.

**The verification that actually closes this out:** run a real request through a
local gateway and compare `log.cost` against the provider's own number.

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -d '{"model":"<provider>/<model>","messages":[{"role":"user","content":"hi"}]}'
```

Pin the provider and disable fallback, or a failing mapping silently routes
elsewhere and you verify the wrong thing. Vary the prompt between runs — the
gateway caches responses (and errors) in Redis keyed on the request body. Do at
least one small and one large request so a tier boundary shows up. Use
`decimal.js` semantics when reconciling; never eyeball float math.

If a price you were handed disagrees with what you measured, **the measurement
wins** — fix the mapping and say so explicitly in the PR body with the numbers
side by side.

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
  rule instead; that is explicitly forbidden.
- `tools`, `parallelToolCalls`, `supportedToolChoices` — probe each `tool_choice`
  mode (`auto`, `none`, `required`, named function). Unsupported modes go in
  `supportedToolChoices` so the gateway downgrades to `auto` instead of 400ing.
  Several deployments accept `required` only while thinking is off.
- `jsonOutput`, `jsonOutputSchema` — probe both `json_object` and `json_schema`.
  A provider advertising "structured outputs" in marketing may reject it per model.
- `supportedParameters` — the parameters we forward raw. Omission is not a claim
  of non-support; never route on their silence. Probe `stop`,
  `frequency_penalty`, `presence_penalty` if you intend to declare them.
- `supportsDeveloperRole`, `supportsAssistantPrefill` — default `true`; set
  `false` only after seeing the 400.
- `quantization` — only when the provider documents the serving precision.
- `serviceTiers` — declaring a tier narrows routing pre-flight. Only add tiers the
  upstream actually prices and serves.
- `stability` / `test` — a flaky or throttled deployment gets
  `stability: "unstable"`, and `test: "skip"` when a run costs real money per call
  (video, image) or the model is region-locked. Always leave a comment saying why.
- `releasedAt` — **required on every model**; `model-metadata.spec.ts` fails
  without it.
- `output` — must include the matching entry for every capability flag
  (`imageGenerations`→`"image"`, `videoGenerations`→`"video"`, `embeddings`,
  `speechGenerations`, `ocr`, `transcriptions`, `rerank`). Enforced by
  `model-metadata.spec.ts`.

New provider entirely? It needs a `providers.ts` entry with `env.required.apiKey`
(`LLM_<PROVIDER>_API_KEY`), data policy, headquarters, terms/privacy URLs, plus
endpoint wiring in `packages/actions/src/get-provider-endpoint.ts`. That is a
bigger change than a mapping — say so rather than burying it.

## 4. Reasoning efforts

`reasoningEfforts` is not documentation — it drives the model APIs, the playground
selector, and one e2e case **per declared tier**. Efforts are forwarded to the
provider as-is, so a tier you declare but the upstream rejects is a guaranteed
failure for users.

Probe every tier of `none | minimal | low | medium | high | xhigh | max`
individually against the live deployment and declare the exact accepted subset,
in ascending order. Documented tiers and accepted tiers differ constantly (a
model may accept an undeclared tier, or 400 on one the docs list; some accept an
effort on the Responses API but reject it on chat completions).

Related fields, pick the one that matches how the model actually toggles thinking:

| Situation | Field |
| --- | --- |
| Standard `reasoning_effort` tiers | `reasoningEfforts` alone |
| Thinks by default, only a vLLM chat-template flag | `chatTemplateThinkingKey: "<key>"` |
| Off by default, needs an explicit enable flag | `requiresEnableThinking: true` |
| Only turns off via top-level `thinking: {type:"disabled"}` | `requiresDisableThinkingParam: true` |
| Explicit token budget supported | `reasoningMaxTokens: true` |
| Anthropic adaptive thinking (Opus 4.7+) | `reasoningMode: "adaptive"` |
| Model reasons but returns no reasoning content | `reasoningOutput: "omit"` |

Verify the toggle actually works — do not trust a 200. A provider can accept
`enable_thinking: false` and keep returning `reasoning_content`; when that
happens, only declare the control on the mappings where it takes effect, and
comment why the sibling mapping differs.

Never bill reasoning tokens twice: see the price section.

## 5. Image, video, and other non-chat models

The catalogue drives the playground selectors, so wrong metadata here shows up as
a user picking an option the provider rejects.

**Probe the grid, don't copy the rate card.** Console rate cards list tiers the
deployment refuses. For every size/resolution/quality/duration value, send one
real request and record accepted vs rejected. Leave the rejected ones **off** the
mapping with a comment saying the deployment 400s on them.

**Video** (`videoGenerations: true`):

- `supportedVideoSizes`, `supportedVideoDurationsSeconds`,
  `supportedVideoDurationsSecondsImageToVideo`, `supportsVideoAudio`,
  `supportsVideoWithoutAudio`, `perSecondPrice` (keyed `default`/`4k`/`*_audio`/
  `*_video`), model-level `maxVideoDurationSeconds`.
- The studio derives its size/duration menus from these fields via
  `apps/playground/src/lib/video-gen.ts` — but frame-input and reference-input
  support is gated by **hardcoded provider/model allowlists** in
  `mappingSupportsVideoRequest` and the `supportsVideoFrameInput` /
  `supportsVideoReference*Input` helpers. A new model that accepts image/video/
  audio conditioning must be added there, matched on the **root model id**, never
  the `externalId`.
- Add a `video-gen.spec.ts` case asserting the accepted grid and the rejected one.

**Image** (`imageGenerations: true`):

- `perImagePrice` (keyed by resolution tier, or `"<quality>/<resolution>"` when
  both knobs are priced), or `imageOutputPrice` +
  `imageOutputTokensByResolution`; `imageInputPrice` /
  `imageInputTokensByResolution` for edit models; `imageInputRequired` on the
  model when it cannot run text-only.
- `getModelImageConfig` in `apps/playground/src/lib/image-gen.ts` is a
  **hardcoded per-model substring switch** — sizes, qualities, defaults, aspect
  ratios, max input images. A new image model gets no correct options until it is
  added there. Default the playground to the same tier a bare API call gets, so
  the playground and the API produce the same image at the same price.
- If a quality/resolution knob is newly priced, check the gateway actually
  forwards it (`packages/actions/src/prepare-request-body.ts`) and that billing
  resolves the tier through the same mapper. Otherwise you price four tiers and
  only ever serve the default.
- Cover it in `image-gen.spec.ts` and `costs.spec.ts`.

**Other endpoints** — `embeddings`, `speechGenerations` (+ `supportedVoices`,
`outputAudioPrice`, `inputCharacterPrice`), `transcriptions`
(`inputAudioHourPrice`), `ocr` (`ocrPagePrice`), `rerank`, `realtime`. Each
routes to a dedicated gateway endpoint and has its own e2e file
(`embeddings.e2e.ts`, `speech.e2e.ts`, `transcriptions.e2e.ts`, `ocr.e2e.ts`,
`rerank.e2e.ts`, `images.e2e.ts`).

**Docs**: the general rule is never to enumerate models in docs — the one
exception is image and video generation, where per-model sizes/durations/
resolutions are how users call them. Update
`apps/docs/content/features/{image,video}-generation.mdx` for those.

## 6. Verify

Work on an isolated stack (own Postgres/Redis/ports per `CLAUDE.md`) so another
worktree cannot corrupt the run.

**Unit tests.** Catalogue invariants plus anything you touched:

```bash
pnpm test:unit
# faster loop:
pnpm build:core && npx vitest run packages/models packages/actions apps/gateway/src/lib/costs.spec.ts
```

**Scoped e2e — required for every new mapping.** Never run the full suite; scope
with `TEST_MODELS`, which overrides `test: "skip"` and runs *all* e2e files for
just those mappings. Do not invoke the `*.e2e.ts` files one by one.

```bash
TEST_MODELS="deepinfra/ling-3.0-flash,novita/ling-3.0-flash" FULL_MODE=true pnpm test:e2e
```

- List **every** new mapping, comma-separated; regional ones as
  `provider/model:region`. The harness fails loudly if an entry matches zero
  mappings — a good typo check.
- `FULL_MODE=true` is what expands the per-reasoning-effort cases and includes
  free models. Without it you never test the tiers you declared.
- Needs `LLM_<PROVIDER>_API_KEY` in the environment for each provider. Some keys
  are region- or account-scoped: a 401/403 on one region with a working sibling is
  usually the key, not the code. Say which mappings you could not exercise and why.
- `CI=true` adds retries and longer timeouts — appropriate for slow image/video
  models and for providers that 429 under quota.

**Live billing check.** Section 2. Do this even when e2e is green: e2e asserts
shape, not cost.

**DB-backed surfaces.** The models API (and therefore the playground and
dashboard) reads `model_provider_mapping` from the database, joined with
catalogue fields. A new model does not appear until the DB is synced — run
`pnpm seed` (or `pnpm setup`) locally, then check the playground selector.

**Playground check for image/video models.** Start the stack, open the image or
video studio, select the new model, and confirm the offered
sizes/qualities/durations exactly match what the deployment accepted in step 5 —
no extra option, no missing one. Screenshot it: playground/UI changes need
before/after screenshots in the PR, in both light and dark.

## 7. When something fails

Fix it — a failing e2e case is the deliverable, not an obstacle. Common causes:

| Symptom | Likely cause |
| --- | --- |
| `JSON output` / `JSON output streaming` fail | `jsonOutput` / `jsonOutputSchema` declared but the deployment rejects `response_format`. Set to `false` and drop `response_format` from `supportedParameters`. |
| A reasoning-effort case 400s | tier declared in `reasoningEfforts` that the upstream rejects. Trim the list. |
| Tool-call case 400s on forced choice | narrow `supportedToolChoices`. |
| Vision case 400s | set `vision: false` on that mapping. Never add an error-text reclassification rule. |
| Cost mismatch vs the provider's own number | wrong price, missing tier, or a reasoning-token double/zero count. |
| `thought_signature` / 404 flakes in Gemini or Responses suites | known cache-clearing race, not your mapping — re-run before investigating. |
| Sporadic 429/502 on Vertex/partner models | quota, not a bug. Re-run with `CI=true`. |
| Test passes for the wrong provider | missing `x-no-fallback: true` on a manual curl. |

If a failure is genuinely a pre-existing defect or an upstream limitation rather
than something this change introduced, fix what is in scope, and state plainly in
the PR which case fails, why, and that it also fails on `main`.

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
- **How each price was verified** — the provider figure next to our computed
  cost, with token counts.
- The reasoning tiers probed, with accepted vs rejected.
- For image/video: the accepted size/quality/duration grid, and what was rejected.
- The exact scoped e2e command and its result, per mapping.
- Anything corrected from the values you were handed, with both numbers.
- Anything **not** verified, and why (skipped e2e for a paid video model,
  region-locked key, etc.).
- Screenshots for playground/dashboard changes only, light + dark. Never
  screenshot docs.

Keep it public-safe: no customer names, org/project IDs, real key material, or
internal dollar amounts. Public provider pricing from `packages/models` is fine.
