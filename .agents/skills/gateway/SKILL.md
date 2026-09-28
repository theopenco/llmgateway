---
name: gateway
description: Change the LLM Gateway request path in apps/gateway — chat and other endpoints, routing and provider selection, error and finish-reason classification, streaming, request logging, Redis use, user-supplied content URLs, and graceful shutdown. Use when editing apps/gateway/src or packages/actions request shaping, adding an endpoint, fetching remote content, changing fallback or routing, or debugging missing logs, hung Redis commands, or shutdown errors.
---

# Gateway request path

The gateway is latency-critical and high-throughput.

## Hot path

- Read no `log` rows on the request path, however narrow the query or short the cache. Credit gates, spend and limit checks, and routing signals come from Redis counters maintained on the write path (incremented at `insertLog`, settled by the billing worker) or small cached rows.
- Route on the capability field curated for it (`supportedToolChoices`, `serviceTiers`, `supportsAssistantPrefill`, …). `supportedParameters` is a partial list.

## User-supplied URLs

Fetch every content URL from a request body through `processImageUrl`
(`packages/actions/src/process-image-url.ts`), or for non-image content
`assertSafeUserContentUrl` from `@llmgateway/shared/url-safety-node` followed by
a `redirect: "error"` fetch. Keep `validateSsrf` on; only trusted
provider-response URLs pass `validateSsrf: false`. The guard enforces
https-only in every environment, blocks internal hosts and private, reserved,
link-local, metadata, and IPv4-mapped IPv6 addresses, and refuses redirects.
When the guard rejects a URL, fail the request; forwarding it upstream lets the
provider fetch what we refused. Route every non-`data:` URL through the guard
wherever remote content is inlined (e.g. `requiresBase64Images` mappings).

## Errors

Keep `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts` conservative.
Generic 4xx wording such as "X is not supported for this model" or
`unsupported_content_type` stays a client error: users sending wrong requests
produce the same text, and reclassifying it triggers pointless fallback. When a
deployment rejects a capability the catalogue claims, fix that mapping's flag in
`packages/models` (e.g. `vision: false`). If asked for a broad reclassification,
raise the misclassification risk and confirm first.

## Logging, streaming, shutdown

- Pass `{ retentionLevel }` to every `insertLog` call; the one-argument form drops payloads for retaining orgs.
- Log a pre-provider rejection in `chat.ts` with `logGatewayRejection` before throwing; `app.onError` writes no log.
- Import `streamSSE` from `apps/gateway/src/lib/pending-work.ts`, not `hono/streaming`, so graceful shutdown waits for the billing tail.
- From response-lifecycle callbacks (`close` handlers, middleware `finally`), send Redis commands through `redisClient.pipeline().<cmd>().exec()`. An auto-pipelined bare command there can wedge the shared client.
