import { randomUUID } from "node:crypto";

import type { Provider } from "@llmgateway/models";

/**
 * Native Anthropic passthrough signalling.
 *
 * The native Anthropic `/v1/messages` endpoint serves requests by calling the
 * internal `/v1/chat/completions` pipeline and translating the response back to
 * Anthropic shape. That round-trip is lossy for Anthropic-native content (web
 * search `server_tool_use`/`web_search_tool_result` blocks, inline citations,
 * thinking blocks). When the resolved provider is Anthropic-native, the upstream
 * response is already in the exact shape the client wants, so the pipeline
 * returns it verbatim instead.
 *
 * `/v1/messages` asks for this by setting the header below to the per-process
 * nonce. The nonce is random and never exposed to clients, so a direct
 * `/v1/chat/completions` request cannot forge it (a static value would be
 * forgeable since both endpoints share the same Hono app). The header is only
 * ever set on the internal `app.request()` call and is never forwarded to an
 * upstream provider or logged.
 */
export const NATIVE_ANTHROPIC_PASSTHROUGH_HEADER =
	"x-native-anthropic-passthrough";

export const nativeAnthropicPassthroughNonce = randomUUID();

/**
 * Field carrying the raw upstream Anthropic response body on the internal
 * OpenAI response object. Only present when passthrough is active; read and
 * stripped by the `/v1/messages` handler.
 */
export const NATIVE_ANTHROPIC_PASSTHROUGH_FIELD =
	"__nativeAnthropicPassthrough";

/**
 * Providers whose native response is already the Anthropic Messages shape.
 * aws-bedrock uses the Converse API shape and is intentionally excluded.
 */
export function isAnthropicNativeProvider(provider: Provider): boolean {
	return provider === "anthropic" || provider === "vertex-anthropic";
}
