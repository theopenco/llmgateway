import { models } from "./models";

import type { ProviderId } from "./providers";

/**
 * Processes an image URL or data URL and converts it to base64
 */
async function processImageUrl(
	url: string,
	isProd = false,
): Promise<{ data: string; mimeType: string }> {
	// Handle data URLs directly without network fetch
	if (url.startsWith("data:")) {
		const dataUrlMatch = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/);
		if (!dataUrlMatch) {
			console.warn("Invalid data URL format provided");
			throw new Error("Invalid image data URL format");
		}

		const [, mimeType, data] = dataUrlMatch;

		// Validate it's an image MIME type
		if (!mimeType.startsWith("image/")) {
			console.warn("Non-image MIME type in data URL:", mimeType);
			throw new Error("Data URL must contain an image");
		}

		// Check if data is base64 encoded or needs encoding
		const isBase64 = url.includes(";base64,");
		const base64Data = isBase64 ? data : btoa(data);

		// Validate size (estimate: base64 adds ~33% overhead)
		const estimatedSize = (base64Data.length * 3) / 4;
		if (estimatedSize > 20 * 1024 * 1024) {
			console.warn("Data URL image size exceeds limit:", estimatedSize);
			throw new Error("Image size exceeds 20MB limit");
		}

		return {
			data: base64Data,
			mimeType,
		};
	}

	// Validate HTTPS URLs only in production environment
	if (!url.startsWith("https://") && isProd) {
		console.warn(
			"Non-HTTPS URL provided for image fetch in production:",
			url.substring(0, 20) + "...",
		);
		throw new Error("Image URLs must use HTTPS protocol in production");
	}

	try {
		const response = await fetch(url);

		if (!response.ok) {
			console.warn(
				`Failed to fetch image from URL (${response.status}):`,
				url.substring(0, 50) + "...",
			);
			throw new Error(`Failed to fetch image: HTTP ${response.status}`);
		}

		// Check content length (20MB = 20 * 1024 * 1024 bytes)
		const contentLength = response.headers.get("content-length");
		if (contentLength && parseInt(contentLength, 10) > 20 * 1024 * 1024) {
			console.warn(
				"Image size exceeds limit via Content-Length:",
				contentLength,
			);
			throw new Error("Image size exceeds 20MB limit");
		}

		const contentType = response.headers.get("content-type");
		if (!contentType || !contentType.startsWith("image/")) {
			console.warn(
				"Invalid content type for image URL:",
				contentType,
				"from:",
				url.substring(0, 50) + "...",
			);
			throw new Error("URL does not point to a valid image");
		}

		const arrayBuffer = await response.arrayBuffer();

		// Check actual size after download
		if (arrayBuffer.byteLength > 20 * 1024 * 1024) {
			console.warn(
				"Image size exceeds limit after download:",
				arrayBuffer.byteLength,
			);
			throw new Error("Image size exceeds 20MB limit");
		}

		// Convert arrayBuffer to base64 using browser-compatible API
		const uint8Array = new Uint8Array(arrayBuffer);
		const binaryString = Array.from(uint8Array, (byte) =>
			String.fromCharCode(byte),
		).join("");
		const base64 = btoa(binaryString);

		return {
			data: base64,
			mimeType: contentType,
		};
	} catch (error) {
		// Log the full error internally but sanitize the thrown error
		console.error(
			"Error processing image URL:",
			error,
			"URL:",
			url.substring(0, 50) + "...",
		);

		if (
			error instanceof Error &&
			error.message.includes("Image size exceeds")
		) {
			throw error; // Re-throw size limit errors as-is
		}
		if (
			error instanceof Error &&
			error.message.includes("Failed to fetch image: HTTP")
		) {
			throw error; // Re-throw HTTP status errors as-is
		}
		if (
			error instanceof Error &&
			error.message.includes("URL does not point to a valid image")
		) {
			throw error; // Re-throw content type errors as-is
		}

		// Generic error for all other cases
		throw new Error("Failed to process image from URL");
	}
}

/**
 * Transforms Google messages to handle image URLs by converting them to base64
 */
async function transformGoogleMessages(messages: any[], isProd = false) {
	return await Promise.all(
		messages.map(async (m) => ({
			role: m.role === "assistant" ? "model" : "user", // get rid of system role
			parts: Array.isArray(m.content)
				? await Promise.all(
						m.content.map(async (i: any) => {
							if (i.type === "text") {
								return {
									text: i.text,
								};
							}
							if (i.type === "image_url") {
								const imageUrl = i.image_url.url;
								try {
									const { data, mimeType } = await processImageUrl(
										imageUrl,
										isProd,
									);
									return {
										inline_data: {
											mime_type: mimeType,
											data: data,
										},
									};
								} catch (error) {
									// Don't expose the URL in the error message for security
									const errorMsg =
										error instanceof Error ? error.message : "Unknown error";
									throw new Error(`Failed to process image: ${errorMsg}`);
								}
							}
							throw new Error(`Not supported content type yet: ${i.type}`);
						}),
					)
				: [
						{
							text: m.content,
						},
					],
		})),
	);
}

/**
 * Transforms Anthropic messages to handle image URLs by converting them to base64
 */
async function transformAnthropicMessages(messages: any[], isProd = false) {
	const results = [] as any[];
	for (const m of messages) {
		let content: any[] = [];

		// Handle existing content
		if (Array.isArray(m.content)) {
			// Process all images in parallel for better performance
			content = await Promise.all(
				m.content.map(async (part: any) => {
					if (part.type === "image_url" && part.image_url?.url) {
						try {
							const { data, mimeType } = await processImageUrl(
								part.image_url.url,
								isProd,
							);
							return {
								type: "image",
								source: {
									type: "base64",
									media_type: mimeType,
									data: data,
								},
							};
						} catch (error) {
							console.error(
								`Failed to fetch image ${part.image_url.url}:`,
								error,
							);
							// Fallback to text representation
							return {
								type: "text",
								text: `[Image failed to load: ${part.image_url.url}]`,
							};
						}
					}
					return part;
				}),
			);
		} else if (m.content && typeof m.content === "string") {
			// Handle string content
			content = [{ type: "text", text: m.content }];
		}

		// Handle OpenAI-style tool_calls by converting them to Anthropic tool_use content blocks
		if (m.tool_calls && Array.isArray(m.tool_calls)) {
			const toolUseBlocks = m.tool_calls.map((toolCall: any) => ({
				type: "tool_use",
				id: toolCall.id,
				name: toolCall.function.name,
				input: JSON.parse(toolCall.function.arguments),
			}));
			content = content.concat(toolUseBlocks);
		}

		// Handle OpenAI-style tool role messages by converting them to Anthropic tool_result content blocks
		// Use the original role since the mapped role will be "user"
		const originalRole = m.role === "user" && m.tool_call_id ? "tool" : m.role;
		if (originalRole === "tool" && m.tool_call_id && m.content) {
			// For tool results, we need to check if content is JSON string and parse it appropriately
			let toolResultContent = m.content;
			try {
				// Try to parse as JSON to see if it's structured data
				const parsed = JSON.parse(m.content);
				// If it's an object, keep it as JSON string for Anthropic
				if (typeof parsed === "object") {
					toolResultContent = m.content;
				} else {
					toolResultContent = String(parsed);
				}
			} catch {
				// If it's not valid JSON, use as-is
				toolResultContent = m.content;
			}

			content = [
				{
					type: "tool_result",
					tool_use_id: m.tool_call_id,
					content: toolResultContent,
				},
			];
		}

		// Filter out empty text content blocks as Anthropic requires non-empty text
		const filteredContent = content.filter(
			(part: any) =>
				!(part.type === "text" && (!part.text || part.text.trim() === "")),
		);

		// Ensure we have at least some content - if all content was filtered out but we have tool_calls, that's still valid
		if (
			filteredContent.length === 0 &&
			(!m.tool_calls || m.tool_calls.length === 0)
		) {
			// Skip messages with no valid content
			continue;
		}

		// Remove tool_calls and tool_call_id from the message as Anthropic doesn't expect these fields
		const { tool_calls: _, tool_call_id: __, ...messageWithoutToolFields } = m;
		results.push({ ...messageWithoutToolFields, content: filteredContent });
	}
	return results;
}

/**
 * Get the appropriate headers for a given provider API call
 */
export function getProviderHeaders(
	provider: ProviderId,
	token: string,
): Record<string, string> {
	switch (provider) {
		case "anthropic":
			return {
				"x-api-key": token,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "tools-2024-04-04",
			};
		case "google-ai-studio":
			return {};
		case "google-vertex":
		case "openai":
		case "inference.net":
		case "xai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "novita":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "zai":
		case "custom":
		default:
			return {
				Authorization: `Bearer ${token}`,
			};
	}
}

/**
 * Prepares the request body for different providers
 */
export async function prepareRequestBody(
	usedProvider: ProviderId,
	usedModel: string,
	messages: any[],
	stream: boolean,
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
	response_format: any,
	tools?: any[],
	tool_choice?: string | { type: string; function: { name: string } },
	reasoning_effort?: "low" | "medium" | "high",
	supportsReasoning?: boolean,
	isProd = false,
) {
	const requestBody: any = {
		model: usedModel,
		messages,
		stream: stream,
	};

	// Add tools, tool_choice, and tool_calls if provided
	if (tools && tools.length > 0) {
		requestBody.tools = tools;
	}

	if (tool_choice) {
		requestBody.tool_choice = tool_choice;
	}

	switch (usedProvider) {
		case "openai": {
			// Override temperature to 1 for GPT-5 models (they only support temperature = 1)
			let effectiveTemperature = temperature;
			if (usedModel.startsWith("gpt-5")) {
				effectiveTemperature = 1;
			}

			if (supportsReasoning) {
				// Transform to responses API format (now supports tools as well)
				const responsesBody: any = {
					model: usedModel,
					input: messages,
					reasoning: {
						effort: reasoning_effort || "medium",
						summary: "detailed",
					},
				};

				// Add streaming support
				if (stream) {
					responsesBody.stream = true;
				}

				// Add tools support for responses API (transform format if needed)
				if (tools && tools.length > 0) {
					// Transform tools from chat completions format to responses API format
					responsesBody.tools = tools.map((tool: any) => {
						if (tool.type === "function" && tool.function) {
							return {
								type: "function",
								name: tool.function.name,
								description: tool.function.description,
								parameters: tool.function.parameters,
							};
						}
						return tool;
					});
				}
				if (tool_choice) {
					responsesBody.tool_choice = tool_choice;
				}

				// Add optional parameters if they are provided
				if (effectiveTemperature !== undefined) {
					responsesBody.temperature = effectiveTemperature;
				}
				if (max_tokens !== undefined) {
					responsesBody.max_completion_tokens = max_tokens;
				}

				return responsesBody;
			} else {
				// Use regular chat completions format
				if (stream) {
					requestBody.stream_options = {
						include_usage: true,
					};
				}
				if (response_format) {
					requestBody.response_format = response_format;
				}

				// Add optional parameters if they are provided
				if (effectiveTemperature !== undefined) {
					requestBody.temperature = effectiveTemperature;
				}
				if (max_tokens !== undefined) {
					requestBody.max_tokens = max_tokens;
				}
				if (top_p !== undefined) {
					requestBody.top_p = top_p;
				}
				if (frequency_penalty !== undefined) {
					requestBody.frequency_penalty = frequency_penalty;
				}
				if (presence_penalty !== undefined) {
					requestBody.presence_penalty = presence_penalty;
				}
				if (reasoning_effort !== undefined) {
					requestBody.reasoning_effort = reasoning_effort;
				}
			}
			break;
		}
		case "xai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "novita":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "zai":
		case "custom": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			if (reasoning_effort !== undefined) {
				requestBody.reasoning_effort = reasoning_effort;
			}
			break;
		}
		case "anthropic": {
			// Remove generic tool_choice that was added earlier
			delete requestBody.tool_choice;

			// Set max_tokens, ensuring it's higher than thinking budget when reasoning is enabled
			const getThinkingBudget = (effort?: string) => {
				if (!supportsReasoning) {
					return 0;
				}
				if (!reasoning_effort) {
					return 0;
				}
				switch (effort) {
					case "low":
						return 1024; // Anthropic minimum
					case "high":
						return 4000;
					default:
						return 2000; // medium or undefined
				}
			};
			const thinkingBudget = getThinkingBudget(reasoning_effort);
			const minMaxTokens = Math.max(1024, thinkingBudget + 1000);
			requestBody.max_tokens = max_tokens ?? minMaxTokens;
			requestBody.messages = await transformAnthropicMessages(
				messages.map((m) => ({
					...m, // Preserve original properties for transformation
					role:
						m.role === "assistant"
							? "assistant"
							: m.role === "system"
								? "user"
								: m.role === "tool"
									? "user" // Tool results become user messages in Anthropic
									: "user",
					content: m.content,
					tool_calls: m.tool_calls, // Include tool_calls for transformation
				})),
				isProd,
			);

			// Transform tools from OpenAI format to Anthropic format
			if (tools && tools.length > 0) {
				requestBody.tools = tools.map((tool: any) => ({
					name: tool.function.name,
					description: tool.function.description,
					input_schema: tool.function.parameters,
				}));
			}

			// Handle tool_choice parameter - transform OpenAI format to Anthropic format
			if (tool_choice) {
				if (
					typeof tool_choice === "object" &&
					tool_choice.type === "function"
				) {
					// Transform OpenAI format to Anthropic format
					requestBody.tool_choice = {
						type: "tool",
						name: tool_choice.function.name,
					};
				} else if (tool_choice === "auto") {
					// "auto" is the default behavior for Anthropic, omit it
					// Anthropic doesn't need explicit "auto" tool_choice
				} else if (tool_choice === "none") {
					// "none" should work as-is
					requestBody.tool_choice = tool_choice;
				} else {
					// Other string values (though not standard)
					requestBody.tool_choice = tool_choice;
				}
			}

			// Enable thinking for reasoning-capable Anthropic models when reasoning_effort is specified
			if (supportsReasoning && reasoning_effort) {
				requestBody.thinking = {
					type: "enabled",
					budget_tokens: thinkingBudget,
				};
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
		case "google-vertex":
		case "google-ai-studio": {
			delete requestBody.model; // Not used in body
			delete requestBody.stream; // Stream is handled via URL parameter
			delete requestBody.messages; // Not used in body for Google providers
			delete requestBody.tool_choice; // Google doesn't support tool_choice parameter

			requestBody.contents = await transformGoogleMessages(messages, isProd);

			// Transform tools from OpenAI format to Google format
			if (tools && tools.length > 0) {
				requestBody.tools = [
					{
						functionDeclarations: tools.map((tool: any) => ({
							name: tool.function.name,
							description: tool.function.description,
							parameters: tool.function.parameters,
						})),
					},
				];
			}

			requestBody.generationConfig = {};

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.generationConfig.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.generationConfig.maxOutputTokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.generationConfig.topP = top_p;
			}

			// Enable thinking/reasoning content exposure for Google models that support reasoning
			if (supportsReasoning) {
				requestBody.generationConfig.thinkingConfig = {
					includeThoughts: true,
				};
			}

			break;
		}
		case "inference.net":
		case "together.ai": {
			if (usedModel.startsWith(`${usedProvider}/`)) {
				requestBody.model = usedModel.substring(usedProvider.length + 1);
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
	}

	return requestBody;
}

/**
 * Get the endpoint URL for a provider API call
 */
export function getProviderEndpoint(
	provider: ProviderId,
	baseUrl?: string,
	model?: string,
	token?: string,
	stream?: boolean,
	supportsReasoning?: boolean,
): string {
	let modelName = model;
	if (model && model !== "custom") {
		const modelInfo = models.find((m) => m.id === model);
		if (modelInfo) {
			const providerMapping = modelInfo.providers.find(
				(p) => p.providerId === provider,
			);
			if (providerMapping) {
				modelName = providerMapping.modelName;
			}
		}
	}
	let url: string;

	if (baseUrl) {
		url = baseUrl;
	} else {
		switch (provider) {
			case "llmgateway":
				if (model === "custom" || model === "auto") {
					// For custom model, use a default URL for testing
					url = "https://api.openai.com";
				} else {
					throw new Error(`Provider ${provider} requires a baseUrl`);
				}
				break;
			case "openai":
				url = "https://api.openai.com";
				break;
			case "anthropic":
				url = "https://api.anthropic.com";
				break;
			case "google-vertex":
			case "google-ai-studio":
				url = "https://generativelanguage.googleapis.com";
				break;
			case "inference.net":
				url = "https://api.inference.net";
				break;
			case "together.ai":
				url = "https://api.together.ai";
				break;
			case "cloudrift":
				url = "https://inference.cloudrift.ai";
				break;
			case "mistral":
				url = "https://api.mistral.ai";
				break;
			case "xai":
				url = "https://api.x.ai";
				break;
			case "groq":
				url = "https://api.groq.com/openai";
				break;
			case "deepseek":
				url = "https://api.deepseek.com";
				break;
			case "perplexity":
				url = "https://api.perplexity.ai";
				break;
			case "novita":
				url = "https://api.novita.ai/v3/openai";
				break;
			case "moonshot":
				url = "https://api.moonshot.ai";
				break;
			case "alibaba":
				url = "https://dashscope-intl.aliyuncs.com/compatible-mode";
				break;
			case "nebius":
				url = "https://api.studio.nebius.com";
				break;
			case "zai":
				url = "https://api.z.ai";
				break;
			case "custom":
				if (!baseUrl) {
					throw new Error(`Custom provider requires a baseUrl`);
				}
				url = baseUrl;
				break;
			default:
				throw new Error(`Provider ${provider} requires a baseUrl`);
		}
	}

	switch (provider) {
		case "anthropic":
			return `${url}/v1/messages`;
		case "google-vertex": {
			if (modelName) {
				const endpoint = stream ? "streamGenerateContent" : "generateContent";
				const baseEndpoint = `${url}/v1beta/models/${modelName}:${endpoint}`;
				return stream ? `${baseEndpoint}?alt=sse` : baseEndpoint;
			}
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const baseEndpoint = `${url}/v1beta/models/gemini-2.0-flash:${endpoint}`;
			return stream ? `${baseEndpoint}?alt=sse` : baseEndpoint;
		}
		case "google-ai-studio": {
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const baseEndpoint = modelName
				? `${url}/v1beta/models/${modelName}:${endpoint}`
				: `${url}/v1beta/models/gemini-2.0-flash:${endpoint}`;
			const queryParams = [];
			if (token) {
				queryParams.push(`key=${token}`);
			}
			if (stream) {
				queryParams.push("alt=sse");
			}
			return queryParams.length > 0
				? `${baseEndpoint}?${queryParams.join("&")}`
				: baseEndpoint;
		}
		case "perplexity":
			return `${url}/chat/completions`;
		case "novita":
			return `${url}/chat/completions`;
		case "zai":
			return `${url}/api/paas/v4/chat/completions`;
		case "openai":
			// Use responses endpoint for reasoning models (now supports tools)
			if (supportsReasoning) {
				return `${url}/v1/responses`;
			}
			return `${url}/v1/chat/completions`;
		case "inference.net":
		case "llmgateway":
		case "cloudrift":
		case "xai":
		case "groq":
		case "deepseek":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "custom":
		default:
			return `${url}/v1/chat/completions`;
	}
}

/**
 * Get the cheapest model for a given provider based on input + output pricing
 */
export function getCheapestModelForProvider(
	provider: ProviderId,
): string | null {
	const availableModels = models
		.filter((model) => model.providers.some((p) => p.providerId === provider))
		.filter((model) => !model.deprecatedAt || new Date() <= model.deprecatedAt)
		.map((model) => ({
			model: model.id,
			provider: model.providers.find((p) => p.providerId === provider)!,
		}))
		.filter(
			({ provider: providerInfo }) =>
				providerInfo.inputPrice !== undefined &&
				providerInfo.outputPrice !== undefined,
		);

	if (availableModels.length === 0) {
		return null;
	}

	let cheapestModel = availableModels[0].provider.modelName;
	let lowestPrice = Number.MAX_VALUE;

	for (const { provider: providerInfo } of availableModels) {
		const totalPrice =
			(providerInfo.inputPrice! + providerInfo.outputPrice!) / 2;
		if (totalPrice < lowestPrice) {
			lowestPrice = totalPrice;
			cheapestModel = providerInfo.modelName;
		}
	}

	return cheapestModel;
}

/**
 * Get the cheapest provider and model from a list of available model providers
 */
export function getCheapestFromAvailableProviders<
	T extends { providerId: string; modelName: string },
>(availableModelProviders: T[], modelWithPricing: any): T | null {
	if (availableModelProviders.length === 0) {
		return null;
	}

	let cheapestProvider = availableModelProviders[0];
	let lowestPrice = Number.MAX_VALUE;

	for (const provider of availableModelProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p: any) => p.providerId === provider.providerId,
		);
		const totalPrice =
			((providerInfo?.inputPrice || 0) + (providerInfo?.outputPrice || 0)) / 2;

		if (totalPrice < lowestPrice) {
			lowestPrice = totalPrice;
			cheapestProvider = provider;
		}
	}

	return cheapestProvider;
}

/**
 * Validate a provider API key by making a minimal request
 */
export async function validateProviderKey(
	provider: ProviderId,
	token: string,
	baseUrl?: string,
	skipValidation = false,
): Promise<{ valid: boolean; error?: string; statusCode?: number }> {
	// Skip validation if requested (e.g. in test environment)
	if (skipValidation) {
		return { valid: true };
	}

	// Skip validation for custom providers since they don't have predefined models
	if (provider === "custom") {
		return { valid: true };
	}

	try {
		const endpoint = getProviderEndpoint(
			provider,
			baseUrl,
			undefined,
			provider === "google-ai-studio" ? token : undefined,
			false, // validation doesn't need streaming
			false, // supportsReasoning - disable for validation
		);

		// Use prepareRequestBody to create the validation payload
		const systemMessage = {
			role: "system",
			content: "You are a helpful assistant.",
		};
		const minimalMessage = { role: "user", content: "Hello" };
		const messages = [systemMessage, minimalMessage];

		const validationModel = getCheapestModelForProvider(provider);

		console.log("using validationModel", provider, validationModel);

		if (!validationModel) {
			throw new Error(
				`No model with pricing information found for provider ${provider}`,
			);
		}

		// Find the model definition and check if max_tokens is supported
		const modelDef = models.find((m) =>
			m.providers.some(
				(p) => p.providerId === provider && p.modelName === validationModel,
			),
		);
		const providerMapping = modelDef?.providers.find(
			(p) => p.providerId === provider && p.modelName === validationModel,
		);
		const supportedParameters = (providerMapping as any)
			?.supportedParameters as string[] | undefined;
		const supportsMaxTokens =
			supportedParameters?.includes("max_tokens") ?? true;

		const payload = await prepareRequestBody(
			provider,
			validationModel,
			messages,
			false, // stream
			undefined, // temperature
			supportsMaxTokens ? 1 : undefined, // max_tokens - minimal for validation, undefined if not supported
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			false, // supportsReasoning - disable for validation
			false, // isProd - allow http URLs for validation/testing
		);

		const headers = getProviderHeaders(provider, token);
		headers["Content-Type"] = "application/json";

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `Error from provider: ${response.status} ${response.statusText}`;

			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message;
				} else if (errorJson.message) {
					errorMessage = errorJson.message;
				}
			} catch (_err) {}

			if (response.status === 401) {
				return {
					valid: false,
					statusCode: response.status,
				};
			}

			return { valid: false, error: errorMessage, statusCode: response.status };
		}

		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}
