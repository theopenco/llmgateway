/**
 * Provider-agnostic service-tier primitives: which credentials may carry a
 * premium tier, and which tier a provider actually served. Shared by every
 * code path that requests, routes, or bills a Flex/Priority request.
 *
 * The one provider-specific piece left is applyGoogleServiceTier, for the
 * Gemini Developer API's body field. Where the tier travels differs per
 * provider — an OpenAI-compatible body field, a Vertex request header (see
 * getProviderHeaders) — but the eligibility and served-tier rules do not.
 */
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
 * Vertex Flex/Priority credentials must use the global region.
 */
export function providerCredentialSupportsServiceTier(
	provider: ProviderId,
	credential: { region?: string | null },
): boolean {
	if (provider === "google-vertex") {
		return (credential.region ?? "global") === "global";
	}
	return true;
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

/**
 * Providers that honor `service_tier` but report nothing back about the tier
 * they served — no field in the response body, no response header. Fireworks
 * is one: a Priority request is either served at Priority or shed with a 503
 * ("server overloaded"), so there is no silent downgrade to standard and a
 * successful response can be attributed to the tier that was forwarded.
 */
const UNREPORTED_TIER_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
	"fireworks",
]);

/**
 * The tier to bill for providers that never report a served tier. Returns the
 * forwarded tier when the upstream accepted the request, and null otherwise so
 * a rejected request is never logged as having run at a premium tier.
 */
export function assumeServedServiceTier(
	provider: ProviderId,
	forwardedServiceTier: string | null | undefined,
	responseOk: boolean,
): "flex" | "priority" | null {
	if (!responseOk || !isPremiumServiceTier(forwardedServiceTier)) {
		return null;
	}
	return UNREPORTED_TIER_PROVIDERS.has(provider) ? forwardedServiceTier : null;
}
