import { googleProviderSupportsAudioFormat } from "@llmgateway/actions";
import {
	routingExclusionReasonMessage,
	type RoutingExclusionReason,
} from "@llmgateway/shared";

import type { ProviderModelMapping, WebSearchTool } from "@llmgateway/models";

export interface ProviderFilterOptions {
	webSearchTool?: WebSearchTool | boolean;
	responseFormatType?: string;
	hasImages?: boolean;
	hasAudio?: boolean;
	audioFormats?: string[];
	hasDocuments?: boolean;
	hasAssistantPrefill?: boolean;
	hasTools?: boolean;
	reasoningEffort?: string;
	reasoningMaxTokens?: number;
	noReasoning?: boolean;
	maxTokens?: number;
	n?: number;
	stream?: boolean;
}

export interface FilteredProvider {
	providerId: string;
	/** Human-readable messages, derived from `codes`. Rendered in the log detail view. */
	reasons: string[];
	/**
	 * Stable codes for the same exclusions. Aggregated per hour into
	 * `routing_exclusion_hourly`; absent on rows written before codes existed.
	 */
	codes?: RoutingExclusionReason[];
}

/**
 * Collects the reasons why a provider mapping would be filtered out during routing.
 * Returns an empty array if the provider passes all checks.
 */
export function getProviderFilterReasons(
	provider: ProviderModelMapping,
	options: ProviderFilterOptions,
): RoutingExclusionReason[] {
	const reasons: RoutingExclusionReason[] = [];

	if (options.noReasoning && provider.reasoning === true) {
		reasons.push("no_reasoning_variant");
	}
	// "none" means "no reasoning", so it doesn't require a reasoning-capable
	// provider.
	if (
		options.reasoningEffort !== undefined &&
		options.reasoningEffort !== "none" &&
		provider.reasoning !== true
	) {
		reasons.push("reasoning_effort");
	}
	if (
		options.reasoningMaxTokens !== undefined &&
		provider.reasoningMaxTokens !== true
	) {
		reasons.push("reasoning_max_tokens");
	}
	if (options.hasTools && provider.tools !== true) {
		reasons.push("tools");
	}
	if (options.webSearchTool && provider.webSearch !== true) {
		reasons.push("web_search");
	}
	if (options.n !== undefined && options.n > 1) {
		if (provider.supportsN !== true) {
			reasons.push("n_unsupported");
		} else if (provider.maxN !== undefined && options.n > provider.maxN) {
			reasons.push("n_limit");
		} else if (options.stream && provider.supportsNStreaming === false) {
			reasons.push("n_streaming");
		}
	}
	if (
		(options.responseFormatType === "json_object" ||
			options.responseFormatType === "json_schema") &&
		provider.jsonOutput !== true
	) {
		reasons.push("json_output");
	}
	if (
		options.responseFormatType === "json_schema" &&
		provider.jsonOutputSchema !== true
	) {
		reasons.push("json_schema");
	}
	if (options.hasImages && provider.vision !== true) {
		reasons.push("vision");
	}
	if (options.hasAudio && provider.audio !== true) {
		reasons.push("audio");
	}
	if (
		options.hasAudio &&
		options.audioFormats &&
		options.audioFormats.length > 0 &&
		!options.audioFormats.every((fmt) =>
			googleProviderSupportsAudioFormat(provider.providerId, fmt),
		)
	) {
		reasons.push("audio_format");
	}
	if (options.hasDocuments && provider.document !== true) {
		reasons.push("documents");
	}
	if (
		options.hasAssistantPrefill &&
		provider.supportsAssistantPrefill === false
	) {
		reasons.push("assistant_prefill");
	}
	if (
		options.maxTokens !== undefined &&
		provider.maxOutput !== undefined &&
		options.maxTokens > provider.maxOutput
	) {
		reasons.push("max_tokens");
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
	codes: RoutingExclusionReason[],
): void {
	const existing = list.find((f) => f.providerId === providerId);
	if (!existing) {
		list.push({
			providerId,
			reasons: codes.map(routingExclusionReasonMessage),
			codes: [...codes],
		});
		return;
	}
	for (const code of codes) {
		if (!existing.codes) {
			existing.codes = [];
		}
		if (existing.codes.includes(code)) {
			continue;
		}
		existing.codes.push(code);
		existing.reasons.push(routingExclusionReasonMessage(code));
	}
}
