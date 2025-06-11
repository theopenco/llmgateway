import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	db,
	shortid,
	type InferSelectModel,
	type Project,
	type tables,
	type ApiKey,
} from "@llmgateway/db";
import {
	getProviderEndpoint,
	getProviderHeaders,
	type Model,
	models,
	prepareRequestBody,
	type Provider,
	providers,
} from "@llmgateway/models";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import {
	generateCacheKey,
	getCache,
	getOrganization,
	getProject,
	getProviderKey,
	isCachingEnabled,
	setCache,
} from "../lib/cache";
import { calculateCosts } from "../lib/costs";
import { insertLog } from "../lib/logs";

import type { ServerTypes } from "../vars";

/**
 * Determines the appropriate finish reason based on HTTP status code
 * 5xx status codes indicate upstream provider errors
 * 4xx status codes indicate client/gateway errors
 */
function getFinishReasonForError(statusCode: number): string {
	return statusCode >= 500 ? "upstream_error" : "gateway_error";
}

/**
 * Creates a partial log entry with common fields to reduce duplication
 */
function createLogEntry(
	requestId: string,
	project: Project,
	apiKey: ApiKey,
	providerKeyId: string | undefined,
	usedModel: string,
	usedProvider: string,
	requestedModel: string,
	requestedProvider: string | undefined,
	messages: any[],
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
) {
	return {
		requestId,
		organizationId: project.organizationId,
		projectId: apiKey.projectId,
		apiKeyId: apiKey.id,
		usedMode: providerKeyId ? "api-keys" : "credits",
		usedModel,
		usedProvider,
		requestedModel,
		requestedProvider,
		messages,
		temperature: temperature || null,
		maxTokens: max_tokens || null,
		topP: top_p || null,
		frequencyPenalty: frequency_penalty || null,
		presencePenalty: presence_penalty || null,
		mode: project.mode,
	} as const;
}

/**
 * Check if a provider has an environment token available
 * @param provider The provider to check
 * @returns True if the provider has a valid environment token, false otherwise
 */
function hasProviderEnvironmentToken(provider: Provider): boolean {
	const envVarMap = {
		openai: "OPENAI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		"google-vertex": "VERTEX_API_KEY",
		"google-ai-studio": "GOOGLE_AI_STUDIO_API_KEY",
		"inference.net": "INFERENCE_NET_API_KEY",
		"kluster.ai": "KLUSTER_AI_API_KEY",
		"together.ai": "TOGETHER_AI_API_KEY",
		cloudrift: "CLOUD_RIFT_API_KEY",
		mistral: "MISTRAL_API_KEY",
	} as const;

	const envVar = envVarMap[provider as keyof typeof envVarMap];
	return envVar ? Boolean(process.env[envVar]) : false;
}

/**
 * Get provider token from environment variables
 * @param usedProvider The provider to get the token for
 * @returns The token for the provider or undefined if not found
 */
function getProviderTokenFromEnv(usedProvider: Provider): string | undefined {
	let token: string | undefined;

	switch (usedProvider) {
		case "openai":
			token = process.env.OPENAI_API_KEY;
			break;
		case "anthropic":
			token = process.env.ANTHROPIC_API_KEY;
			break;
		case "google-vertex":
			token = process.env.VERTEX_API_KEY;
			break;
		case "google-ai-studio":
			token = process.env.GOOGLE_AI_STUDIO_API_KEY;
			break;
		case "inference.net":
			token = process.env.INFERENCE_NET_API_KEY;
			break;
		case "kluster.ai":
			token = process.env.KLUSTER_AI_API_KEY;
			break;
		case "together.ai":
			token = process.env.TOGETHER_AI_API_KEY;
			break;
		case "cloudrift":
			token = process.env.CLOUD_RIFT_API_KEY;
			break;
		case "mistral":
			token = process.env.MISTRAL_API_KEY;
			break;
		default:
			throw new HTTPException(400, {
				message: `No environment variable set for provider: ${usedProvider}`,
			});
	}

	if (!token) {
		throw new HTTPException(400, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}

	return token;
}

/**
 * Parses response content and metadata from different providers
 */
function parseProviderResponse(usedProvider: Provider, json: any) {
	let content = null;
	let finishReason = null;
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;

	switch (usedProvider) {
		case "anthropic":
			content = json.content?.[0]?.text || null;
			finishReason = json.stop_reason || null;
			promptTokens = json.usage?.input_tokens || null;
			completionTokens = json.usage?.output_tokens || null;
			totalTokens =
				json.usage?.input_tokens && json.usage?.output_tokens
					? json.usage.input_tokens + json.usage.output_tokens
					: null;
			break;
		case "google-vertex":
		case "google-ai-studio":
			content = json.candidates?.[0]?.content?.parts?.[0]?.text || null;
			finishReason = json.candidates?.[0]?.finishReason || null;
			break;
		case "inference.net":
		case "kluster.ai":
		case "together.ai":
			content = json.choices?.[0]?.message?.content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			totalTokens = json.usage?.total_tokens || null;
			break;
		case "mistral":
			content = json.choices?.[0]?.message?.content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			totalTokens = json.usage?.total_tokens || null;

			// Handle Mistral's JSON output mode which wraps JSON in markdown code blocks
			if (
				content &&
				typeof content === "string" &&
				content.includes("```json")
			) {
				const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
				if (jsonMatch && jsonMatch[1]) {
					// Extract and clean the JSON content
					content = jsonMatch[1].trim();
					// Ensure it's valid JSON by parsing and re-stringifying to normalize formatting
					try {
						const parsed = JSON.parse(content);
						content = JSON.stringify(parsed);
					} catch (_e) {}
				}
			}
			break;
		default: // OpenAI format
			content = json.choices?.[0]?.message?.content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			totalTokens = json.usage?.total_tokens || null;
	}

	return {
		content,
		finishReason,
		promptTokens,
		completionTokens,
		totalTokens,
	};
}

/**
 * Estimates token counts when not provided by the API
 */
function estimateTokens(
	usedProvider: Provider,
	messages: any[],
	content: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
) {
	let calculatedPromptTokens = promptTokens;
	let calculatedCompletionTokens = completionTokens;

	// Estimate tokens if not provided by the API
	if (
		(usedProvider === "anthropic" ||
			usedProvider === "inference.net" ||
			usedProvider === "kluster.ai" ||
			usedProvider === "together.ai") &&
		(!promptTokens || !completionTokens)
	) {
		if (!promptTokens) {
			calculatedPromptTokens =
				messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4;
		}

		if (!completionTokens && content) {
			calculatedCompletionTokens = content.length / 4;
		}
	}

	return {
		calculatedPromptTokens,
		calculatedCompletionTokens,
	};
}

/**
 * Transforms response to OpenAI format for non-OpenAI providers
 */
function transformToOpenAIFormat(
	usedProvider: Provider,
	usedModel: string,
	json: any,
	content: string | null,
	finishReason: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
	totalTokens: number | null,
) {
	let transformedResponse = json;

	switch (usedProvider) {
		case "google-vertex":
		case "google-ai-studio": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
						},
						finish_reason:
							finishReason === "STOP"
								? "stop"
								: finishReason?.toLowerCase() || "stop",
					},
				],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: totalTokens,
				},
			};
			break;
		}
		case "anthropic": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
						},
						finish_reason:
							finishReason === "end_turn"
								? "stop"
								: finishReason?.toLowerCase() || "stop",
					},
				],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: totalTokens,
				},
			};
			break;
		}
		case "inference.net":
		case "kluster.ai":
		case "together.ai": {
			if (!transformedResponse.id) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
							},
							finish_reason: finishReason || "stop",
						},
					],
					usage: {
						prompt_tokens: promptTokens,
						completion_tokens: completionTokens,
						total_tokens: totalTokens,
					},
				};
			}
			break;
		}
	}

	return transformedResponse;
}

/**
 * Transforms streaming chunk to OpenAI format for non-OpenAI providers
 */
function transformStreamingChunkToOpenAIFormat(
	usedProvider: Provider,
	usedModel: string,
	data: any,
): any {
	let transformedData = data;

	switch (usedProvider) {
		case "anthropic": {
			// Handle different types of Anthropic streaming events
			if (data.type === "content_block_delta" && data.delta?.text) {
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.delta.text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else if (data.type === "message_delta" && data.delta?.stop_reason) {
				const stopReason = data.delta.stop_reason;
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								stopReason === "end_turn"
									? "stop"
									: stopReason?.toLowerCase() || "stop",
						},
					],
					usage: data.usage || null,
				};
			} else if (data.type === "message_stop" || data.stop_reason) {
				const stopReason = data.stop_reason || "end_turn";
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								stopReason === "end_turn"
									? "stop"
									: stopReason?.toLowerCase() || "stop",
						},
					],
					usage: data.usage || null,
				};
			} else if (data.delta?.text) {
				// Fallback for older format
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.delta.text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else {
				// For other Anthropic events (like message_start, content_block_start, etc.)
				// Transform them to OpenAI format but without content
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			}
			break;
		}
		case "google-vertex":
		case "google-ai-studio": {
			if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.candidates[0].content.parts[0].text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: null,
				};
			} else if (data.candidates?.[0]?.finishReason) {
				const finishReason = data.candidates[0].finishReason;
				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								finishReason === "STOP"
									? "stop"
									: finishReason?.toLowerCase() || "stop",
						},
					],
					usage: null,
				};
			}
			break;
		}
		// OpenAI and other providers that already use OpenAI format
		default: {
			// Ensure the response has the required OpenAI format fields
			if (!data.id || !data.object) {
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: data.choices || [
						{
							index: 0,
							delta: data.delta
								? {
										...data.delta,
										role: "assistant",
									}
								: {
										content: data.content || "",
										role: "assistant",
									},
							finish_reason: data.finish_reason || null,
						},
					],
					usage: data.usage || null,
				};
			} else {
				// Even if the response has the correct format, ensure role is set in delta
				transformedData = {
					...data,
					choices:
						data.choices?.map((choice: any) => ({
							...choice,
							delta: choice.delta
								? {
										...choice.delta,
										role: choice.delta.role || "assistant",
									}
								: choice.delta,
						})) || data.choices,
				};
			}
			break;
		}
	}

	return transformedData;
}

export const chat = new OpenAPIHono<ServerTypes>();

const completions = createRoute({
	operationId: "v1_chat_completions",
	summary: "Chat Completions",
	description: "Create a completion for the chat conversation",
	method: "post",
	path: "/completions",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						model: z.string().openapi({
							example: "gpt-4o",
						}),
						messages: z.array(
							z.object({
								role: z.string().openapi({
									example: "user",
								}),
								content: z.string().openapi({
									example: "Hello!",
								}),
							}),
						),
						temperature: z.number().optional(),
						max_tokens: z.number().optional(),
						top_p: z.number().optional(),
						frequency_penalty: z.number().optional(),
						presence_penalty: z.number().optional(),
						response_format: z
							.object({
								type: z.enum(["text", "json_object"]).openapi({
									example: "json_object",
								}),
							})
							.optional(),
						stream: z.boolean().optional().default(false),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "User response object or streaming response.",
		},
		500: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.object({
							message: z.string(),
							type: z.string(),
							param: z.string().nullable(),
							code: z.string(),
						}),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "Error response object.",
		},
	},
});

chat.openapi(completions, async (c) => {
	const {
		model: modelInput,
		messages: messagesInput,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		response_format,
		stream,
	} = c.req.valid("json");

	// filter out empty messages
	const messages = messagesInput.filter((m) => m.content.trim());

	// Extract or generate request ID
	const requestId = c.req.header("x-request-id") || shortid(40);

	c.header("x-request-id", requestId);

	let requestedModel: Model = modelInput as Model;
	let requestedProvider: Provider | undefined;

	// check if there is an exact model match
	if (modelInput === "auto" || modelInput === "custom") {
		requestedProvider = "llmgateway";
		requestedModel = modelInput as Model;
	} else if (modelInput.includes("/")) {
		const split = modelInput.split("/");
		const providerCandidate = split[0];

		// Check if the provider exists
		if (!providers.find((p) => p.id === providerCandidate)) {
			throw new HTTPException(400, {
				message: `Requested provider ${providerCandidate} not supported. If you requested a model on a specific provider, make sure to prefix the model name with the provider name. e.g. inference.net/llama-3.3-70b-instruct`,
			});
		}

		requestedProvider = providerCandidate as Provider;
		// Handle model names with multiple slashes (e.g. together.ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo)
		const modelName = split.slice(1).join("/");

		// First try to find by base model name
		let modelDef = models.find((m) => m.model === modelName);

		if (!modelDef) {
			modelDef = models.find((m) =>
				m.providers.some(
					(p) =>
						p.modelName === modelName && p.providerId === requestedProvider,
				),
			);
		}

		if (!modelDef) {
			throw new HTTPException(400, {
				message: `Requested model ${modelName} not supported`,
			});
		}

		if (!modelDef.providers.some((p) => p.providerId === requestedProvider)) {
			throw new HTTPException(400, {
				message: `Provider ${requestedProvider} does not support model ${modelName}`,
			});
		}

		// Use the provider-specific model name if available
		const providerMapping = modelDef.providers.find(
			(p) => p.providerId === requestedProvider,
		);
		if (providerMapping) {
			requestedModel = providerMapping.modelName as Model;
		} else {
			requestedModel = modelName as Model;
		}
	} else if (models.find((m) => m.model === modelInput)) {
		requestedModel = modelInput as Model;
	} else if (
		models.find((m) => m.providers.find((p) => p.modelName === modelInput))
	) {
		const model = models.find((m) =>
			m.providers.find((p) => p.modelName === modelInput),
		);
		const provider = model?.providers.find((p) => p.modelName === modelInput);

		throw new HTTPException(400, {
			message: `Model ${modelInput} must be requested with a provider prefix. Use the format: ${provider?.providerId}/${model?.model}`,
		});
	} else {
		throw new HTTPException(400, {
			message: `Requested model ${modelInput} not supported`,
		});
	}

	if (requestedProvider && !providers.find((p) => p.id === requestedProvider)) {
		throw new HTTPException(400, {
			message: `Requested provider ${requestedProvider} not supported`,
		});
	}

	const modelInfo =
		models.find((m) => m.model === requestedModel) ||
		models.find((m) => m.providers.find((p) => p.modelName === requestedModel));

	if (!modelInfo) {
		throw new HTTPException(400, {
			message: `Unsupported model: ${requestedModel}`,
		});
	}

	if (response_format?.type === "json_object") {
		if (!(modelInfo as any).jsonOutput) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support JSON output mode`,
			});
		}
	}

	let usedProvider = requestedProvider;
	let usedModel = requestedModel;

	const auth = c.req.header("Authorization");
	if (!auth) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: No Authorization header provided. Expected 'Bearer your-api-token'",
		});
	}

	const split = auth.split("Bearer ");
	if (split.length !== 2) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid Authorization header format. Expected 'Bearer your-api-token'",
		});
	}
	const token = split[1];
	if (!token) {
		throw new HTTPException(401, {
			message: "Unauthorized: No token provided",
		});
	}

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			token: {
				eq: token,
			},
		},
	});

	if (!apiKey) {
		throw new HTTPException(401, {
			message: "Unauthorized: Invalid token",
		});
	}

	// Get the project to determine mode for routing decisions
	const project = await getProject(apiKey.projectId);

	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	// Apply routing logic after apiKey and project are available
	if (
		(usedProvider === "llmgateway" && usedModel === "auto") ||
		usedModel === "auto"
	) {
		// Get available providers based on project mode
		let availableProviders: string[] = [];

		if (project.mode === "api-keys") {
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: { eq: "active" },
					organizationId: { eq: project.organizationId },
				},
			});
			availableProviders = providerKeys.map((key) => key.provider);
		} else if (project.mode === "credits" || project.mode === "hybrid") {
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: { eq: "active" },
					organizationId: { eq: project.organizationId },
				},
			});
			const databaseProviders = providerKeys.map((key) => key.provider);

			// Check which providers have environment tokens available
			const envProviders: string[] = [];
			const supportedProviders = providers
				.filter((p) => p.id !== "llmgateway")
				.map((p) => p.id);
			for (const provider of supportedProviders) {
				if (hasProviderEnvironmentToken(provider as Provider)) {
					envProviders.push(provider);
				}
			}

			if (project.mode === "credits") {
				availableProviders = envProviders;
			} else {
				availableProviders = [
					...new Set([...databaseProviders, ...envProviders]),
				];
			}
		}

		for (const modelDef of models) {
			if (modelDef.model === "auto" || modelDef.model === "custom") {
				continue;
			}

			// Check if any of the model's providers are available
			const availableModelProviders = modelDef.providers.filter((provider) =>
				availableProviders.includes(provider.providerId),
			);

			if (availableModelProviders.length > 0) {
				usedProvider = availableModelProviders[0].providerId;
				usedModel = availableModelProviders[0].modelName;
				break;
			}
		}

		if (usedProvider === "llmgateway" || !usedProvider) {
			usedModel = "gpt-4o-mini";
			usedProvider = "openai";
		}
	} else if (
		(usedProvider === "llmgateway" && usedModel === "custom") ||
		usedModel === "custom"
	) {
		usedProvider = "llmgateway";
		usedModel = "custom";
	} else if (!usedProvider) {
		if (modelInfo.providers.length === 1) {
			usedProvider = modelInfo.providers[0].providerId;
			usedModel = modelInfo.providers[0].modelName;
		} else {
			const providerIds = modelInfo.providers.map((p) => p.providerId);
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: {
						eq: "active",
					},
					organizationId: {
						eq: project.organizationId,
					},
					provider: {
						in: providerIds,
					},
				},
			});

			const availableProviders =
				project.mode === "api-keys"
					? providerKeys.map((key) => key.provider)
					: providers
							.filter((p) => p.id !== "llmgateway")
							.filter((p) => hasProviderEnvironmentToken(p.id as Provider))
							.map((p) => p.id);

			// Filter model providers to only those available
			const availableModelProviders = modelInfo.providers.filter((provider) =>
				availableProviders.includes(provider.providerId),
			);

			if (availableModelProviders.length === 0) {
				throw new HTTPException(400, {
					message:
						project.mode === "api-keys"
							? `No provider key set for any of the providers that support model ${usedModel}. Please add the provider key in the settings or switch the project mode to credits or hybrid.`
							: `No available provider could be found for model ${usedModel}`,
				});
			}

			const modelWithPricing = models.find((m) => m.model === usedModel);

			if (modelWithPricing) {
				let cheapestProvider = availableModelProviders[0].providerId;
				let cheapestModel = availableModelProviders[0].modelName;
				let lowestPrice = Number.MAX_VALUE;

				for (const provider of availableModelProviders) {
					const providerInfo = modelWithPricing.providers.find(
						(p) => p.providerId === provider.providerId,
					);
					const totalPrice =
						((providerInfo?.inputPrice || 0) +
							(providerInfo?.outputPrice || 0)) /
						2;

					if (totalPrice < lowestPrice) {
						lowestPrice = totalPrice;
						cheapestProvider = provider.providerId;
						cheapestModel = provider.modelName;
					}
				}

				usedProvider = cheapestProvider;
				usedModel = cheapestModel;
			} else {
				usedProvider = availableModelProviders[0].providerId;
				usedModel = availableModelProviders[0].modelName;
			}
		}
	}

	if (!usedProvider) {
		throw new HTTPException(500, {
			message: "An error occurred while routing the request",
		});
	}

	let url: string | undefined;

	// Get the provider key for the selected provider based on project mode

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;

	if (project.mode === "api-keys") {
		// Get the provider key from the database using cached helper function
		providerKey = await getProviderKey(project.organizationId, usedProvider);

		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${usedProvider}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			});
		}

		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		// Check if the organization has enough credits using cached helper function
		const organization = await getOrganization(project.organizationId);

		if (!organization) {
			throw new HTTPException(500, {
				message: "Could not find organization",
			});
		}

		if (organization.credits <= 0) {
			throw new HTTPException(402, {
				message: "Organization has insufficient credits",
			});
		}

		usedToken = getProviderTokenFromEnv(usedProvider);
	} else if (project.mode === "hybrid") {
		// First try to get the provider key from the database
		providerKey = await getProviderKey(project.organizationId, usedProvider);

		if (providerKey) {
			usedToken = providerKey.token;
		} else {
			// Check if the organization has enough credits
			const organization = await getOrganization(project.organizationId);

			if (!organization) {
				throw new HTTPException(500, {
					message: "Could not find organization",
				});
			}

			if (organization.credits <= 0) {
				throw new HTTPException(402, {
					message:
						"No API key set for provider and organization has insufficient credits",
				});
			}

			usedToken = getProviderTokenFromEnv(usedProvider);
		}
	} else {
		throw new HTTPException(400, {
			message: `Invalid project mode: ${project.mode}`,
		});
	}

	if (!usedToken) {
		throw new HTTPException(500, {
			message: `No token`,
		});
	}

	try {
		if (!usedProvider) {
			throw new HTTPException(400, {
				message: "No provider available for the requested model",
			});
		}

		url = getProviderEndpoint(
			usedProvider,
			providerKey?.baseUrl || undefined,
			usedModel,
			usedProvider === "google-ai-studio" ? usedToken : undefined,
		);
	} catch (error) {
		if (usedProvider === "llmgateway" && usedModel !== "custom") {
			throw new HTTPException(400, {
				message: `Invalid model: ${usedModel} for provider: ${usedProvider}`,
			});
		}

		throw new HTTPException(500, {
			message: `Could not use provider: ${usedProvider}. ${error instanceof Error ? error.message : ""}`,
		});
	}

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}. Please add a base URL in your settings.`,
		});
	}

	// Check if caching is enabled for this project
	const { enabled: cachingEnabled, duration: cacheDuration } =
		await isCachingEnabled(project.id);

	let cacheKey: string | null = null;
	if (cachingEnabled && !stream) {
		// Don't cache streaming responses
		cacheKey = generateCacheKey({
			model: usedModel,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
		});

		const cachedResponse = cacheKey ? await getCache(cacheKey) : null;
		if (cachedResponse) {
			// Log the cached request
			const duration = 0; // No processing time needed
			const baseLogEntry = createLogEntry(
				requestId,
				project,
				apiKey,
				providerKey?.id,
				usedModel,
				usedProvider,
				requestedModel,
				requestedProvider,
				messages,
				temperature,
				max_tokens,
				top_p,
				frequency_penalty,
				presence_penalty,
			);

			await insertLog({
				...baseLogEntry,
				duration,
				responseSize: JSON.stringify(cachedResponse).length,
				content: cachedResponse.choices?.[0]?.message?.content || null,
				finishReason: cachedResponse.choices?.[0]?.finish_reason || null,
				promptTokens: cachedResponse.usage?.prompt_tokens || null,
				completionTokens: cachedResponse.usage?.completion_tokens || null,
				totalTokens: cachedResponse.usage?.total_tokens || null,
				hasError: false,
				streamed: false,
				canceled: false,
				errorDetails: null,
				inputCost: 0,
				outputCost: 0,
				cost: 0,
				estimatedCost: false,
				cached: true,
			});

			return c.json(cachedResponse);
		}
	}

	// Check if streaming is requested and if the provider supports it
	if (stream) {
		const providerInfo = providers.find((p) => p.id === usedProvider);
		if (!providerInfo?.streaming) {
			throw new HTTPException(400, {
				message: `Provider ${usedProvider} does not support streaming`,
			});
		}
	}

	// Check if the request can be canceled
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	const requestBody = prepareRequestBody(
		usedProvider,
		usedModel,
		messages,
		stream,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		response_format,
	);

	const startTime = Date.now();

	// Handle streaming response if requested
	if (stream) {
		return streamSSE(c, async (stream) => {
			let eventId = 0;
			let canceled = false;

			// Set up cancellation handling
			const controller = new AbortController();
			// Set up a listener for the request being aborted
			const onAbort = () => {
				if (requestCanBeCanceled) {
					canceled = true;
					controller.abort();
				}
			};

			// Add event listener for the abort event on the connection
			c.req.raw.signal.addEventListener("abort", onAbort);

			let res;
			try {
				const headers = getProviderHeaders(usedProvider, usedToken);
				headers["Content-Type"] = "application/json";

				res = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(requestBody),
					signal: requestCanBeCanceled ? controller.signal : undefined,
				});
			} catch (error) {
				// Clean up the event listeners
				c.req.raw.signal.removeEventListener("abort", onAbort);

				if (error instanceof Error && error.name === "AbortError") {
					// Log the canceled request
					const baseLogEntry = createLogEntry(
						requestId,
						project,
						apiKey,
						providerKey?.id,
						usedModel,
						usedProvider,
						requestedModel,
						requestedProvider,
						messages,
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
					);

					await insertLog({
						...baseLogEntry,
						duration: Date.now() - startTime,
						responseSize: 0,
						content: null,
						finishReason: "canceled",
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						hasError: false,
						streamed: true,
						canceled: true,
						errorDetails: null,
						cached: false,
					});

					// Send a cancellation event to the client
					await stream.writeSSE({
						event: "canceled",
						data: JSON.stringify({
							message: "Request canceled by client",
						}),
						id: String(eventId++),
					});
					await stream.writeSSE({
						event: "done",
						data: "[DONE]",
						id: String(eventId++),
					});
					return;
				} else {
					throw error;
				}
			}

			if (!res.ok) {
				const errorResponseText = await res.text();
				console.error("error", url, res.status, errorResponseText);

				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						error: {
							message: `Error from provider: ${res.status} ${res.statusText}`,
							type: getFinishReasonForError(res.status),
							param: null,
							code: getFinishReasonForError(res.status),
						},
					}),
					id: String(eventId++),
				});
				await stream.writeSSE({
					event: "done",
					data: "[DONE]",
					id: String(eventId++),
				});

				// Log the error in the database
				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
				);

				await insertLog({
					...baseLogEntry,
					duration: Date.now() - startTime,
					responseSize: errorResponseText.length,
					content: null,
					finishReason: getFinishReasonForError(res.status),
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					hasError: true,
					streamed: true,
					canceled: false,
					errorDetails: {
						statusCode: res.status,
						statusText: res.statusText,
						responseText: errorResponseText,
					},
					cached: false,
				});

				return;
			}

			if (!res.body) {
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						error: {
							message: "No response body from provider",
							type: "gateway_error",
							param: null,
							code: "gateway_error",
						},
					}),
					id: String(eventId++),
				});
				await stream.writeSSE({
					event: "done",
					data: "[DONE]",
					id: String(eventId++),
				});
				return;
			}

			const reader = res.body.getReader();
			let fullContent = "";
			let finishReason = null;
			let promptTokens = null;
			let completionTokens = null;
			let totalTokens = null;

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					// Convert the Uint8Array to a string
					const chunk = new TextDecoder().decode(value);

					// Process the chunk to extract content for logging and forward to client
					const lines = chunk.split("\n");
					for (const line of lines) {
						if (line.startsWith("data: ")) {
							if (line === "data: [DONE]") {
								// Calculate final usage if we don't have complete data
								let finalPromptTokens = promptTokens;
								let finalCompletionTokens = completionTokens;
								let finalTotalTokens = totalTokens;

								// Estimate missing tokens if needed
								if (finalPromptTokens === null) {
									finalPromptTokens = Math.round(
										messages.reduce(
											(acc, m) => acc + (m.content?.length || 0),
											0,
										) / 4,
									);
								}

								if (finalCompletionTokens === null) {
									finalCompletionTokens = Math.round(fullContent.length / 4);
								}

								if (finalTotalTokens === null) {
									finalTotalTokens =
										(finalPromptTokens || 0) + (finalCompletionTokens || 0);
								}

								// Send final usage chunk before [DONE] if we have any usage data
								if (
									finalPromptTokens !== null ||
									finalCompletionTokens !== null ||
									finalTotalTokens !== null
								) {
									const finalUsageChunk = {
										id: `chatcmpl-${Date.now()}`,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model: usedModel,
										choices: [
											{
												index: 0,
												delta: {},
												finish_reason: null,
											},
										],
										usage: {
											prompt_tokens: finalPromptTokens || 0,
											completion_tokens: finalCompletionTokens || 0,
											total_tokens: finalTotalTokens || 0,
										},
									};

									await stream.writeSSE({
										event: "chunk",
										data: JSON.stringify(finalUsageChunk),
										id: String(eventId++),
									});
								}

								await stream.writeSSE({
									event: "done",
									data: "[DONE]",
									id: String(eventId++),
								});
							} else {
								try {
									const data = JSON.parse(line.substring(6));

									// Transform streaming responses to OpenAI format for all providers
									const transformedData = transformStreamingChunkToOpenAIFormat(
										usedProvider,
										usedModel,
										data,
									);

									// For Anthropic, if we have partial usage data, complete it
									if (usedProvider === "anthropic" && transformedData.usage) {
										const usage = transformedData.usage;
										if (
											usage.output_tokens !== undefined &&
											usage.prompt_tokens === undefined
										) {
											// Estimate prompt tokens if not provided
											const estimatedPromptTokens = Math.round(
												messages.reduce(
													(acc, m) => acc + (m.content?.length || 0),
													0,
												) / 4,
											);
											transformedData.usage = {
												prompt_tokens: estimatedPromptTokens,
												completion_tokens: usage.output_tokens,
												total_tokens:
													estimatedPromptTokens + usage.output_tokens,
											};
										}
									}

									await stream.writeSSE({
										event: "chunk",
										data: JSON.stringify(transformedData),
										id: String(eventId++),
									});

									// Extract content for logging based on provider
									switch (usedProvider) {
										case "anthropic":
											// Handle different Anthropic event types
											if (
												data.type === "content_block_delta" &&
												data.delta?.text
											) {
												fullContent += data.delta.text;
											} else if (data.delta?.text) {
												// Fallback for older format
												fullContent += data.delta.text;
											}

											if (
												data.type === "message_delta" &&
												data.delta?.stop_reason
											) {
												finishReason = data.delta.stop_reason;
											} else if (
												data.type === "message_stop" ||
												data.stop_reason
											) {
												finishReason = data.stop_reason || "end_turn";
											} else if (data.delta?.stop_reason) {
												finishReason = data.delta.stop_reason;
											}

											if (data.usage) {
												// For streaming, Anthropic might only provide output_tokens
												if (data.usage.input_tokens !== undefined) {
													promptTokens = data.usage.input_tokens;
												}
												if (data.usage.output_tokens !== undefined) {
													completionTokens = data.usage.output_tokens;
												}
												totalTokens =
													(promptTokens || 0) + (completionTokens || 0);
											} else if (finishReason) {
												if (!promptTokens) {
													promptTokens =
														messages.reduce(
															(acc, m) => acc + (m.content?.length || 0),
															0,
														) / 4;
												}

												if (!completionTokens) {
													completionTokens = fullContent.length / 4;
												}

												totalTokens =
													(promptTokens || 0) + (completionTokens || 0);
											}
											break;
										case "google-vertex":
										case "google-ai-studio":
											if (
												data.candidates &&
												data.candidates[0]?.content?.parts[0]?.text
											) {
												fullContent += data.candidates[0].content.parts[0].text;
											}
											if (data.candidates && data.candidates[0]?.finishReason) {
												finishReason = data.candidates[0].finishReason;
											}
											break;
										case "inference.net":
										case "kluster.ai":
										case "together.ai":
											if (data.choices && data.choices[0]) {
												if (data.choices[0].delta?.content) {
													fullContent += data.choices[0].delta.content;
												}
												if (data.choices[0].finish_reason) {
													finishReason = data.choices[0].finish_reason;
												}
											}

											// Extract token counts if available
											if (data.usage) {
												if (data.usage.prompt_tokens !== undefined) {
													promptTokens = data.usage.prompt_tokens;
												}
												if (data.usage.completion_tokens !== undefined) {
													completionTokens = data.usage.completion_tokens;
												}
												if (data.usage.total_tokens !== undefined) {
													totalTokens = data.usage.total_tokens;
												} else {
													totalTokens =
														(promptTokens || 0) + (completionTokens || 0);
												}
											} else if (finishReason) {
												// Estimate tokens if not provided
												if (!promptTokens) {
													promptTokens =
														messages.reduce(
															(acc, m) => acc + (m.content?.length || 0),
															0,
														) / 4;
												}

												if (!completionTokens) {
													completionTokens = fullContent.length / 4;
												}

												totalTokens =
													(promptTokens || 0) + (completionTokens || 0);
											}
											break;
										default: // OpenAI format
											if (data.choices && data.choices[0]) {
												if (data.choices[0].delta?.content) {
													fullContent += data.choices[0].delta.content;
												}
												if (data.choices[0].finish_reason) {
													finishReason = data.choices[0].finish_reason;
												}
											}
									}

									if (data.usage) {
										promptTokens = data.usage.prompt_tokens;
										completionTokens = data.usage.completion_tokens;
										totalTokens = data.usage.total_tokens;
									}
									// eslint-disable-next-line unused-imports/no-unused-vars
								} catch (_e) {
									// Ignore parsing errors for incomplete JSON
								}
							}
						}
					}
				}
			} catch (error) {
				console.error("Error reading stream:", error);
			} finally {
				// Clean up the event listeners
				c.req.raw.signal.removeEventListener("abort", onAbort);

				// Log the streaming request
				const duration = Date.now() - startTime;

				// Calculate estimated tokens if not provided
				let calculatedPromptTokens = promptTokens;
				let calculatedCompletionTokens = completionTokens;
				let calculatedTotalTokens = totalTokens;

				// Estimate tokens for providers that don't provide them during streaming
				if (!promptTokens || !completionTokens) {
					if (!promptTokens) {
						calculatedPromptTokens =
							messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) /
							4;
					}

					if (!completionTokens) {
						calculatedCompletionTokens = fullContent.length / 4;
					}

					calculatedTotalTokens =
						(calculatedPromptTokens || 0) + (calculatedCompletionTokens || 0);
				}

				// Send final usage chunk if we haven't sent one yet and we have calculated usage
				if (
					promptTokens === null &&
					completionTokens === null &&
					totalTokens === null &&
					(calculatedPromptTokens !== null ||
						calculatedCompletionTokens !== null)
				) {
					try {
						const finalUsageChunk = {
							id: `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: usedModel,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: null,
								},
							],
							usage: {
								prompt_tokens: Math.round(calculatedPromptTokens || 0),
								completion_tokens: Math.round(calculatedCompletionTokens || 0),
								total_tokens: Math.round(calculatedTotalTokens || 0),
							},
						};

						await stream.writeSSE({
							event: "chunk",
							data: JSON.stringify(finalUsageChunk),
							id: String(eventId++),
						});

						// Send final [DONE] if we haven't already
						await stream.writeSSE({
							event: "done",
							data: "[DONE]",
							id: String(eventId++),
						});
					} catch (error) {
						console.error("Error sending final usage chunk:", error);
					}
				}

				const costs = calculateCosts(
					usedModel,
					usedProvider,
					calculatedPromptTokens,
					calculatedCompletionTokens,
					{
						prompt: messages.map((m) => m.content).join("\n"),
						completion: fullContent,
					},
				);

				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
				);

				await insertLog({
					...baseLogEntry,
					duration,
					responseSize: fullContent.length,
					content: fullContent,
					finishReason: finishReason,
					promptTokens: calculatedPromptTokens,
					completionTokens: calculatedCompletionTokens,
					totalTokens: calculatedTotalTokens,
					hasError: false,
					errorDetails: null,
					streamed: true,
					canceled: canceled,
					inputCost: costs.inputCost,
					outputCost: costs.outputCost,
					cost: costs.totalCost,
					estimatedCost: costs.estimatedCost,
					cached: false,
				});
			}
		});
	}

	// Handle non-streaming response
	const controller = new AbortController();
	// Set up a listener for the request being aborted
	const onAbort = () => {
		if (requestCanBeCanceled) {
			controller.abort();
		}
	};

	// Add event listener for the 'close' event on the connection
	c.req.raw.signal.addEventListener("abort", onAbort);

	let canceled = false;
	let res;
	try {
		const headers = getProviderHeaders(usedProvider, usedToken);
		headers["Content-Type"] = "application/json";
		res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			signal: requestCanBeCanceled ? controller.signal : undefined,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			canceled = true;
		} else {
			throw error;
		}
	} finally {
		// Clean up the event listener
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}

	const duration = Date.now() - startTime;

	// If the request was canceled, log it and return a response
	if (canceled) {
		// Log the canceled request
		const baseLogEntry = createLogEntry(
			requestId,
			project,
			apiKey,
			providerKey?.id,
			usedModel,
			usedProvider,
			requestedModel,
			requestedProvider,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
		);

		await insertLog({
			...baseLogEntry,
			duration,
			responseSize: 0,
			content: null,
			finishReason: "canceled",
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			hasError: false,
			streamed: false,
			canceled: true,
			errorDetails: null,
			estimatedCost: false,
			cached: false,
		});

		return c.json(
			{
				error: {
					message: "Request canceled by client",
					type: "canceled",
					param: null,
					code: "request_canceled",
				},
			},
			400,
		); // Using 400 status code for client closed request
	}

	if (res && !res.ok) {
		// Get the error response text
		const errorResponseText = await res.text();

		console.error("error", url, res.status, errorResponseText);

		// Log the error in the database
		const baseLogEntry = createLogEntry(
			requestId,
			project,
			apiKey,
			providerKey?.id,
			usedModel,
			usedProvider,
			requestedModel,
			requestedProvider,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
		);

		await insertLog({
			...baseLogEntry,
			duration,
			responseSize: errorResponseText.length,
			content: null,
			finishReason: getFinishReasonForError(res.status),
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			hasError: true,
			streamed: false,
			canceled: false,
			errorDetails: {
				statusCode: res.status,
				statusText: res.statusText,
				responseText: errorResponseText,
			},
			estimatedCost: false,
			cached: false,
		});

		// Return a 500 error response
		return c.json(
			{
				error: {
					message: `Error from provider: ${res.status} ${res.statusText}`,
					type: getFinishReasonForError(res.status),
					param: null,
					code: getFinishReasonForError(res.status),
					requestedProvider,
					usedProvider,
					requestedModel,
					usedModel,
				},
			},
			500,
		);
	}

	if (!res) {
		throw new Error("No response from provider");
	}

	const json = await res.json();
	if (process.env.NODE_ENV !== "production") {
		console.log("response", json);
	}
	const responseText = JSON.stringify(json);

	// Extract content and token usage based on provider
	const { content, finishReason, promptTokens, completionTokens, totalTokens } =
		parseProviderResponse(usedProvider, json);

	// Estimate tokens if not provided by the API
	const { calculatedPromptTokens, calculatedCompletionTokens } = estimateTokens(
		usedProvider,
		messages,
		content,
		promptTokens,
		completionTokens,
	);

	const costs = calculateCosts(
		usedModel,
		usedProvider,
		calculatedPromptTokens,
		calculatedCompletionTokens,
		{
			prompt: messages.map((m) => m.content).join("\n"),
			completion: content,
		},
	);

	const baseLogEntry = createLogEntry(
		requestId,
		project,
		apiKey,
		providerKey?.id,
		usedModel,
		usedProvider,
		requestedModel,
		requestedProvider,
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
	);

	await insertLog({
		...baseLogEntry,
		duration,
		responseSize: responseText.length,
		content: content,
		finishReason: finishReason,
		promptTokens: promptTokens,
		completionTokens: completionTokens,
		totalTokens: totalTokens,
		hasError: false,
		streamed: false,
		canceled: false,
		errorDetails: null,
		inputCost: costs.inputCost,
		outputCost: costs.outputCost,
		cost: costs.totalCost,
		estimatedCost: costs.estimatedCost,
		cached: false,
	});

	// Transform response to OpenAI format for non-OpenAI providers
	const transformedResponse = transformToOpenAIFormat(
		usedProvider,
		usedModel,
		json,
		content,
		finishReason,
		promptTokens,
		completionTokens,
		totalTokens,
	);

	if (cachingEnabled && cacheKey && !stream) {
		await setCache(cacheKey, transformedResponse, cacheDuration);
	}

	return c.json(transformedResponse);
});
