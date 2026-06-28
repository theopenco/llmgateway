import type { ProviderId, ProviderRequestBody } from "@llmgateway/models";

/**
 * Providers that select the processing tier via the `service_tier` request
 * body field (the Gemini Developer API). Vertex AI uses the
 * `X-Vertex-AI-LLM-Shared-Request-Type` header instead — see getProviderHeaders.
 */
const BODY_TIER_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
	"google-ai-studio",
	"glacier",
]);

/**
 * Inject the OpenAI-compatible `service_tier` into a Gemini Developer API
 * request body when the caller selected Flex or Priority inference. No-op for
 * standard/default tiers, FormData bodies, and providers that don't use the
 * body field (e.g. Vertex, which is handled via a request header).
 */
export function applyGoogleServiceTier(
	body: ProviderRequestBody | FormData,
	provider: ProviderId,
	serviceTier: string | undefined,
): void {
	if (serviceTier !== "flex" && serviceTier !== "priority") {
		return;
	}
	if (!BODY_TIER_PROVIDERS.has(provider) || body instanceof FormData) {
		return;
	}
	(body as { service_tier?: string }).service_tier = serviceTier;
}

/**
 * Canonical upstream base URLs for the Google providers that honor the
 * OpenAI-compatible `service_tier` (Flex / Priority). A premium tier is only
 * guaranteed to apply when the request reaches Google directly: a provider key
 * pointing at a proxy / custom base URL may silently drop the tier header (Vertex)
 * or body field (AI Studio), so the gateway would bill and report the standard
 * tier even though the caller asked for Flex/Priority. Service-tier routing is
 * therefore restricted to keys that target these endpoints.
 */
const SERVICE_TIER_UPSTREAM_BASE_URLS: Partial<Record<ProviderId, string>> = {
	"google-ai-studio": "https://generativelanguage.googleapis.com",
	"google-vertex": "https://aiplatform.googleapis.com",
};

/**
 * The OpenAI-compatible processing tiers that select premium (Flex / Priority)
 * inference. Shared so every service-tier code path agrees on the accepted
 * values instead of re-inlining the literal union.
 */
export function isPremiumServiceTier(
	serviceTier: string | null | undefined,
): serviceTier is "flex" | "priority" {
	return serviceTier === "flex" || serviceTier === "priority";
}

/**
 * Vertex-compatible providers serve Flex through the deprioritized shared-PayGo
 * path (the `X-Vertex-AI-LLM-Shared-Request-Type: flex` header). Native web
 * search (grounding) is a far heavier request — the model fans out to live
 * search before generating — and on this path it routinely exceeds client
 * timeouts (measured tens of seconds up to >200s, vs ~40s on the standard tier
 * and ~35s on Priority), so callers see empty responses at a high rate.
 *
 * AI Studio's Flex serves grounding quickly (~30-50s) and is deliberately
 * excluded — only the Vertex shared-Flex path has this problem.
 */
const VERTEX_FLEX_GROUNDING_PROVIDERS: ReadonlySet<ProviderId> =
	new Set<ProviderId>(["google-vertex", "quartz"]);

/**
 * Whether a requested premium tier must be dropped because it can't reliably
 * serve a native web search (grounding) request. Vertex Flex + grounding times
 * out far too often to be usable, so when web search is enabled we never
 * forward Flex to a Vertex provider: the request falls back to the standard
 * tier (working, billed as standard) instead of timing out. Priority handles
 * grounding fine and is left untouched, as is AI Studio Flex.
 */
export function webSearchDisablesServiceTier(
	provider: ProviderId,
	serviceTier: string | null | undefined,
	webSearchEnabled: boolean,
): boolean {
	return (
		webSearchEnabled &&
		serviceTier === "flex" &&
		VERTEX_FLEX_GROUNDING_PROVIDERS.has(provider)
	);
}

function normalizeServiceTierBaseUrl(baseUrl: string): string {
	// Strip trailing slashes without a backtracking regex (avoids the
	// polynomial-ReDoS CodeQL flags for `/\/+$/` on attacker-influenced input).
	const trimmed = baseUrl.trim();
	let end = trimmed.length;
	while (end > 0 && trimmed[end - 1] === "/") {
		end--;
	}
	return trimmed.slice(0, end).toLowerCase();
}

/**
 * Whether a provider key's base URL is eligible to carry a Flex/Priority
 * service-tier request. Eligible when the provider has no upstream-only rule, or
 * when the key uses the managed default (no custom base URL), or when the custom
 * base URL exactly matches the provider's canonical upstream. A custom base URL
 * on google-ai-studio / google-vertex is the only case this rejects.
 */
export function providerKeyBaseUrlSupportsServiceTier(
	provider: ProviderId,
	baseUrl: string | null | undefined,
): boolean {
	const upstream = SERVICE_TIER_UPSTREAM_BASE_URLS[provider];
	if (!upstream) {
		return true;
	}
	if (!baseUrl) {
		return true;
	}
	return (
		normalizeServiceTierBaseUrl(baseUrl) ===
		normalizeServiceTierBaseUrl(upstream)
	);
}

/**
 * Resolve the processing tier the provider actually served from the upstream
 * response signals. Returns "flex" / "priority", or null for the standard tier
 * (including when Google downgraded an unsupported tier to standard).
 *
 * - Vertex AI reports the served tier in `usageMetadata.trafficType`
 *   (`ON_DEMAND_PRIORITY` / `ON_DEMAND_FLEX` / `ON_DEMAND`).
 * - The Gemini Developer API (AI Studio / glacier) reports it in the
 *   `x-gemini-service-tier` response header (`priority` / `flex` / `standard`).
 *
 * Billing keys off this value rather than the requested tier so a downgraded
 * request is charged at the rate it actually ran at.
 */
export function resolveServedServiceTier(signals: {
	trafficType?: string | null;
	serviceTierHeader?: string | null;
}): "flex" | "priority" | null {
	const trafficType = signals.trafficType?.toUpperCase();
	if (trafficType === "ON_DEMAND_PRIORITY") {
		return "priority";
	}
	if (trafficType === "ON_DEMAND_FLEX") {
		return "flex";
	}
	const header = signals.serviceTierHeader?.toLowerCase();
	if (header === "priority") {
		return "priority";
	}
	if (header === "flex") {
		return "flex";
	}
	return null;
}
