import { buildUsage } from "@/aisdk/spec.js";

import type { SpecVersion } from "@/aisdk/spec.js";
import type { Annotation } from "@/chat/tools/types.js";

/**
 * Maps a chat-completions `finish_reason` onto the spec's finish reason.
 * `unknown` is the spec's own fallback for a provider that reported nothing.
 */
export function mapFinishReason(
	finishReason: string | null | undefined,
): string {
	switch (finishReason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool_calls":
		case "function_call":
			return "tool-calls";
		case "content_filter":
			return "content-filter";
		case "error":
			return "error";
		default:
			return "unknown";
	}
}

export interface ChatUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
		cache_write_tokens?: number;
		cache_creation_tokens?: number;
	};
	completion_tokens_details?: { reasoning_tokens?: number };
	cost?: number;
}

export function usageFromChat(
	specVersion: SpecVersion,
	usage: ChatUsage | undefined,
): Record<string, unknown> {
	const promptDetails = usage?.prompt_tokens_details;
	return buildUsage(specVersion, {
		inputTokens: usage?.prompt_tokens,
		outputTokens: usage?.completion_tokens,
		totalTokens: usage?.total_tokens,
		reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
		cachedInputTokens: promptDetails?.cached_tokens,
		cacheWriteTokens:
			promptDetails?.cache_write_tokens ?? promptDetails?.cache_creation_tokens,
	});
}

/**
 * Provider metadata attached to the finish part.
 *
 * The cost is mirrored under a `gateway` key as well: apps written against the
 * Vercel AI Gateway read `providerMetadata.gateway.cost`, and mirroring it means
 * those cost readouts keep working when the base URL is repointed here.
 */
export function buildProviderMetadata({
	cost,
	usedModel,
	usedProvider,
	cached,
	requestId,
}: {
	cost?: number;
	usedModel?: string;
	usedProvider?: string;
	cached?: boolean;
	requestId?: string;
}): Record<string, unknown> | undefined {
	const llmgateway: Record<string, unknown> = {
		...(cost !== undefined && { cost }),
		...(usedModel !== undefined && { usedModel }),
		...(usedProvider !== undefined && { usedProvider }),
		...(cached !== undefined && { cached }),
		...(requestId !== undefined && { requestId }),
	};

	if (Object.keys(llmgateway).length === 0) {
		return undefined;
	}

	return {
		llmgateway,
		...(cost !== undefined && { gateway: { cost } }),
	};
}

export interface SourcePart {
	type: "source";
	sourceType: "url";
	id: string;
	url: string;
	title?: string;
}

/**
 * Turns the gateway's `url_citation` annotations into spec `source` parts,
 * which the AI SDK surfaces as `source-url` message parts. Deduplicated by URL
 * because providers repeat a citation for every text span that references it.
 */
export function annotationsToSources(
	annotations: Annotation[] | undefined,
	seenUrls: Set<string>,
	nextId: () => string,
): SourcePart[] {
	const sources: SourcePart[] = [];

	for (const annotation of annotations ?? []) {
		if (annotation.type !== "url_citation") {
			continue;
		}
		const { url, title } = annotation.url_citation;
		if (!url || seenUrls.has(url)) {
			continue;
		}
		seenUrls.add(url);
		sources.push({
			type: "source",
			sourceType: "url",
			id: nextId(),
			url,
			...(title && { title }),
		});
	}

	return sources;
}

/**
 * The `web_search` provider tool is executed upstream, so the AI SDK never sees
 * an input/output pair for it unless we synthesize one. Without it the tool
 * call is invisible to the client and only the sources show up.
 */
export function buildWebSearchToolResult(
	toolName: string,
	toolCallId: string,
	sources: SourcePart[],
) {
	return {
		type: "tool-result" as const,
		toolCallId,
		toolName,
		providerExecuted: true,
		result: {
			sources: sources.map((source) => ({
				type: "url" as const,
				url: source.url,
				...(source.title && { title: source.title }),
			})),
		},
	};
}

export function buildWebSearchToolCall(toolName: string, toolCallId: string) {
	return {
		type: "tool-call" as const,
		toolCallId,
		toolName,
		providerExecuted: true,
		input: "{}",
	};
}
