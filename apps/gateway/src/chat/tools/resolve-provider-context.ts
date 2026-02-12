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
	hasMaxTokens,
	type ModelDefinition,
	type OpenAIRequestBody,
	type OpenAIToolInput,
	type Provider,
	type ProviderModelMapping,
	type ProviderRequestBody,
	providers,
	type ToolChoiceType,
	type WebSearchTool,
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
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
	headers: Record<string, string>;
}

export interface OriginalRequestParams {
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
}

export interface ProviderContextOptions {
	stream: boolean;
	effectiveStream: boolean;
	messages: BaseMessage[];
	response_format: OpenAIRequestBody["response_format"];
	tools: OpenAIToolInput[] | undefined;
	tool_choice: ToolChoiceType | undefined;
	reasoning_effort: "minimal" | "low" | "medium" | "high" | undefined;
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

/**
 * Resolves all provider-dependent context needed to make a fetch request.
 * This includes token resolution, URL building, parameter stripping,
 * request body preparation, and header construction.
 *
 * Used by the retry loop to quickly set up a new provider context on fallback.
 */
export async function resolveProviderContext(
	providerMapping: { providerId: string; modelName: string },
	project: ProjectInfo,
	organization: OrgInfo,
	modelInfo: ModelDefinition,
	originalParams: OriginalRequestParams,
	options: ProviderContextOptions,
): Promise<ProviderContext> {
	const usedProvider = providerMapping.providerId as Provider;
	const usedModel = providerMapping.modelName;
	const baseModelName = modelInfo.id || usedModel;
	const usedModelMapping = usedModel;
	const usedModelFormatted = `${usedProvider}/${baseModelName}`;

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
			);
		} else {
			providerKey = await findProviderKey(project.organizationId, usedProvider);
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
			);
		} else {
			providerKey = await findProviderKey(project.organizationId, usedProvider);
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

	// --- Check if model supports reasoning ---
	const supportsReasoning = modelInfo.providers.some(
		(provider) => (provider as ProviderModelMapping).reasoning === true,
	);

	// --- URL resolution ---
	const url = getProviderEndpoint(
		usedProvider as Provider,
		providerKey?.baseUrl || undefined,
		usedModel,
		usedProvider === "google-ai-studio" || usedProvider === "google-vertex"
			? usedToken
			: undefined,
		options.stream,
		supportsReasoning,
		options.hasExistingToolCalls,
		providerKey?.options || undefined,
		configIndex,
		false, // isImageGeneration — retry doesn't change image model status
	);

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}`,
		});
	}

	const useResponsesApi = url.includes("/responses");

	// --- Image generation check ---
	const imageGenProviderMapping = modelInfo.providers.find(
		(p) => p.providerId === usedProvider && p.modelName === usedModel,
	);
	const isImageGeneration =
		(imageGenProviderMapping as ProviderModelMapping)?.imageGenerations ===
		true;

	// --- Parameter stripping ---
	// Work with copies of original params to avoid mutation
	let temperature = originalParams.temperature;
	let max_tokens = originalParams.max_tokens;
	let top_p = originalParams.top_p;
	let frequency_penalty = originalParams.frequency_penalty;
	let presence_penalty = originalParams.presence_penalty;

	const providerMappingInfo = modelInfo.providers.find(
		(p) => p.providerId === usedProvider && p.modelName === usedModel,
	);

	if (providerMappingInfo) {
		const supported = (providerMappingInfo as ProviderModelMapping)
			.supportedParameters;
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
	if (max_tokens !== undefined && providerMappingInfo) {
		if (
			"maxOutput" in providerMappingInfo &&
			providerMappingInfo.maxOutput !== undefined
		) {
			if (max_tokens > providerMappingInfo.maxOutput) {
				// Silently cap to max output instead of throwing on retry
				max_tokens = providerMappingInfo.maxOutput;
			}
		}
	}

	// --- requestCanBeCanceled ---
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// --- Request body preparation ---
	const requestBody: ProviderRequestBody = await prepareRequestBody(
		usedProvider as Provider,
		usedModel,
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
		useResponsesApi,
	);

	// Post-validation of max_tokens in request body
	if (
		hasMaxTokens(requestBody) &&
		requestBody.max_tokens !== undefined &&
		providerMappingInfo
	) {
		if (
			"maxOutput" in providerMappingInfo &&
			providerMappingInfo.maxOutput !== undefined
		) {
			if (requestBody.max_tokens > providerMappingInfo.maxOutput) {
				requestBody.max_tokens = providerMappingInfo.maxOutput;
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
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		headers,
	};
}
