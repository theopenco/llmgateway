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
import { getProviderDefinition } from "@llmgateway/models";

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
 * A premium tier only applies when the request reaches the provider's real
 * upstream. Whether the tier travels as a body field (OpenAI, the Gemini
 * Developer API, Fireworks) or a request header (Vertex), a key pointing at a
 * proxy / custom base URL may silently drop it — the request is then served,
 * and billed, as standard, and the caller has no way to tell. Service-tier
 * routing is therefore restricted to credentials targeting the provider's
 * default base URL.
 *
 * Derived from the catalogue rather than hardcoded: any provider that declares
 * `serviceTiers` is subject to the rule automatically. A hardcoded list silently
 * exempted OpenAI, which is both the most-used tier provider and the one most
 * likely to sit behind an OpenAI-compatible proxy.
 */
function isUpstreamOnlyTierProvider(provider: ProviderId): boolean {
	return Boolean(getProviderDefinition(provider)?.serviceTiers?.length);
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
 * Base URLs an operator has declared to reach a provider's genuine upstream, so
 * they may carry a premium tier despite not being the catalogue default —
 * comma-separated in `SERVICE_TIER_TRUSTED_BASE_URLS`.
 *
 * Unset in production, where only the provider's own endpoint is trusted. It
 * exists for deployments fronting a provider with a mirror they control (and for
 * the test harness, whose mock server stands in for every upstream). Declaring a
 * URL here asserts that it forwards `service_tier` untouched; a proxy that
 * silently drops it will serve, and bill, standard.
 */
function isTrustedServiceTierBaseUrl(baseUrl: string): boolean {
	const trusted = process.env.SERVICE_TIER_TRUSTED_BASE_URLS;
	if (!trusted) {
		return false;
	}
	const normalized = normalizeServiceTierBaseUrl(baseUrl);
	return trusted
		.split(",")
		.map((entry) => normalizeServiceTierBaseUrl(entry))
		.filter((entry) => entry.length > 0)
		.includes(normalized);
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
 * service-tier request. Eligible when the provider declares no service tiers at
 * all, when the key uses the managed default (no custom base URL), or when the
 * custom base URL exactly matches the provider's default base URL (its real
 * upstream). Providers with no static default base URL (e.g. glacier, an
 * env-defined deployment) have no canonical upstream to compare against, so
 * they pass, as do base URLs an operator has explicitly trusted via
 * SERVICE_TIER_TRUSTED_BASE_URLS.
 */
export function providerKeyBaseUrlSupportsServiceTier(
	provider: ProviderId,
	baseUrl: string | null | undefined,
): boolean {
	if (!isUpstreamOnlyTierProvider(provider) || !baseUrl) {
		return true;
	}
	if (isTrustedServiceTierBaseUrl(baseUrl)) {
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
 * Whether a credential (BYOK key, platform-managed key, or env-var index) can
 * carry a Flex/Priority request, given the upstream it targets.
 *
 * Extends the base-URL rule with Google Vertex's endpoint constraint: Flex and
 * Priority PayGo are only served on the `global` location, so a credential
 * pinned to a regional endpoint would have its tier header dropped upstream and
 * be served — and billed — as standard. Every credential-selection path (BYOK
 * key filtering, managed-credential filtering, env round-robin) shares this
 * predicate so a service-tier request can never rotate onto a credential that
 * silently downgrades it.
 */
export function providerCredentialSupportsServiceTier(
	provider: ProviderId,
	credential: { baseUrl?: string | null; region?: string | null },
): boolean {
	if (!providerKeyBaseUrlSupportsServiceTier(provider, credential.baseUrl)) {
		return false;
	}
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
