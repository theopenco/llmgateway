---
name: gateway
description: Change the LLM Gateway request path in apps/gateway — chat and other endpoints, routing and provider selection, error and finish-reason classification, streaming, request logging, Redis use, user-supplied content URLs, and graceful shutdown. Use when editing apps/gateway/src or packages/actions request shaping, adding an endpoint, fetching remote content, changing fallback or routing, or debugging missing logs, hung Redis commands, or shutdown errors.
---

# Gateway request path

The gateway is latency-critical and high-throughput.

## Hot path

- Read no `log` rows on the request path, however narrow the query or short the cache. Credit gates, spend and limit checks, and routing signals come from Redis counters maintained on the write path (incremented at `insertLog`, settled by the billing worker) or small cached rows.
- Route on the capability field curated for it (`supportedToolChoices`, `serviceTiers`, `supportsAssistantPrefill`, …). `supportedParameters` is a partial list.
- Provider-bound reasoning (mappings where `usesEncryptedReasoning` holds: `reasoning: true` with the mapping's `encryptedReasoning` override or provider default) can only verify on the account that produced it. `chat/tools/reasoning-credential-pin.ts` pins a replaying turn to that credential, including a `pending_deletion` key; new credential selection must honor the pin. Before the first attempt, `stripForeignReasoning` drops OpenAI-format payloads pinned to another credential or already rejected (`rememberRejectedReasoning`), so a conversation that failed over does not fail once per turn. A retry that leaves the credential goes through `resolveProviderContextForRetry`, which drops all OpenAI-format encrypted reasoning; Gemini signatures cannot be dropped and still block fallback. A successful session fallback tombstones the optional reasoning it omitted, so an old credential pin cannot reclaim the session. New bound-reasoning shapes belong in `providerBoundReasoningIds`.
- Bare model ids route only to deployments in the model's full context-window tier (`getContextTierMinSize` in `packages/models`). Do not add prompt-size estimates to provider selection for a fixed model; chars/4 misjudges per-model tokenizers.

## User-supplied URLs

Fetch every content URL from a request body through `processImageUrl`
(`packages/actions/src/process-image-url.ts`), or for non-image content
`assertSafeUserContentUrl` from `@llmgateway/shared/url-safety-node` followed by
a `redirect: "error"` fetch. Keep `validateSsrf` on; only trusted
provider-response URLs pass `validateSsrf: false`. The guard enforces
https-only in every environment, blocks internal hosts and private, reserved,
link-local, metadata, and IPv4-mapped IPv6 addresses, and refuses redirects.
When the guard rejects a URL, fail the request; forwarding it upstream lets the
provider fetch what we refused. Download URLs in a provider response (video,
audio) are tenant-controlled under BYOK: fetch them with
`fetchProviderIssuedUrl` from `apps/gateway/src/lib/fetch-provider.ts`.
Worker requests to a BYOK base URL or webhook target pass `tenantControlled`
to `fetchWithSignals` in `apps/worker/src/services/video-jobs.ts`. Route every non-`data:` URL through the guard
wherever remote content is inlined (e.g. `requiresBase64Images` mappings).

Start content-download deadlines before URL/DNS validation and keep them through
body consumption. Race unabortable validation awaits; late completion must never
start a fetch. Cancel active readers on abort: some Node fetch runtimes lose body
aborts during garbage collection. Cover validation, header and body stalls with
real-HTTP and forced-GC regression tests.

## Errors

Keep `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts` conservative.
Generic 4xx wording such as "X is not supported for this model" or
`unsupported_content_type` stays a client error: users sending wrong requests
produce the same text, and reclassifying it triggers pointless fallback. When a
deployment rejects a capability the catalogue claims, fix that mapping's flag in
`packages/models` (e.g. `vision: false`). If asked for a broad reclassification,
raise the misclassification risk and confirm first.

## Content filter

The self-hosted classifier (`LLM_CONTENT_FILTER_INTERNAL_URL`) is stateless and
receives only the prompt. Every verdict, passes included, is stored on the log's
content filter response, the only record; it carries the prompt fingerprint
while the classifier runs with its hash-all option. Exports, including the
pseudonymized vendor sample, are in the `internal-classifier` skill.
Customer-facing log APIs never return the content filter log columns.

Every classifier fails open. OpenAI moderation retries a network error or 5xx
once and logs the retried attempt at `warn`. Final failures log at
`contentFilterErrorLogLevel`: `warn` for a 4xx other than 401/403, else `error`.

## Logging, streaming, shutdown

- Pass `{ retentionLevel }` to every `insertLog` call; the one-argument form drops payloads for retaining orgs.
- Log a pre-provider rejection in `chat.ts` with `logGatewayRejection` before throwing; `app.onError` writes no log.
- Import `streamSSE` from `apps/gateway/src/lib/pending-work.ts`, not `hono/streaming`, so graceful shutdown waits for the billing tail.
- From response-lifecycle callbacks (`close` handlers, middleware `finally`), send Redis commands through `redisClient.pipeline().<cmd>().exec()`. An auto-pipelined bare command there can wedge the shared client.
