/**
 * Stable vocabularies for routing telemetry.
 *
 * Both taxonomies are closed sets on purpose: they are used as aggregation keys
 * in `routing_exclusion_hourly` / `routing_election_hourly`, so an open-ended
 * value would let a single code path explode the row count of those tables.
 * Anything unrecognized is folded into `other` / `unknown` at aggregation time
 * rather than inserted verbatim.
 */

/**
 * Why a provider mapping was dropped from an election, keyed by a stable code.
 *
 * The messages are the human-readable strings persisted in
 * `log.routingMetadata.filteredProviders[].reasons` and rendered in the log
 * detail view. They are derived from the code so the prose stays in one place
 * and the aggregation key can never drift from what users are shown.
 */
export const ROUTING_EXCLUSION_REASON_MESSAGES = {
	// Capability mismatches between the request and the mapping.
	no_reasoning_variant: "no_reasoning requested but provider has reasoning",
	reasoning_effort: "reasoning_effort not supported",
	reasoning_max_tokens: "reasoning_max_tokens not supported",
	tools: "tools not supported",
	tool_choice: "requested tool_choice not supported",
	web_search: "web_search not supported",
	web_search_forced_only:
		"web_search only supported when required via tool_choice",
	n_unsupported: "n > 1 not supported",
	n_limit: "n exceeds provider limit",
	n_streaming: "n > 1 not supported when streaming",
	json_output: "json_output not supported",
	json_schema: "json_schema not supported",
	vision: "vision not supported",
	audio: "audio not supported",
	audio_format: "audio format not supported",
	documents: "documents not supported",
	assistant_prefill: "assistant prefill not supported",
	max_tokens: "max_tokens exceeds provider limit",
	context_size: "context_size too small",
	// Request-shape constraints that are not per-mapping capabilities.
	service_tier: "service tier not supported by this mapping",
	service_tier_key: "no service-tier-eligible credential for this provider",
	coding_plan_cache: "no cached input pricing (coding plan)",
	// Credential / configuration reachability.
	no_provider_key: "no provider key or managed credential available",
	locked_region: "provider key is locked to a different region",
	// Catalogue state.
	deprecated: "mapping is deprecated",
	// Runtime state. Pre-election exclusions use filteredProviders; fail-open and
	// retry-time rate limits may still annotate providerScores. Content filters also
	// retain their summary field for compatibility. The hourly rollup reads all forms.
	rate_limited: "provider is rate limited",
	content_filter: "excluded by content-filter routing",
	compliance: "excluded by the organization's compliance policy",
	// Catch-all for values written by an older gateway build.
	other: "other",
} as const;

export type RoutingExclusionReason =
	keyof typeof ROUTING_EXCLUSION_REASON_MESSAGES;

export const ROUTING_EXCLUSION_REASONS = Object.keys(
	ROUTING_EXCLUSION_REASON_MESSAGES,
) as RoutingExclusionReason[];

/** Compact labels for dashboard axes and badges, where the full message is too long. */
export const ROUTING_EXCLUSION_REASON_LABELS: Record<
	RoutingExclusionReason,
	string
> = {
	no_reasoning_variant: "No-reasoning requested",
	reasoning_effort: "Reasoning effort",
	reasoning_max_tokens: "Reasoning max tokens",
	tools: "Tools",
	tool_choice: "Tool choice",
	web_search: "Web search",
	web_search_forced_only: "Web search not required",
	n_unsupported: "n > 1",
	n_limit: "n limit",
	n_streaming: "n > 1 streaming",
	json_output: "JSON output",
	json_schema: "JSON schema",
	vision: "Vision",
	audio: "Audio",
	audio_format: "Audio format",
	documents: "Documents",
	assistant_prefill: "Assistant prefill",
	max_tokens: "max_tokens",
	context_size: "Context size",
	service_tier: "Service tier",
	service_tier_key: "Service-tier key",
	coding_plan_cache: "Coding plan caching",
	no_provider_key: "No key",
	locked_region: "Locked region",
	deprecated: "Deprecated",
	rate_limited: "Rate limited",
	content_filter: "Content filter",
	compliance: "Compliance",
	other: "Other",
};

export function isRoutingExclusionReason(
	value: string,
): value is RoutingExclusionReason {
	return Object.hasOwn(ROUTING_EXCLUSION_REASON_MESSAGES, value);
}

export function toRoutingExclusionReason(
	value: string | null | undefined,
): RoutingExclusionReason {
	return value && isRoutingExclusionReason(value) ? value : "other";
}

export function routingExclusionReasonMessage(
	reason: RoutingExclusionReason,
): string {
	return ROUTING_EXCLUSION_REASON_MESSAGES[reason];
}

/**
 * How the gateway arrived at the provider it used. Written to
 * `log.routingMetadata.selectionReason`.
 */
export const ROUTING_SELECTION_REASONS = [
	"weighted-score",
	"price-only",
	"price-only-no-metrics",
	"session-sticky",
	"stable-preferred",
	"random-exploration",
	"low-uptime-fallback",
	"rate-limit-fallback",
	"direct-provider-specified",
	"single-provider-available",
	"single-candidate-after-filtering",
	"fallback-first-available",
	"unknown",
] as const;

export type RoutingSelectionReason = (typeof ROUTING_SELECTION_REASONS)[number];

export function isRoutingSelectionReason(
	value: string,
): value is RoutingSelectionReason {
	return (ROUTING_SELECTION_REASONS as readonly string[]).includes(value);
}

export function toRoutingSelectionReason(
	value: string | null | undefined,
): RoutingSelectionReason {
	return value && isRoutingSelectionReason(value) ? value : "unknown";
}

/**
 * Coarse grouping of selection reasons, used for the "how did traffic get
 * routed" breakdown. `scored` is the only kind where the weighted score
 * actually decided the outcome — every other kind means the score was either
 * bypassed or overridden, which is what makes a low-scoring provider able to
 * take the majority of a model's traffic.
 */
export type RoutingSelectionKind =
	| "scored"
	| "pinned"
	| "single-candidate"
	| "narrowed"
	| "sticky"
	| "fallback"
	| "exploration"
	| "unknown";

const SELECTION_KIND_BY_REASON: Record<
	RoutingSelectionReason,
	RoutingSelectionKind
> = {
	"weighted-score": "scored",
	"price-only": "scored",
	"price-only-no-metrics": "scored",
	"session-sticky": "sticky",
	"stable-preferred": "sticky",
	"random-exploration": "exploration",
	"low-uptime-fallback": "fallback",
	"rate-limit-fallback": "fallback",
	"direct-provider-specified": "pinned",
	"single-provider-available": "single-candidate",
	// The catalogue offers more than one provider but request-scoped filters left
	// exactly one, so no election happened. Grouped as "narrowed" rather than
	// "single-candidate": the distinction is the whole point of the exclusion
	// tables, since this is the shape a filtered-out mapping produces.
	"single-candidate-after-filtering": "narrowed",
	"fallback-first-available": "single-candidate",
	unknown: "unknown",
};

export const ROUTING_SELECTION_KINDS = [
	"scored",
	"pinned",
	"single-candidate",
	"narrowed",
	"sticky",
	"fallback",
	"exploration",
	"unknown",
] as const satisfies readonly RoutingSelectionKind[];

export function routingSelectionKind(
	reason: string | null | undefined,
): RoutingSelectionKind {
	return SELECTION_KIND_BY_REASON[toRoutingSelectionReason(reason)];
}

export const ROUTING_SELECTION_REASON_LABELS: Record<
	RoutingSelectionReason,
	string
> = {
	"weighted-score": "Weighted score",
	"price-only": "Price only",
	"price-only-no-metrics": "Price only (no metrics)",
	"session-sticky": "Session sticky",
	"stable-preferred": "Hysteresis",
	"random-exploration": "Exploration",
	"low-uptime-fallback": "Low-uptime fallback",
	"rate-limit-fallback": "Rate-limit fallback",
	"direct-provider-specified": "Provider pinned",
	"single-provider-available": "Single candidate",
	"single-candidate-after-filtering": "Narrowed to one",
	"fallback-first-available": "First available",
	unknown: "Unknown",
};

export const ROUTING_SELECTION_KIND_LABELS: Record<
	RoutingSelectionKind,
	string
> = {
	scored: "Scored election",
	pinned: "Provider pinned",
	"single-candidate": "Single candidate",
	narrowed: "Narrowed to one",
	sticky: "Sticky / hysteresis",
	fallback: "Fallback",
	exploration: "Exploration",
	unknown: "Unknown",
};

/**
 * Whose credential a given upstream attempt was sent with.
 *
 * `byok` means the organization's own provider key served the attempt, so the
 * provider bills the organization directly and no credits are deducted.
 * `platform` means an LLM Gateway credential served it (a platform-managed
 * provider key or an `LLM_*` environment credential), which is what credits
 * mode — including the hybrid-mode fallback after a BYOK key fails — runs on.
 *
 * This mirrors the `usedMode` discriminator on the log row (`api-keys` vs
 * `credits`): both are decided by whether an organization-owned provider key
 * was used, so the routing view and the billing mode can never disagree.
 */
export type RoutingCredentialSource = "byok" | "platform";

export function isRoutingCredentialSource(
	value: string,
): value is RoutingCredentialSource {
	return value === "byok" || value === "platform";
}

export function toRoutingCredentialSource(
	value: string | null | undefined,
): RoutingCredentialSource | undefined {
	return value && isRoutingCredentialSource(value) ? value : undefined;
}

/** Short badge labels for the routing views. */
export const ROUTING_CREDENTIAL_SOURCE_LABELS: Record<
	RoutingCredentialSource,
	string
> = {
	byok: "your key",
	platform: "LLM Gateway key",
};

/** Tooltip copy explaining who pays for an attempt served by this credential. */
export const ROUTING_CREDENTIAL_SOURCE_DESCRIPTIONS: Record<
	RoutingCredentialSource,
	string
> = {
	byok: "Your own provider key (BYOK). The provider bills you directly — this attempt is not deducted from your credits.",
	platform:
		"LLM Gateway's own provider credential. This attempt runs on credits and is deducted from your balance.",
};

/**
 * Which service tier applied to a request. `implicit` covers the dev-plan
 * default (`organization.devPlanServiceTier`), which the client never asked for
 * but which still narrows routing to mappings that support the tier — the case
 * that is invisible if you only look at the explicitly requested tier.
 */
export type ServiceTierMode = "none" | "explicit" | "implicit";
