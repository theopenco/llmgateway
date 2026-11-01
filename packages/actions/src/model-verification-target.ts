import {
	expandAllProviderRegions,
	models as catalogueModels,
	getProviderDefinition,
	getProviderEnvVar,
	hasRegionSpecificEnvKey,
	getRegionSpecificEnvValue,
} from "@llmgateway/models";

import type { ProviderModelVerificationTarget, tables } from "@llmgateway/db";
import type {
	ProviderApiFormat,
	ProviderModelMapping,
	ToolChoiceMode,
	WebSearchFormat,
	Provider,
} from "@llmgateway/models";

type MappingRow = typeof tables.modelProviderMapping.$inferSelect;
export interface VerificationTargetInput {
	providerId: string;
	modelName: string;
	externalId?: string | null;
	apiFormat?: ProviderApiFormat | null;
	decisions?: boolean | null;
	region?: string | null;
	streaming?: boolean | null;
	vision?: boolean | null;
	audio?: boolean | null;
	tools?: boolean | null;
	supportedToolChoices?: ToolChoiceMode[] | null;
	jsonOutput?: boolean | null;
	jsonOutputSchema?: boolean | null;
	reasoning?: boolean | null;
	reasoningMaxTokens?: boolean | null;
	reasoningEfforts?: string[] | null;
	webSearch?: boolean | null;
	webSearchFormat?: WebSearchFormat | null;
	contextSize?: number | null;
	maxOutput?: number | null;
	promptCaching?: boolean | null;
}

export function buildVerificationTarget(
	input: VerificationTargetInput,
): ProviderModelVerificationTarget {
	const target: ProviderModelVerificationTarget = {
		providerId: input.providerId,
		modelName: input.modelName,
		externalId: input.externalId ?? input.modelName,
		apiFormat: input.apiFormat ?? "openai-chat-completions",
		region: input.region ?? null,
		streaming: input.streaming ?? true,
		vision: input.vision ?? false,
		audio: input.audio ?? false,
		tools: input.tools ?? false,
		supportedToolChoices: input.supportedToolChoices ?? null,
		jsonOutput: input.jsonOutput ?? false,
		jsonOutputSchema: input.jsonOutputSchema ?? false,
		reasoning: input.reasoning ?? false,
		reasoningMaxTokens: input.reasoningMaxTokens ?? false,
		reasoningEfforts: input.reasoningEfforts ?? null,
		webSearch: input.webSearch ?? false,
		webSearchFormat: input.webSearchFormat ?? null,
		contextSize: input.contextSize ?? null,
		maxOutput: input.maxOutput ?? null,
		promptCaching: input.promptCaching ?? false,
	};
	if (!input.decisions) {
		return target;
	}
	// A decision listing is served on `/v1/decisions`: only image input and
	// the input window describe it, so chat capabilities are never claimed.
	return {
		...target,
		decisions: true,
		apiFormat: "openai-chat-completions",
		streaming: false,
		audio: false,
		tools: false,
		supportedToolChoices: null,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		reasoningEfforts: null,
		webSearch: false,
		webSearchFormat: null,
		maxOutput: null,
		promptCaching: false,
	};
}
function catalogueMappingFor(
	mapping: MappingRow,
): ProviderModelMapping | undefined {
	const model = catalogueModels.find((entry) => entry.id === mapping.modelId);
	if (!model) {
		return undefined;
	}
	const expanded = expandAllProviderRegions(model.providers);
	return (
		expanded.find(
			(entry) =>
				entry.providerId === mapping.providerId &&
				(entry.region ?? null) === mapping.region,
		) ?? expanded.find((entry) => entry.providerId === mapping.providerId)
	);
}
export function mappingTarget(
	mapping: MappingRow,
): ProviderModelVerificationTarget {
	const catalogueMapping =
		mapping.source === "catalogue" ? catalogueMappingFor(mapping) : undefined;
	return buildVerificationTarget({
		providerId: mapping.providerId,
		modelName: mapping.modelId,
		externalId: mapping.externalId,
		apiFormat: mapping.apiFormat,
		decisions: catalogueMapping?.decisions ?? mapping.decisions,
		region: mapping.region,
		streaming: mapping.streaming,
		vision: mapping.vision,
		audio: mapping.audio,
		tools: mapping.tools,
		supportedToolChoices:
			catalogueMapping?.supportedToolChoices ??
			mapping.supportedToolChoices ??
			null,
		jsonOutput: mapping.jsonOutput,
		jsonOutputSchema: mapping.jsonOutputSchema,
		reasoning: mapping.reasoning,
		reasoningMaxTokens: mapping.reasoningMaxTokens,
		reasoningEfforts:
			catalogueMapping?.reasoningEfforts ?? mapping.reasoningEfforts ?? null,
		webSearch: mapping.webSearch,
		webSearchFormat:
			catalogueMapping?.webSearchFormat ?? mapping.webSearchFormat ?? null,
		contextSize: mapping.contextSize,
		maxOutput: mapping.maxOutput,
		promptCaching: mapping.cachedInputPrice !== null,
	});
}
export function modelVerificationEnvironmentToken(
	target: ProviderModelVerificationTarget,
): string {
	const provider = getProviderDefinition(target.providerId);
	const region = target.region ?? provider?.regionConfig?.defaultRegion;
	if (
		region &&
		!hasRegionSpecificEnvKey(target.providerId as Provider, region)
	) {
		return "";
	}
	const variable = getProviderEnvVar(target.providerId);
	const value =
		(region
			? getRegionSpecificEnvValue(target.providerId as Provider, region)
			: variable
				? process.env[variable]
				: undefined
		)?.trim() ?? "";
	return value.startsWith("{") ? value : (value.split(",")[0]?.trim() ?? "");
}
