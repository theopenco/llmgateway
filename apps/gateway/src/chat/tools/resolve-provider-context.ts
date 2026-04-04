import { HTTPException } from "hono/http-exception";

import {
	findCustomProviderKey,
	findProviderKey,
} from "@/lib/cached-queries.js";

import {
	getProviderEndpoint,
	getProviderHeaders,
	prepareRequestBody,
} from "@llmgateway/actions";
import {
	type BaseMessage,
	getRegionSpecificEnvValue,
	getProviderEnvVar,
	hasMaxTokens,
	type ModelDefinition,
	type OpenAIRequestBody,
	type OpenAIToolInput,
	type Provider,
	type ProviderRequestBody,
	providers,
	type ToolChoiceType,
	type WebSearchTool,
	stripRegionFromModelName,
} from "@llmgateway/models";

import { getProviderEnv } from "./get-provider-env.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

export interface ProviderContext {
	usedProvider: Provider;
	usedModel: string;
	usedModelFormatted: string;
	usedModelMapping: string;
	baseModelName: string;
	usedToken: string;
	providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	configIndex: number;
	envVarName: string | undefined;
	url: string;
	requestBody: ProviderRequestBody;
	useResponsesApi: boolean;
	requestCanBeCanceled: boolean;
	isImageGeneration: boolean;
	supportsReasoning: boolean;
	splitTaggedReasoning: boolean;
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
	headers: Record<string, string>;
	usedRegion: string | undefined;
}

export interface OriginalRequestParams {
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
}

export interface ProviderContextOptions {
	requestId: string;
	stream: boolean;
	effectiveStream: boolean;
	messages: BaseMessage[];
	response_format: OpenAIRequestBody["response_format"];
	tools: OpenAIToolInput[] | undefined;
	tool_choice: ToolChoiceType | undefined;
	reasoning_effort: "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
	reasoning_max_tokens: number | undefined;
	effort: "low" | "medium" | "high" | undefined;
	webSearchTool: WebSearchTool | undefined;
	image_config:
		| {
				aspect_ratio?: string;
				image_size?: string;
				n?: number;
				seed?: number;
		  }
		| undefined;
	sensitive_word_check: { status: "DISABLE" | "ENABLE" } | undefined;
	maxImageSizeMB: number;
	userPlan: "free" | "pro" | "enterprise" | null;
	hasExistingToolCalls: boolean;
	customProviderName: string | undefined;
	webSearchEnabled: boolean;
}

interface ProjectInfo {
	mode: string;
	organizationId: string;
}

interface OrgInfo {
	id: string;
	credits: string | null;
	devPlan: string;
	devPlanCreditsLimit: string | null;
	devPlanCreditsUsed: string | null;
	devPlanExpiresAt: Date | null;
}

export function formatUsedModelForDisplay(
	usedProvider: string,
	baseModelName: string,
	customProviderName?: string,
): string {
	const usedModelProviderPrefix =
		usedProvider === "custom" && customProviderName
			? customProviderName
			: usedProvider;

	return `${usedModelProviderPrefix}/${baseModelName}`;
}

/**
 * Resolves all provider-dependent context needed to make a fetch request.
 * This includes token resolution, URL building, parameter stripping,
 * request body preparation, and header construction.
 *
 * Used by the retry loop to quickly set up a new provider context on fallback.
 */
export async function resolveProviderContext(
	providerMapping: { providerId: string; modelName: string; region?: string },
	project: ProjectInfo,
	organization: OrgInfo,
	modelInfo: ModelDefinition,
	originalParams: OriginalRequestParams,
	options: ProviderContextOptions,
): Promise<ProviderContext> {
	const usedProvider = providerMapping.providerId as Provider;
	const usedModel = providerMapping.modelName;
	// Strip :region suffix for the actual upstream API call
	const upstreamModelName = stripRegionFromModelName(
		usedModel,
		providerMapping.region,
	);
	const baseModelName = modelInfo.id || upstreamModelName;
	const usedModelMapping = usedModel;
	const usedModelFormatted = formatUsedModelForDisplay(
		usedProvider,
		baseModelName,
		options.customProviderName,
	);

	// --- Token resolution ---
	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

	if (project.mode === "api-keys") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				options.requestId,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				options.requestId,
			);
		}

		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${usedProvider}`,
			});
		}

		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		const envResult = getProviderEnv(usedProvider as Provider);
		usedToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;
	} else if (project.mode === "hybrid") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				options.requestId,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				options.requestId,
			);
		}

		if (providerKey) {
			usedToken = providerKey.token;
		} else {
			const envResult = getProviderEnv(usedProvider as Provider);
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		}
	}

	if (!usedToken) {
		throw new HTTPException(500, { message: "No token" });
	}

	// --- Look up the specific provider mapping for the selected provider ---
	// modelInfo.providers is already expanded (regions flattened into separate entries)
	const usedRegion = providerMapping.region;
	const providerMappingForSelected = modelInfo.providers.find(
		(p) =>
			p.providerId === usedProvider &&
			p.modelName === usedModel &&
			p.region === usedRegion,
	);

	// --- Region validation ---
	// Validate against the expanded model-provider mapping (which contains per-model region info)
	// rather than the provider-level catalog (which lists all regions the provider supports).
	if (usedRegion) {
		const modelRegions = modelInfo.providers
			.filter((p) => p.providerId === usedProvider)
			.map((p) => p.region)
			.filter(Boolean) as string[];
		if (modelRegions.length > 0 && !modelRegions.includes(usedRegion)) {
			throw new HTTPException(400, {
				message: `Model ${usedModel} is not available in region "${usedRegion}". Available regions: ${modelRegions.join(", ")}`,
			});
		}
	}

	// Override token with region-specific env var if available (credits/hybrid mode)
	if (usedRegion && !providerKey) {
		const regionToken = getRegionSpecificEnvValue(usedProvider, usedRegion);
		if (regionToken) {
			usedToken = regionToken;
			// Update envVarName to reflect the regional env var
			const baseEnvVar = getProviderEnvVar(usedProvider);
			if (baseEnvVar) {
				const regionSuffix = usedRegion.toUpperCase().replace(/-/g, "_");
				const regionalEnvVar = `${baseEnvVar}__${regionSuffix}`;
				envVarName = process.env[regionalEnvVar] ? regionalEnvVar : baseEnvVar;
			}
		}
	}

	// --- Check if model supports reasoning (from selected provider, not any) ---
	const supportsReasoning = providerMappingForSelected?.reasoning === true;
	const splitTaggedReasoning =
		providerMappingForSelected?.splitTaggedReasoning === true;

	// --- Image generation check ---
	const isImageGeneration =
		providerMappingForSelected?.imageGenerations === true;

	// --- URL resolution ---
	const url = getProviderEndpoint(
		usedProvider as Provider,
		providerKey?.baseUrl ?? undefined,
		upstreamModelName,
		usedProvider === "google-ai-studio" ||
			usedProvider === "glacier" ||
			usedProvider === "google-vertex" ||
			usedProvider === "quartz"
			? usedToken
			: undefined,
		options.stream,
		supportsReasoning,
		options.hasExistingToolCalls,
		providerKey?.options ?? undefined,
		configIndex,
		isImageGeneration,
		usedRegion,
	);

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}`,
		});
	}

	const useResponsesApi = url.includes("/responses");

	// --- Parameter stripping ---
	// Work with copies of original params to avoid mutation
	let temperature = originalParams.temperature;
	let max_tokens = originalParams.max_tokens;
	let top_p = originalParams.top_p;
	let frequency_penalty = originalParams.frequency_penalty;
	let presence_penalty = originalParams.presence_penalty;

	if (providerMappingForSelected) {
		const supported = providerMappingForSelected.supportedParameters;
		if (supported && supported.length > 0) {
			if (temperature !== undefined && !supported.includes("temperature")) {
				temperature = undefined;
			}
			if (top_p !== undefined && !supported.includes("top_p")) {
				top_p = undefined;
			}
			if (
				frequency_penalty !== undefined &&
				!supported.includes("frequency_penalty")
			) {
				frequency_penalty = undefined;
			}
			if (
				presence_penalty !== undefined &&
				!supported.includes("presence_penalty")
			) {
				presence_penalty = undefined;
			}
			if (max_tokens !== undefined && !supported.includes("max_tokens")) {
				max_tokens = undefined;
			}
		}
	}

	// Anthropic does not allow temperature and top_p simultaneously
	if (usedProvider === "anthropic") {
		if (temperature !== undefined && top_p !== undefined) {
			top_p = undefined;
		}
	}

	// --- max_tokens validation ---
	if (max_tokens !== undefined && providerMappingForSelected) {
		const effectiveMaxOutput = providerMappingForSelected.maxOutput;
		if (effectiveMaxOutput !== undefined) {
			if (max_tokens > effectiveMaxOutput) {
				throw new HTTPException(400, {
					message: `The requested max_tokens (${max_tokens}) exceeds the maximum output tokens allowed for model ${usedModel} (${effectiveMaxOutput})`,
				});
			}
		}
	}

	// --- requestCanBeCanceled ---
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// --- Request body preparation ---
	const requestBody: ProviderRequestBody = await prepareRequestBody(
		usedProvider as Provider,
		upstreamModelName,
		options.messages as BaseMessage[],
		options.effectiveStream,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		options.response_format,
		options.tools,
		options.tool_choice,
		options.reasoning_effort,
		supportsReasoning,
		process.env.NODE_ENV === "production",
		options.maxImageSizeMB,
		options.userPlan,
		options.sensitive_word_check,
		options.image_config,
		options.effort,
		isImageGeneration,
		options.webSearchTool,
		options.reasoning_max_tokens,
		useResponsesApi,
	);

	// Post-validation of max_tokens in request body
	if (
		hasMaxTokens(requestBody) &&
		requestBody.max_tokens !== undefined &&
		providerMappingForSelected
	) {
		if (
			"maxOutput" in providerMappingForSelected &&
			providerMappingForSelected.maxOutput !== undefined
		) {
			if (requestBody.max_tokens > providerMappingForSelected.maxOutput) {
				throw new HTTPException(400, {
					message: `The effective max_tokens (${requestBody.max_tokens}) exceeds the maximum output tokens allowed for model ${usedModel} (${providerMappingForSelected.maxOutput})`,
				});
			}
		}
	}

	// --- Headers ---
	const headers = getProviderHeaders(usedProvider as Provider, usedToken, {
		webSearchEnabled: options.webSearchEnabled,
	});
	headers["Content-Type"] = "application/json";

	if (usedProvider === "anthropic" && options.effort !== undefined) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},effort-2025-11-24`
			: "effort-2025-11-24";
	}

	if (
		usedProvider === "anthropic" &&
		options.response_format?.type === "json_schema"
	) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},structured-outputs-2025-11-13`
			: "structured-outputs-2025-11-13";
	}

	return {
		usedProvider,
		usedModel,
		usedModelFormatted,
		usedModelMapping,
		baseModelName,
		usedToken,
		providerKey,
		configIndex,
		envVarName,
		url,
		requestBody,
		useResponsesApi,
		requestCanBeCanceled,
		isImageGeneration,
		supportsReasoning,
		splitTaggedReasoning,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		headers,
		usedRegion,
	};
}
