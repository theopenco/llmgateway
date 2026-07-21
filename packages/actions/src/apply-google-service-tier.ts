import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";

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
 * The Google providers the gateway forwards premium tiers to via Google's
 * transports: the `service_tier` body field (BODY_TIER_PROVIDERS) or the
 * Vertex request headers. A premium tier is only guaranteed to apply when the
 * request reaches Google's real upstream — a key pointing at a proxy / custom
 * base URL may silently drop the tier and the request is served (and billed)
 * as standard, never at the tier the caller asked for. Service-tier routing
 * is therefore restricted to keys targeting the provider's default base URL.
 */
const GOOGLE_TIER_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
	...BODY_TIER_PROVIDERS,
	"google-vertex",
]);

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
 * service-tier request. Eligible when the provider is not one of the Google
 * tier providers, when the key uses the managed default (no custom base URL),
 * or when the custom base URL exactly matches the provider's default base URL
 * (its real upstream). A custom base URL on google-ai-studio / google-vertex
 * is the only case this rejects — glacier has no static default base URL
 * (env-defined deployment), so there is no canonical upstream to enforce.
 */
export function providerKeyBaseUrlSupportsServiceTier(
	provider: ProviderId,
	baseUrl: string | null | undefined,
): boolean {
	if (!GOOGLE_TIER_PROVIDERS.has(provider) || !baseUrl) {
		return true;
	}
	const upstream = getProviderDefaultBaseUrl(provider);
	if (!upstream) {
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
 *   `x-gemini-service-tier` response header (`priority` / `flex` / `standard`)
 *   on unary responses, but streaming responses omit that header and instead
 *   carry it in the body as `usageMetadata.serviceTier` (`flex` / `priority` /
 *   `standard`). Both are checked so streaming requests aren't misread as
 *   standard.
 *
 * Billing keys off this value rather than the requested tier so a downgraded
 * request is charged at the rate it actually ran at.
 */
export function resolveServedServiceTier(signals: {
	trafficType?: string | null;
	serviceTierHeader?: string | null;
	serviceTierBody?: string | null;
}): "flex" | "priority" | null {
	const trafficType = signals.trafficType?.toUpperCase();
	if (trafficType === "ON_DEMAND_PRIORITY") {
		return "priority";
	}
	if (trafficType === "ON_DEMAND_FLEX") {
		return "flex";
	}
	const tier = (
		signals.serviceTierHeader ?? signals.serviceTierBody
	)?.toLowerCase();
	if (tier === "priority") {
		return "priority";
	}
	if (tier === "flex") {
		return "flex";
	}
	return null;
}
