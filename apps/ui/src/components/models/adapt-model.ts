import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type {
	ModelDefinition,
	ProviderModelMapping,
	ProviderDefinition,
} from "@llmgateway/models";

interface ProviderWithInfo extends ProviderModelMapping {
	providerInfo?: ProviderDefinition;
	discount?: number;
}

interface AdaptedModel extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

const toStr = (v: number | undefined): string | null =>
	v !== undefined ? String(v) : null;

const toStrRecord = (
	v: Record<string, number> | undefined,
): Record<string, string> | null =>
	v
		? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, String(n)]))
		: null;

export function adaptProviderMapping(
	p: ProviderWithInfo,
	modelId: string,
): { provider: ApiModelProviderMapping; providerInfo: ApiProvider } {
	return {
		provider: {
			id: `${p.providerId}-${p.modelName}-${p.region ?? ""}`,
			createdAt: "",
			modelId,
			providerId: p.providerId,
			modelName: p.modelName,
			region: p.region ?? null,
			inputPrice: toStr(p.inputPrice),
			outputPrice: toStr(p.outputPrice),
			cachedInputPrice: toStr(p.cachedInputPrice),
			imageInputPrice: toStr(p.imageInputPrice),
			imageOutputPrice: toStr(p.imageOutputPrice),
			imageInputTokensByResolution: p.imageInputTokensByResolution ?? null,
			imageOutputTokensByResolution: p.imageOutputTokensByResolution ?? null,
			requestPrice: toStr(p.requestPrice),
			contextSize: p.contextSize ?? null,
			maxOutput: p.maxOutput ?? null,
			streaming: p.streaming === "only" ? true : p.streaming,
			vision: p.vision ?? null,
			reasoning: p.reasoning ?? null,
			reasoningOutput: p.reasoningOutput ?? null,
			reasoningMaxTokens: p.reasoningMaxTokens ?? null,
			tools: p.tools ?? null,
			jsonOutput: p.jsonOutput ?? null,
			jsonOutputSchema: p.jsonOutputSchema ?? null,
			webSearch: p.webSearch ?? null,
			webSearchPrice: toStr(p.webSearchPrice),
			supportedVideoSizes: p.supportedVideoSizes ?? null,
			supportedVideoDurationsSeconds: p.supportedVideoDurationsSeconds ?? null,
			supportsVideoAudio: p.supportsVideoAudio ?? null,
			supportsVideoWithoutAudio: p.supportsVideoWithoutAudio ?? null,
			perSecondPrice: toStrRecord(p.perSecondPrice),
			discount: p.discount !== undefined ? String(p.discount) : null,
			stability: p.stability ?? null,
			supportedParameters: p.supportedParameters ?? null,
			deprecatedAt: p.deprecatedAt?.toISOString() ?? null,
			deactivatedAt: p.deactivatedAt?.toISOString() ?? null,
			status: "active" as const,
		},
		providerInfo: {
			id: p.providerId,
			createdAt: "",
			name: p.providerInfo?.name ?? null,
			description: p.providerInfo?.description ?? null,
			streaming: p.providerInfo?.streaming ?? null,
			cancellation: null,
			color: p.providerInfo?.color ?? null,
			website: p.providerInfo?.website ?? null,
			announcement: null,
			status: "active" as const,
		},
	};
}

export function adaptModel(
	modelDef: ModelDefinition,
	providers: ProviderWithInfo[],
): AdaptedModel {
	return {
		id: modelDef.id,
		createdAt: "",
		releasedAt: modelDef.releasedAt?.toISOString() ?? null,
		name: modelDef.name ?? null,
		aliases: modelDef.aliases ?? null,
		family: modelDef.family ?? null,
		description: modelDef.description ?? null,
		stability: modelDef.stability ?? null,
		output: modelDef.output ?? null,
		free: modelDef.free ?? false,
		status: "active" as const,
		mappings: [],
		providerDetails: providers.map((p) => adaptProviderMapping(p, modelDef.id)),
	};
}
