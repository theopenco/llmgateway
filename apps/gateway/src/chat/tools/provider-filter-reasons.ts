import {
	googleProviderSupportsAudioFormat,
	mappingSupportsToolChoice,
} from "@llmgateway/actions";
import {
	routingExclusionReasonMessage,
	type RoutingExclusionReason,
} from "@llmgateway/shared";

import type {
	ProviderModelMapping,
	ToolChoiceType,
	WebSearchTool,
} from "@llmgateway/models";

export interface ProviderFilterOptions {
	webSearchTool?: WebSearchTool | boolean;
	/**
	 * Whether the caller sent `tool_choice: {type: "web_search"}`. Passed
	 * separately because `webSearchTool` is often narrowed to a boolean by the
	 * time routing runs.
	 */
	webSearchForced?: boolean;
	responseFormatType?: string;
	hasImages?: boolean;
	hasAudio?: boolean;
	audioFormats?: string[];
	hasDocuments?: boolean;
	hasAssistantPrefill?: boolean;
	hasTools?: boolean;
	toolChoice?: ToolChoiceType;
	/** Drop mappings that would downgrade tool_choice instead of preferring them. */
	strictToolChoice?: boolean;
	reasoningEffort?: string;
	reasoningMaxTokens?: number;
	noReasoning?: boolean;
	maxTokens?: number;
	n?: number;
	stream?: boolean;
}

export interface FilteredProvider {
	providerId: string;
	/**
	 * Human-readable messages shown in the log detail view. Free-form on purpose:
	 * several callers interpolate request detail into them (which service tier,
	 * whether it came from a coding-plan default).
	 */
	reasons: string[];
	/**
	 * Stable codes for the same exclusions, deduplicated independently of
	 * `reasons` — the two are sets describing the same drop, not positionally
	 * paired. Aggregated per hour into `routing_exclusion_hourly`; absent on rows
	 * written before codes existed.
	 */
	codes?: RoutingExclusionReason[];
}

/**
 * One exclusion: the stable aggregation key plus the prose users read. Kept
 * together so a call site cannot record a message without a code, which would
 * make the exclusion invisible to the hourly rollup.
 */
export interface ProviderFilterReason {
	code: RoutingExclusionReason;
	message: string;
}

/**
 * Build an exclusion reason, defaulting the prose to the code's canonical
 * message. Pass `message` when the caller has request-specific detail worth
 * showing (e.g. which tier was requested).
 */
export function exclusionReason(
	code: RoutingExclusionReason,
	message?: string,
): ProviderFilterReason {
	return { code, message: message ?? routingExclusionReasonMessage(code) };
}

/**
 * Whether a requested `tool_choice` is worth narrowing routing for. "auto" is
 * both the upstream default and the value `prepareRequestBody` downgrades to, so
 * a mapping that cannot honour it behaves identically anyway — only the modes
 * that change behaviour ("none", "required", a named function) constrain which
 * mappings can serve the request.
 */
function toolChoiceConstrainsRouting(
	toolChoice: ToolChoiceType | undefined,
): toolChoice is Exclude<ToolChoiceType, "auto"> {
	return (
		toolChoice !== undefined &&
		toolChoice !== "auto" &&
		!(typeof toolChoice === "object" && toolChoice.type === "web_search")
	);
}

/**
 * Whether a mapping honours the request's `tool_choice` verbatim, i.e. whether
 * `prepareRequestBody` will forward it instead of downgrading it to "auto".
 */
export function providerHonorsRequestedToolChoice(
	provider: ProviderModelMapping,
	options: ProviderFilterOptions,
): boolean {
	if (!toolChoiceConstrainsRouting(options.toolChoice)) {
		return true;
	}
	return mappingSupportsToolChoice(provider, options.toolChoice, {
		thinkingDisabled: options.reasoningEffort === "none",
	});
}

/**
 * Narrow a candidate list to the mappings that honour the requested
 * `tool_choice` — but only when at least one of them does.
 *
 * Unlike the capability filters, an unsupported `tool_choice` is not fatal:
 * `prepareRequestBody` downgrades it to "auto" and the request still gets an
 * answer. So this is a preference, not a requirement — emptying the candidate
 * set would turn requests that work today into 400s. Auto routing applies the
 * stricter per-mapping filter instead (via `getProviderFilterReasons`), because
 * there another model can always take the request.
 */
export function preferToolChoiceCapableProviders(
	providers: ProviderModelMapping[],
	options: ProviderFilterOptions,
	filteredOut?: FilteredProvider[],
): ProviderModelMapping[] {
	if (!toolChoiceConstrainsRouting(options.toolChoice)) {
		return providers;
	}

	const capable = providers.filter((provider) =>
		providerHonorsRequestedToolChoice(provider, options),
	);
	if (capable.length === 0 || capable.length === providers.length) {
		return providers;
	}

	if (filteredOut) {
		// Record a provider only when none of its mappings survived: a provider
		// that keeps serving through another region is not excluded, and marking
		// it so would overstate the exclusion in the hourly rollup.
		const capableProviderIds = new Set(capable.map((p) => p.providerId));
		for (const provider of providers) {
			if (!capableProviderIds.has(provider.providerId)) {
				recordFilteredProvider(filteredOut, provider.providerId, [
					exclusionReason("tool_choice"),
				]);
			}
		}
	}
	return capable;
}

/**
 * Collects the reasons why a provider mapping would be filtered out during routing.
 * Returns an empty array if the provider passes all checks.
 */
export function getProviderFilterReasons(
	provider: ProviderModelMapping,
	options: ProviderFilterOptions,
): ProviderFilterReason[] {
	const reasons: ProviderFilterReason[] = [];

	if (options.noReasoning && provider.reasoning === true) {
		reasons.push(exclusionReason("no_reasoning_variant"));
	}
	// "none" means "no reasoning", so it doesn't require a reasoning-capable
	// provider.
	if (
		options.reasoningEffort !== undefined &&
		options.reasoningEffort !== "none" &&
		provider.reasoning !== true
	) {
		reasons.push(exclusionReason("reasoning_effort"));
	}
	if (
		options.reasoningMaxTokens !== undefined &&
		provider.reasoningMaxTokens !== true
	) {
		reasons.push(exclusionReason("reasoning_max_tokens"));
	}
	if (options.hasTools && provider.tools !== true) {
		reasons.push(exclusionReason("tools"));
	}
	if (
		options.strictToolChoice &&
		!providerHonorsRequestedToolChoice(provider, options)
	) {
		reasons.push(exclusionReason("tool_choice"));
	}
	if (options.webSearchTool && provider.webSearch !== true) {
		reasons.push(exclusionReason("web_search"));
	}
	// Mappings that can only search on demand are no use to a request that
	// merely offers the tool: they would answer from stale weights while
	// occupying a route a model-electing provider could have served.
	//
	// Callers that still hold the extracted tool carry the caller's intent on
	// it; the ones that narrowed it to a boolean pass `webSearchForced`
	// alongside. Read whichever is available, or a forced request would filter
	// out the very mappings it exists to reach.
	const webSearchForced =
		options.webSearchForced ??
		(typeof options.webSearchTool === "object" &&
			options.webSearchTool !== null &&
			options.webSearchTool.forced === true);
	if (
		options.webSearchTool &&
		provider.webSearchForcedOnly === true &&
		!webSearchForced
	) {
		reasons.push(exclusionReason("web_search_forced_only"));
	}
	if (options.n !== undefined && options.n > 1) {
		if (provider.supportsN !== true) {
			reasons.push(exclusionReason("n_unsupported"));
		} else if (provider.maxN !== undefined && options.n > provider.maxN) {
			reasons.push(exclusionReason("n_limit"));
		} else if (options.stream && provider.supportsNStreaming === false) {
			reasons.push(exclusionReason("n_streaming"));
		}
	}
	if (
		options.responseFormatType === "json_object" &&
		provider.jsonOutput !== true
	) {
		reasons.push(exclusionReason("json_output"));
	}
	if (
		options.responseFormatType === "json_schema" &&
		provider.jsonOutputSchema !== true
	) {
		reasons.push(exclusionReason("json_schema"));
	}
	if (options.hasImages && provider.vision !== true) {
		reasons.push(exclusionReason("vision"));
	}
	if (options.hasAudio && provider.audio !== true) {
		reasons.push(exclusionReason("audio"));
	}
	if (
		options.hasAudio &&
		options.audioFormats &&
		options.audioFormats.length > 0 &&
		!options.audioFormats.every((fmt) =>
			googleProviderSupportsAudioFormat(provider.providerId, fmt),
		)
	) {
		reasons.push(exclusionReason("audio_format"));
	}
	if (options.hasDocuments && provider.document !== true) {
		reasons.push(exclusionReason("documents"));
	}
	if (
		options.hasAssistantPrefill &&
		provider.supportsAssistantPrefill === false
	) {
		reasons.push(exclusionReason("assistant_prefill"));
	}
	if (
		options.maxTokens !== undefined &&
		provider.maxOutput !== undefined &&
		options.maxTokens > provider.maxOutput
	) {
		reasons.push(exclusionReason("max_tokens"));
	}

	return reasons;
}

/**
 * Record a filtered-out provider in routing metadata, merging reasons when the
 * provider already has an entry (regional expansion yields many mappings per
 * provider id).
 */
export function recordFilteredProvider(
	list: FilteredProvider[],
	providerId: string,
	reasons: ProviderFilterReason[],
): void {
	let existing = list.find((f) => f.providerId === providerId);
	if (!existing) {
		existing = { providerId, reasons: [], codes: [] };
		list.push(existing);
	}
	for (const reason of reasons) {
		if (!existing.reasons.includes(reason.message)) {
			existing.reasons.push(reason.message);
		}
		existing.codes ??= [];
		if (!existing.codes.includes(reason.code)) {
			existing.codes.push(reason.code);
		}
	}
}

/**
 * Merge an already-recorded entry into another list, preserving both the prose
 * and the codes. Used where routing folds its pre-routing drops together with
 * what the routing-time filter recorded.
 */
export function mergeFilteredProvider(
	list: FilteredProvider[],
	entry: FilteredProvider,
): void {
	let existing = list.find((f) => f.providerId === entry.providerId);
	if (!existing) {
		existing = { providerId: entry.providerId, reasons: [], codes: [] };
		list.push(existing);
	}
	for (const message of entry.reasons) {
		if (!existing.reasons.includes(message)) {
			existing.reasons.push(message);
		}
	}
	existing.codes ??= [];
	for (const code of entry.codes ?? []) {
		if (!existing.codes.includes(code)) {
			existing.codes.push(code);
		}
	}
}
