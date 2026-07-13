import { googleProviderSupportsAudioFormat } from "@llmgateway/actions";

import type { ProviderModelMapping, WebSearchTool } from "@llmgateway/models";

export interface ProviderFilterOptions {
	webSearchTool?: WebSearchTool | boolean;
	responseFormatType?: string;
	hasImages?: boolean;
	hasAudio?: boolean;
	audioFormats?: string[];
	hasDocuments?: boolean;
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
	reasons: string[];
}

/**
 * Collects the reasons why a provider mapping would be filtered out during routing.
 * Returns an empty array if the provider passes all checks.
 */
export function getProviderFilterReasons(
	provider: ProviderModelMapping,
	options: ProviderFilterOptions,
): string[] {
	const reasons: string[] = [];

	if (options.noReasoning && provider.reasoning === true) {
		reasons.push("no_reasoning requested but provider has reasoning");
	}
	// "none" means "no reasoning", so it doesn't require a reasoning-capable
	// provider.
	if (
		options.reasoningEffort !== undefined &&
		options.reasoningEffort !== "none" &&
		provider.reasoning !== true
	) {
		reasons.push("reasoning_effort not supported");
	}
	if (
		options.reasoningMaxTokens !== undefined &&
		provider.reasoningMaxTokens !== true
	) {
		reasons.push("reasoning_max_tokens not supported");
	}
	if (options.hasTools && provider.tools !== true) {
		reasons.push("tools not supported");
	}
	if (options.webSearchTool && provider.webSearch !== true) {
		reasons.push("web_search not supported");
	}
	if (options.n !== undefined && options.n > 1) {
		if (provider.supportsN !== true) {
			reasons.push("n > 1 not supported");
		} else if (provider.maxN !== undefined && options.n > provider.maxN) {
			reasons.push("n exceeds provider limit");
		} else if (options.stream && provider.supportsNStreaming === false) {
			reasons.push("n > 1 not supported when streaming");
		}
	}
	if (
		(options.responseFormatType === "json_object" ||
			options.responseFormatType === "json_schema") &&
		provider.jsonOutput !== true
	) {
		reasons.push("json_output not supported");
	}
	if (
		options.responseFormatType === "json_schema" &&
		provider.jsonOutputSchema !== true
	) {
		reasons.push("json_schema not supported");
	}
	if (options.hasImages && provider.vision !== true) {
		reasons.push("vision not supported");
	}
	if (options.hasAudio && provider.audio !== true) {
		reasons.push("audio not supported");
	}
	if (
		options.hasAudio &&
		options.audioFormats &&
		options.audioFormats.length > 0 &&
		!options.audioFormats.every((fmt) =>
			googleProviderSupportsAudioFormat(provider.providerId, fmt),
		)
	) {
		reasons.push("audio format not supported");
	}
	if (options.hasDocuments && provider.document !== true) {
		reasons.push("documents not supported");
	}
	if (
		options.maxTokens !== undefined &&
		provider.maxOutput !== undefined &&
		options.maxTokens > provider.maxOutput
	) {
		reasons.push("max_tokens exceeds provider limit");
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
	reasons: string[],
): void {
	const existing = list.find((f) => f.providerId === providerId);
	if (!existing) {
		list.push({ providerId, reasons: [...reasons] });
		return;
	}
	for (const reason of reasons) {
		if (!existing.reasons.includes(reason)) {
			existing.reasons.push(reason);
		}
	}
}
