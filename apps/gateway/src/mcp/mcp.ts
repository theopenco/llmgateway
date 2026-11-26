import fs from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	LATEST_PROTOCOL_VERSION,
	McpError,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	assertApiKeyWithinUsageLimits,
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { isZeroDataRetentionEnabled } from "@/lib/compliance.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import { getAuthenticatedReadAccess } from "@/lib/gateway-read-access.js";
import { internalPrincipalHeaders } from "@/lib/internal-principal-headers.js";
import {
	isMcpBearerTokenActive,
	resolveMcpBearerToken,
	resolveRequestBaseUrl,
} from "@/mcp/oauth.js";
import { getMcpGatewayUrl } from "@/mcp/request-url.js";
import { registerUsageTools } from "@/mcp/usage-tools.js";
import { isAllowedOrigin, parseAllowedOrigins } from "@/middleware/cors.js";

import { parseDataUrl } from "@llmgateway/actions";
import { logger, toError } from "@llmgateway/logger";
import {
	models as modelsList,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { ApiKey } from "@llmgateway/db";
import type { Context } from "hono";

// Define Zod schemas for MCP tool inputs
const chatInputSchema = z.object({
	model: z
		.string()
		.describe(
			'The language model ID to use for text generation (e.g., "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.0-flash")',
		),
	messages: z
		.array(
			z.object({
				role: z.enum(["user", "assistant", "system"]).describe("Message role"),
				content: z.string().describe("Message content"),
			}),
		)
		.describe("Array of messages in the conversation for text generation"),
	temperature: z
		.number()
		.min(0)
		.max(2)
		.optional()
		.describe("Sampling temperature (0-2)"),
	max_tokens: z
		.number()
		.positive()
		.optional()
		.describe("Maximum tokens to generate"),
	stream: z
		.boolean()
		.optional()
		.default(false)
		.describe("Whether to stream the response (not supported in MCP)"),
});

const listModelsInputSchema = z.object({
	include_deactivated: z
		.boolean()
		.optional()
		.default(false)
		.describe("Include deactivated models"),
	exclude_deprecated: z
		.boolean()
		.optional()
		.default(false)
		.describe("Exclude deprecated models"),
	limit: z
		.number()
		.optional()
		.default(20)
		.describe("Maximum number of models to return (default 20)"),
	family: z
		.string()
		.optional()
		.describe("Filter by model family (e.g., 'openai', 'anthropic', 'google')"),
});

const generateImageInputSchema = z.object({
	prompt: z
		.string()
		.describe(
			"Detailed text description of the image to create, e.g. 'a futuristic city skyline at sunset with flying cars'",
		),
	model: z
		.string()
		.optional()
		.default("qwen-image-3.0")
		.describe(
			'Image generation model to use (e.g., "qwen-image-3.0", "qwen-image-3.0-pro")',
		),
	size: z
		.string()
		.optional()
		.default("1024x1024")
		.describe(
			'Image size in WxH format (e.g., "1024x1024", "1024x768", "768x1024")',
		),
	n: z
		.number()
		.min(1)
		.max(4)
		.optional()
		.default(1)
		.describe("Number of images to generate (1-4)"),
});

const listImageModelsInputSchema = z.object({});

const generateNanoBananaInputSchema = z.object({
	prompt: z
		.string()
		.describe(
			"Detailed text description of the image to create, e.g. 'a futuristic city skyline at sunset with flying cars'",
		),
	filename: z
		.string()
		.optional()
		.describe(
			"Filename for the saved image (no path separators allowed). Auto-generated if not provided (e.g., nano-banana-1234567890.png). Images are only saved to disk when the server has UPLOAD_DIR configured.",
		),
	aspect_ratio: z
		.enum(["1:1", "16:9", "4:3", "5:4"])
		.optional()
		.describe("Aspect ratio for the generated image."),
});

type ChatInput = z.infer<typeof chatInputSchema>;
type ListModelsInput = z.infer<typeof listModelsInputSchema>;
type GenerateImageInput = z.infer<typeof generateImageInputSchema>;
type ListImageModelsInput = z.infer<typeof listImageModelsInputSchema>;
type GenerateNanoBananaInput = z.infer<typeof generateNanoBananaInputSchema>;

/**
 * Creates an MCP server instance with tools for LLM Gateway
 */
function createMcpServer(
	apiKey: string,
	apiKeyRecord: ApiKey,
	clientHeaders: Record<string, string>,
	zeroDataRetentionEnabled: boolean,
): McpServer {
	const server = new McpServer({
		name: "llmgateway",
		version: "1.0.0",
	});
	registerUsageTools(server, apiKey, clientHeaders);
	const generationHeaders = {
		...clientHeaders,
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
	};

	async function assertGenerationAllowed() {
		const project = await findProjectById(apiKeyRecord.projectId);
		if (project) {
			await assertMemberWithinBudget(
				apiKeyRecord.createdBy,
				project.organizationId,
			);
		}
		assertApiKeyWithinUsageLimits(apiKeyRecord);
	}

	// Register the chat tool
	server.tool(
		"chat",
		"Generate TEXT responses using a language model. Use this for text-based tasks like answering questions, writing, analysis, coding, explanations, etc. Do NOT use this for image generation - use the 'generate-image' tool instead when the user wants to create, draw, or generate images.",
		chatInputSchema.shape,
		async (input: ChatInput) => {
			try {
				await assertGenerationAllowed();
				// Call the internal chat completions endpoint
				const gatewayUrl = getMcpGatewayUrl();

				const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
					method: "POST",
					redirect: "error",
					headers: generationHeaders,
					body: JSON.stringify({
						model: input.model,
						messages: input.messages,
						temperature: input.temperature,
						max_tokens: input.max_tokens,
						stream: false, // MCP doesn't support streaming
					}),
				});

				if (!response.ok) {
					const errorText = await response.text();
					let errorMessage: string;
					try {
						const errorJson = JSON.parse(errorText);
						errorMessage = errorJson.message ?? errorJson.error ?? errorText;
					} catch {
						errorMessage = errorText;
					}
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: ${response.status} - ${errorMessage}`,
							},
						],
						isError: true,
					};
				}

				const data = await response.json();

				// Extract the assistant's response
				const assistantMessage =
					data.choices?.[0]?.message?.content ?? "No response";
				const usage = data.usage;

				let responseText = assistantMessage;

				// Add usage information if available
				if (usage) {
					responseText += `\n\n---\nTokens: ${usage.prompt_tokens} prompt, ${usage.completion_tokens} completion, ${usage.total_tokens} total`;
				}

				return {
					content: [
						{
							type: "text" as const,
							text: responseText,
						},
					],
				};
			} catch (error) {
				logger.error("MCP chat tool error", toError(error));
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// Register the list-models tool
	server.tool(
		"list-models",
		"List all available LLM models with their capabilities and pricing",
		listModelsInputSchema.shape,
		async (input: ListModelsInput) => {
			try {
				const includeDeactivated = input.include_deactivated || false;
				const excludeDeprecated = input.exclude_deprecated || false;
				const limit = input.limit ?? 20;
				const familyFilter = input.family?.toLowerCase();
				const currentDate = new Date();

				// Filter models based on deactivation and deprecation status
				let filteredModels = modelsList.filter((model: ModelDefinition) => {
					const allDeactivated = model.providers.every(
						(provider) =>
							(provider as ProviderModelMapping).deactivatedAt &&
							currentDate > (provider as ProviderModelMapping).deactivatedAt!,
					);

					if (!includeDeactivated && allDeactivated) {
						return false;
					}

					const allDeprecated = model.providers.every(
						(provider) =>
							(provider as ProviderModelMapping).deprecatedAt &&
							currentDate > (provider as ProviderModelMapping).deprecatedAt!,
					);

					if (excludeDeprecated && allDeprecated) {
						return false;
					}

					return true;
				});

				// Apply family filter if specified
				if (familyFilter) {
					filteredModels = filteredModels.filter(
						(model: ModelDefinition) =>
							model.family?.toLowerCase() === familyFilter,
					);
				}

				// Apply limit
				filteredModels = filteredModels.slice(0, limit);

				// Format models for display
				const modelData = filteredModels.map((model: ModelDefinition) => {
					const firstProviderWithPricing = model.providers.find(
						(p: ProviderModelMapping) =>
							p.inputPrice !== undefined || p.outputPrice !== undefined,
					);

					const inputPrice =
						firstProviderWithPricing?.inputPrice?.toString() ?? "0";
					const outputPrice =
						firstProviderWithPricing?.outputPrice?.toString() ?? "0";

					// Check capabilities
					const hasVision = model.providers.some((p) => p.vision);
					const hasTools = model.providers.some((p) => p.tools);
					const hasReasoning = model.providers.some((p) => p.reasoning);
					const hasStreaming = model.providers.some((p) => p.streaming);
					const hasImageGeneration = model.providers.some(
						(p) => (p as ProviderModelMapping).imageGenerations,
					);

					const providerIds = [
						...new Set(model.providers.map((p) => p.providerId)),
					];

					return {
						id: model.id,
						name: model.name ?? model.id,
						family: model.family,
						providers: providerIds,
						capabilities: {
							vision: hasVision,
							tools: hasTools,
							reasoning: hasReasoning,
							streaming: hasStreaming,
							imageGeneration: hasImageGeneration,
						},
						pricing: {
							input: `$${inputPrice}/1M tokens`,
							output: `$${outputPrice}/1M tokens`,
						},
						context_length:
							Math.max(...model.providers.map((p) => p.contextSize ?? 0)) ??
							undefined,
						free: model.free ?? false,
					};
				});

				// Format as readable text
				const totalCount = modelsList.length;
				let responseText = `# Available Models (showing ${modelData.length} of ${totalCount})\n\n`;
				if (familyFilter) {
					responseText = `# ${familyFilter.charAt(0).toUpperCase() + familyFilter.slice(1)} Models (showing ${modelData.length})\n\n`;
				}

				// Group by family
				const byFamily = modelData.reduce(
					(acc, model) => {
						const family = model.family || "other";
						if (!acc[family]) {
							acc[family] = [];
						}
						acc[family].push(model);
						return acc;
					},
					{} as Record<string, typeof modelData>,
				);

				for (const [family, models] of Object.entries(byFamily)) {
					responseText += `## ${family}\n\n`;
					for (const model of models) {
						const capabilities = [];
						if (model.capabilities.vision) {
							capabilities.push("vision");
						}
						if (model.capabilities.tools) {
							capabilities.push("tools");
						}
						if (model.capabilities.reasoning) {
							capabilities.push("reasoning");
						}
						if (model.capabilities.streaming) {
							capabilities.push("streaming");
						}
						if (model.capabilities.imageGeneration) {
							capabilities.push("image-generation");
						}

						responseText += `**${model.id}**`;
						if (model.free) {
							responseText += " (FREE)";
						}
						responseText += "\n";
						responseText += `  - Providers: ${model.providers.join(", ")}\n`;
						responseText += `  - Pricing: ${model.pricing.input} input, ${model.pricing.output} output\n`;
						if (model.context_length) {
							responseText += `  - Context: ${formatNumber(model.context_length)} tokens\n`;
						}
						if (capabilities.length > 0) {
							responseText += `  - Capabilities: ${capabilities.join(", ")}\n`;
						}
						responseText += "\n";
					}
				}

				return {
					content: [
						{
							type: "text" as const,
							text: responseText,
						},
						{
							type: "text" as const,
							text: `<!--STRUCTURED_DATA:${JSON.stringify({ type: "models", data: modelData })}-->`,
						},
					],
				};
			} catch (error) {
				logger.error("MCP list-models tool error", toError(error));
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// Register the generate-image tool
	server.tool(
		"generate-image",
		"CREATE AND GENERATE IMAGES from text descriptions. Use this tool whenever the user wants to create, draw, generate, make, or produce an image, picture, illustration, artwork, or visual content. This is the ONLY tool for image generation - do not use the 'chat' tool for images.",
		generateImageInputSchema.shape,
		async (input: GenerateImageInput) => {
			try {
				await assertGenerationAllowed();
				const gatewayUrl = getMcpGatewayUrl();

				// Call the chat completions endpoint with image generation model
				const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
					method: "POST",
					redirect: "error",
					headers: generationHeaders,
					body: JSON.stringify({
						model: input.model,
						messages: [
							{
								role: "user",
								content: input.prompt,
							},
						],
						stream: false,
						image_config: {
							image_size: input.size,
							n: input.n,
						},
					}),
				});

				if (!response.ok) {
					const errorText = await response.text();
					let errorMessage: string;
					try {
						const errorJson = JSON.parse(errorText);
						errorMessage = errorJson.message ?? errorJson.error ?? errorText;
					} catch {
						errorMessage = errorText;
					}
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: ${response.status} - ${errorMessage}`,
							},
						],
						isError: true,
					};
				}

				const data = await response.json();

				// Extract images from the response
				const message = data.choices?.[0]?.message;
				const images = message?.images ?? [];

				if (images.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									message?.content ??
									"No images generated. The model may not support image generation.",
							},
						],
					};
				}

				// Build MCP response with images
				const contentBlocks: Array<
					| { type: "text"; text: string }
					| { type: "image"; data: string; mimeType: string }
				> = [];

				// Add text description if present
				if (message?.content) {
					contentBlocks.push({
						type: "text" as const,
						text: message.content,
					});
				}

				// Add each image as an MCP image content block
				for (const image of images) {
					if (image.type === "image_url" && image.image_url?.url) {
						const url = image.image_url.url;

						// Check if it's a base64 data URL
						if (url.startsWith("data:")) {
							const parsed = parseDataUrl(url);
							if (parsed && parsed.isBase64 && parsed.data) {
								contentBlocks.push({
									type: "image" as const,
									data: parsed.data,
									mimeType: parsed.mediaType,
								});
							}
						} else {
							// External URL - return as text with link
							contentBlocks.push({
								type: "text" as const,
								text: `Image URL: ${url}`,
							});
						}
					}
				}

				// If no images were successfully extracted, provide feedback
				if (contentBlocks.length === 0) {
					contentBlocks.push({
						type: "text" as const,
						text: "Images were generated but could not be extracted. Please check the model response.",
					});
				}

				return {
					content: contentBlocks,
				};
			} catch (error) {
				logger.error("MCP generate-image tool error", toError(error));
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// Register the generate-nano-banana tool
	server.tool(
		"generate-nano-banana",
		`Generate an image using Gemini 3 Pro Image (Nano Banana Pro). Tailored for AI coding agents - always returns an inline image preview.${zeroDataRetentionEnabled ? "" : process.env.UPLOAD_DIR ? " Also saves images to disk and returns file paths." : " Set UPLOAD_DIR to enable saving images to disk."}`,
		generateNanoBananaInputSchema.shape,
		async (input: GenerateNanoBananaInput) => {
			try {
				await assertGenerationAllowed();
				const gatewayUrl = getMcpGatewayUrl();

				const body: Record<string, unknown> = {
					model: "gemini-3-pro-image",
					messages: [
						{
							role: "user",
							content: input.prompt,
						},
					],
					stream: false,
				};

				if (input.aspect_ratio) {
					body.image_config = { aspect_ratio: input.aspect_ratio };
				}

				const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
					method: "POST",
					headers: generationHeaders,
					body: JSON.stringify(body),
					redirect: "error",
				});

				if (!response.ok) {
					const errorText = await response.text();
					let errorMessage: string;
					try {
						const errorJson = JSON.parse(errorText);
						errorMessage = errorJson.message ?? errorJson.error ?? errorText;
					} catch {
						errorMessage = errorText;
					}
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: ${response.status} - ${errorMessage}`,
							},
						],
						isError: true,
					};
				}

				const data = await response.json();
				const message = data.choices?.[0]?.message;
				const images = message?.images ?? [];

				if (images.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									message?.content ??
									"No images generated. The model may not have produced an image for this prompt.",
							},
						],
					};
				}

				const uploadDir = zeroDataRetentionEnabled
					? undefined
					: process.env.UPLOAD_DIR;
				const contentBlocks: Array<
					| { type: "text"; text: string }
					| { type: "image"; data: string; mimeType: string }
				> = [];

				if (message?.content) {
					contentBlocks.push({
						type: "text" as const,
						text: message.content,
					});
				}

				const savedPaths: string[] = [];

				const extMap: Record<string, string> = {
					"image/png": ".png",
					"image/jpeg": ".jpeg",
					"image/jpg": ".jpg",
					"image/webp": ".webp",
					"image/gif": ".gif",
				};

				const resolvedUploadDir = uploadDir
					? path.resolve(uploadDir)
					: undefined;

				let parsedFilename:
					{ baseName: string; fileExt: string | undefined } | undefined;
				if (resolvedUploadDir && input.filename) {
					const rawName = input.filename;
					if (
						rawName.includes("/") ||
						rawName.includes("\\") ||
						/^[a-zA-Z]:/.test(rawName)
					) {
						return {
							content: [
								{
									type: "text" as const,
									text: "Invalid filename: must not contain path separators or drive letters.",
								},
							],
							isError: true,
						};
					}
					const parsed = path.parse(rawName);
					parsedFilename = {
						baseName: parsed.name,
						fileExt: parsed.ext || undefined,
					};
				}

				if (resolvedUploadDir) {
					await fs.mkdir(resolvedUploadDir, { recursive: true });
				}

				for (let i = 0; i < images.length; i++) {
					const image = images[i];
					if (image.type !== "image_url" || !image.image_url?.url) {
						continue;
					}

					const url = image.image_url.url;
					if (!url.startsWith("data:")) {
						contentBlocks.push({
							type: "text" as const,
							text: `Image URL: ${url}`,
						});
						continue;
					}

					const parsed = parseDataUrl(url);
					if (!parsed || !parsed.isBase64 || !parsed.data) {
						continue;
					}

					const mimeType = parsed.mediaType;
					const base64Data = parsed.data;

					const ext = extMap[mimeType] || ".png";

					if (resolvedUploadDir) {
						let fileName: string;
						if (parsedFilename) {
							const fileExt = parsedFilename.fileExt ?? ext;
							fileName =
								images.length > 1
									? `${parsedFilename.baseName}-${i + 1}${fileExt}`
									: `${parsedFilename.baseName}${fileExt}`;
						} else {
							const timestamp = Date.now();
							fileName =
								images.length > 1
									? `nano-banana-${timestamp}-${i + 1}${ext}`
									: `nano-banana-${timestamp}${ext}`;
						}

						const filePath = path.join(resolvedUploadDir, fileName);

						if (
							!filePath.startsWith(resolvedUploadDir + path.sep) &&
							filePath !== resolvedUploadDir
						) {
							return {
								content: [
									{
										type: "text" as const,
										text: "Invalid filename: resolved path escapes the upload directory.",
									},
								],
								isError: true,
							};
						}

						await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));
						savedPaths.push(filePath);
					}

					contentBlocks.push({
						type: "image" as const,
						data: base64Data,
						mimeType,
					});
				}

				if (savedPaths.length > 0) {
					const pathList = savedPaths.map((p) => `- ${p}`).join("\n");
					contentBlocks.unshift({
						type: "text" as const,
						text: `Image${savedPaths.length > 1 ? "s" : ""} saved to:\n${pathList}`,
					});
				}

				return {
					content: contentBlocks,
				};
			} catch (error) {
				logger.error("MCP generate-nano-banana tool error", toError(error));
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// Register the list-image-models tool
	server.tool(
		"list-image-models",
		"List all available image generation models with their capabilities and pricing. Use these models with the generate-image tool.",
		listImageModelsInputSchema.shape,
		async (_input: ListImageModelsInput) => {
			try {
				// Filter models to only those with image generation capability
				const imageModels = modelsList.filter((model: ModelDefinition) => {
					return model.providers.some(
						(p) => (p as ProviderModelMapping).imageGenerations === true,
					);
				});

				if (imageModels.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "No image generation models are currently available.",
							},
						],
					};
				}

				// Build structured data for image models
				const imageModelData = imageModels.map((model: ModelDefinition) => {
					const imageProvider = model.providers.find(
						(p) => (p as ProviderModelMapping).imageGenerations === true,
					) as ProviderModelMapping | undefined;

					return {
						id: model.id,
						name: model.name ?? model.id,
						description: model.description,
						family: model.family,
						requestPrice: imageProvider?.requestPrice,
						providers: [...new Set(model.providers.map((p) => p.providerId))],
					};
				});

				let responseText = `# Image Generation Models\n\n`;
				responseText += `Found ${imageModels.length} model(s) that support image generation.\n\n`;

				for (const modelData of imageModelData) {
					responseText += `## ${modelData.name}\n`;
					responseText += `- **Model ID:** \`${modelData.id}\`\n`;
					if (modelData.description) {
						responseText += `- **Description:** ${modelData.description}\n`;
					}
					responseText += `- **Family:** ${modelData.family}\n`;
					if (
						modelData.requestPrice !== undefined &&
						Number(modelData.requestPrice) > 0
					) {
						responseText += `- **Price:** $${modelData.requestPrice} per request\n`;
					}
					responseText += "\n";
				}

				responseText += `\n## Usage\n`;
				responseText += `Use the \`generate-image\` tool with any of these model IDs.\n\n`;
				responseText += `Example:\n`;
				responseText += `\`\`\`\n`;
				responseText += `generate-image(\n`;
				responseText += `  prompt: "A serene mountain landscape at sunset",\n`;
				responseText += `  model: "qwen-image-3.0",\n`;
				responseText += `  size: "1024x1024"\n`;
				responseText += `)\n`;
				responseText += `\`\`\`\n`;

				return {
					content: [
						{
							type: "text" as const,
							text: responseText,
						},
						{
							type: "text" as const,
							text: `<!--STRUCTURED_DATA:${JSON.stringify({ type: "image-models", data: imageModelData })}-->`,
						},
					],
				};
			} catch (error) {
				logger.error("MCP list-image-models tool error", toError(error));
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}

// JSON-RPC types
// Note: id is optional for notifications (methods starting with "notifications/")
interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

// Zod schemas for JSON-RPC request validation
// Note: id is optional for notifications (methods starting with "notifications/")
const jsonRpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	method: z.string().min(1),
	params: z.unknown().optional(),
});

const jsonRpcBatchRequestSchema = z.array(jsonRpcRequestSchema).min(1);

const jsonRpcPayloadSchema = z.union([
	jsonRpcRequestSchema,
	jsonRpcBatchRequestSchema,
]);

/**
 * Validate JSON-RPC request payload and return typed result or error response
 */
function validateJsonRpcPayload(body: unknown):
	| {
			success: true;
			data: JsonRpcRequest | JsonRpcRequest[];
	  }
	| {
			success: false;
			error: JsonRpcResponse;
	  } {
	const result = jsonRpcPayloadSchema.safeParse(body);
	if (!result.success) {
		// JSON-RPC error code -32600 = Invalid Request
		return {
			success: false,
			error: {
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32600,
					message: "Invalid Request",
					data: result.error.issues.map((issue) => ({
						path: issue.path.join("."),
						message: issue.message,
					})),
				},
			},
		};
	}
	return { success: true, data: result.data };
}

/**
 * Process MCP request using in-memory transport
 */
async function processMcpRequest(
	server: McpServer,
	request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
	// Create in-memory transport pair
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();

	// Connect server to transport
	await server.connect(serverTransport);

	// Create a temporary client to send the request
	const client = new Client({
		name: "mcp-http-bridge",
		version: "1.0.0",
	});
	await client.connect(clientTransport);

	try {
		// Route the request to the appropriate method
		switch (request.method) {
			case "initialize": {
				// Initialize the connection - capabilities are returned in the response
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					result: {
						protocolVersion: "2024-11-05",
						capabilities: {
							tools: {},
						},
						serverInfo: {
							name: "llmgateway",
							version: "1.0.0",
						},
					},
				};
			}

			case "notifications/initialized": {
				// Client notification that initialization is complete - no response needed
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					result: {},
				};
			}

			case "tools/list": {
				const result = await client.listTools();
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					result,
				};
			}

			case "tools/call": {
				// Validate request.params exists and has a valid name
				if (!request.params || typeof request.params !== "object") {
					return {
						jsonrpc: "2.0",
						id: request.id ?? null,
						error: {
							code: -32602,
							message: "Invalid params: request.params is required",
						},
					};
				}
				const params = request.params as {
					name?: string;
					arguments?: Record<string, unknown>;
				};
				if (!params.name || typeof params.name !== "string") {
					return {
						jsonrpc: "2.0",
						id: request.id ?? null,
						error: {
							code: -32602,
							message:
								"Invalid params: 'name' is required and must be a string",
						},
					};
				}
				const result = await client.callTool({
					name: params.name,
					arguments: params.arguments ?? {},
				});
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					result,
				};
			}

			case "ping": {
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					result: {},
				};
			}

			default:
				return {
					jsonrpc: "2.0",
					id: request.id ?? null,
					error: {
						code: -32601,
						message: `Method not found: ${request.method}`,
					},
				};
		}
	} catch (error) {
		if (error instanceof McpError && error.code === -32001) {
			logger.warn("MCP request timeout", {
				message: error.message,
				data: error.data,
			});
			return {
				jsonrpc: "2.0",
				id: request.id ?? null,
				error: {
					code: error.code,
					message: "Request timed out",
					data: error.data,
				},
			};
		}
		throw error;
	} finally {
		await client.close();
	}
}

interface SseConnection {
	controller: ReadableStreamDefaultController;
	apiKey: string;
	// The credential that opened the stream; deliveries stop once it is revoked.
	bearerToken: string;
}

// Store active SSE connections for message routing
const sseConnections = new Map<string, SseConnection>();

/**
 * Delivers a message on a session's stream, or closes the stream when the
 * credential that opened it no longer stands for an active API key.
 */
async function deliverSseMessage(
	sessionId: string,
	connection: SseConnection,
	data: unknown,
): Promise<void> {
	if (
		!(await isMcpBearerTokenActive(connection.bearerToken, connection.apiKey))
	) {
		sseConnections.delete(sessionId);
		try {
			connection.controller.close();
		} catch (error) {
			// Already closed by the client.
			if (!(error instanceof TypeError)) {
				throw error;
			}
		}
		return;
	}
	sendSseEvent(connection.controller, "message", data);
}

/**
 * Send SSE event to a connection
 */
function sendSseEvent(
	controller: ReadableStreamDefaultController,
	event: string,
	data: unknown,
) {
	const encoder = new TextEncoder();
	controller.enqueue(encoder.encode(`event: ${event}\n`));
	controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

/**
 * MCP HTTP handler for Hono
 * Implements the Streamable HTTP transport for MCP with SSE support
 */
export async function mcpHandler(c: Context): Promise<Response> {
	const method = c.req.method;
	const accept = c.req.header("Accept") ?? "";
	const gatewayUrl = process.env.GATEWAY_URL ?? "https://api.llmgateway.io";
	const origin = c.req.header("Origin");
	const allowedOrigins = [
		...(URL.canParse(gatewayUrl) ? [new URL(gatewayUrl).origin] : []),
		process.env.UI_URL ?? "https://llmgateway.io",
		...parseAllowedOrigins(process.env.GATEWAY_CORS_ORIGINS),
	];
	if (origin && !isAllowedOrigin(allowedOrigins, origin)) {
		return c.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: -32000, message: "Origin not allowed" },
			},
			403,
		);
	}
	c.header("Cache-Control", "no-store");
	c.header("Vary", "Accept, Origin");
	const protocolVersion = c.req.header("MCP-Protocol-Version");
	if (
		protocolVersion &&
		!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)
	) {
		return c.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: -32600, message: "Unsupported MCP protocol version" },
			},
			400,
		);
	}

	if (
		(method === "GET" || method === "HEAD") &&
		!protocolVersion &&
		!accept.includes("text/event-stream")
	) {
		return c.json({
			name: "llmgateway",
			version: "1.0.0",
			description:
				"LLM Gateway MCP server: generation, model discovery, and usage analytics.",
			protocolVersion: LATEST_PROTOCOL_VERSION,
			transport: "streamable-http",
			endpoint: new URL("/mcp", gatewayUrl).href,
			documentation: "https://docs.llmgateway.io/developers/mcp",
			capabilities: { tools: {} },
		});
	}

	logger.debug("MCP request received", {
		method,
		url: c.req.url,
		headers: {
			accept: c.req.header("Accept"),
			contentType: c.req.header("Content-Type"),
			authorization: c.req.header("Authorization") ? "[REDACTED]" : undefined,
		},
	});

	// Extract the bearer credential: an API key, or an OAuth access token
	// standing for one.
	const bearerToken = parseApiToken(c);
	if (!bearerToken) {
		c.header(
			"WWW-Authenticate",
			`Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", gatewayUrl).href}"`,
		);
		return c.json(
			{
				jsonrpc: "2.0",
				error: {
					code: -32001,
					message:
						"Authentication required. Provide API key via Authorization header or x-api-key.",
				},
				id: null,
			},
			401,
		);
	}

	// Validate the API key against the database, mirroring the gateway's chat
	// endpoint. Without this, any arbitrary string was accepted as a valid key
	// (GHSA-8h26-h6v8-f9cg).
	const apiKey = await resolveMcpBearerToken(bearerToken);
	const apiKeyRecord = apiKey ? await findApiKeyByToken(apiKey) : undefined;
	if (
		!apiKey ||
		!apiKeyRecord ||
		apiKeyRecord.status !== "active" ||
		(apiKeyRecord.keyType === "user" &&
			apiKeyRecord.expiresAt &&
			apiKeyRecord.expiresAt <= new Date())
	) {
		c.header(
			"WWW-Authenticate",
			`Bearer error="invalid_token", resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", gatewayUrl).href}"`,
		);
		return c.json(
			{
				jsonrpc: "2.0",
				error: {
					code: -32001,
					message:
						"Invalid or inactive LLMGateway API key. Generate a new token on the 'API Keys' page.",
				},
				id: null,
			},
			401,
		);
	}

	let zeroDataRetentionEnabled = false;
	try {
		if (apiKeyRecord.keyType === "user" && !apiKeyRecord.endUserSession) {
			await getAuthenticatedReadAccess(c, apiKey);
		}
		const mcpProject = await findProjectById(apiKeyRecord.projectId);
		if (mcpProject) {
			const mcpOrganization = await findOrganizationById(
				mcpProject.organizationId,
			);
			zeroDataRetentionEnabled = isZeroDataRetentionEnabled(
				mcpOrganization,
				apiKeyRecord,
			);
			await assertMemberProjectAccess(apiKeyRecord, mcpProject.organizationId);
		}
	} catch (error) {
		// Preserve project-access denials as 403 rather than invalid-key errors.
		const status = error instanceof HTTPException ? error.status : 401;
		return c.json(
			{
				jsonrpc: "2.0",
				error: {
					code: -32001,
					message:
						error instanceof HTTPException
							? error.message
							: "LLMGateway API key cannot be used.",
				},
				id: null,
			},
			status,
		);
	}

	// Keep the legacy bridge for clients using the original HTTP+SSE protocol.
	const streamableHttp =
		Boolean(protocolVersion) ||
		(accept.includes("application/json") &&
			accept.includes("text/event-stream"));
	if (streamableHttp) {
		if (method !== "POST") {
			c.header("Allow", "POST");
			return c.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: {
						code: -32000,
						message: "This stateless MCP endpoint accepts POST messages.",
					},
				},
				405,
			);
		}
		const clientHeaders = internalPrincipalHeaders(c.req.raw.headers);
		for (const header of [
			"x-source",
			"user-agent",
			"http-referer",
			"x-title",
			"x-openrouter-title",
		]) {
			const value = c.req.header(header);
			if (value) {
				clientHeaders[header] = value;
			}
		}
		const server = createMcpServer(
			apiKey,
			apiKeyRecord,
			clientHeaders,
			zeroDataRetentionEnabled,
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		try {
			let parsedBody: unknown;
			try {
				parsedBody = await c.req.json();
			} catch (error) {
				if (!(error instanceof SyntaxError)) {
					throw error;
				}
				return c.json(
					{
						jsonrpc: "2.0",
						id: null,
						error: { code: -32700, message: "Invalid JSON" },
					},
					400,
				);
			}
			if (Array.isArray(parsedBody)) {
				return c.json(
					{
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32600,
							message: "Send one JSON-RPC message per request.",
						},
					},
					400,
				);
			}
			return await transport.handleRequest(c.req.raw, { parsedBody });
		} finally {
			await server.close();
		}
	}

	// Get or create session ID
	let sessionId = c.req.header("mcp-session-id");
	sessionId ??= crypto.randomUUID();

	if (method === "GET") {
		// Check if client wants SSE or just server info
		const acceptHeader = c.req.header("Accept") ?? "";
		const wantsSSE = acceptHeader.includes("text/event-stream");

		if (!wantsSSE) {
			// Return server information for discovery (non-SSE GET)
			return c.json({
				name: "llmgateway",
				version: "1.0.0",
				description:
					"LLM Gateway MCP Server - Generate text and images, inspect usage and costs, and rank models, providers and coding apps.",
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: {},
				},
			});
		}

		// Validate session ownership: if session exists with different apiKey, reject
		const existingConnection = sseConnections.get(sessionId);
		if (existingConnection && existingConnection.apiKey !== apiKey) {
			return c.json(
				{
					jsonrpc: "2.0",
					error: {
						code: -32001,
						message:
							"Session belongs to a different API key. Use a new session.",
					},
					id: null,
				},
				403,
			);
		}

		// Build absolute URL for the endpoint event
		const mcpEndpointUrl = `${resolveRequestBaseUrl(c)}/mcp`;

		// SSE endpoint for server-to-client messages
		const stream = new ReadableStream({
			start(controller) {
				// Store the connection with apiKey for ownership validation
				sseConnections.set(sessionId!, { controller, apiKey, bearerToken });

				// Send initial endpoint event with the absolute URL
				sendSseEvent(controller, "endpoint", mcpEndpointUrl);
			},
			cancel() {
				// Clean up on disconnect
				sseConnections.delete(sessionId!);
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"mcp-session-id": sessionId,
			},
		});
	}

	if (method === "POST") {
		const clientHeaders = internalPrincipalHeaders(c.req.raw.headers);
		for (const header of [
			"x-source",
			"user-agent",
			"http-referer",
			"x-title",
			"x-openrouter-title",
		]) {
			const value = c.req.header(header);
			if (value) {
				clientHeaders[header] = value;
			}
		}
		const server = createMcpServer(
			apiKey,
			apiKeyRecord,
			clientHeaders,
			zeroDataRetentionEnabled,
		);
		try {
			const rawBody = await c.req.json();

			// Validate JSON-RPC payload structure
			const validation = validateJsonRpcPayload(rawBody);
			if (!validation.success) {
				return c.json(validation.error, 400, {
					"mcp-session-id": sessionId,
				});
			}

			const body = validation.data;
			logger.debug("MCP POST request body", {
				method: Array.isArray(body) ? body.map((r) => r.method) : body.method,
			});

			// Check if there's an active SSE connection for this session
			const sseConnection = sseConnections.get(sessionId);

			// Validate session ownership: only use SSE connection if apiKey matches
			// This prevents cross-apiKey message delivery
			const validSseConnection =
				sseConnection && sseConnection.apiKey === apiKey ? sseConnection : null;

			// If client provided a sessionId that belongs to a different apiKey, reject
			if (sseConnection && sseConnection.apiKey !== apiKey) {
				logger.warn("Session ownership mismatch", {
					sessionId,
					requestApiKey: apiKey.slice(0, 8) + "...",
					sessionApiKey: sseConnection.apiKey.slice(0, 8) + "...",
				});
				return c.json(
					{
						jsonrpc: "2.0",
						error: {
							code: -32001,
							message:
								"Session belongs to a different API key. Use a new session.",
						},
						id: null,
					},
					403,
				);
			}

			// Handle batch requests
			if (Array.isArray(body)) {
				const responses: JsonRpcResponse[] = [];

				for (const request of body) {
					const response = await processMcpRequest(server, request);
					responses.push(response);

					// If valid SSE connection exists (same apiKey), also send via SSE
					if (validSseConnection) {
						await deliverSseMessage(sessionId, validSseConnection, response);
					}
				}

				return c.json(responses, 200, {
					"mcp-session-id": sessionId,
				});
			}

			// Handle single request
			const response = await processMcpRequest(server, body);

			// If valid SSE connection exists (same apiKey), also send via SSE
			if (validSseConnection) {
				await deliverSseMessage(sessionId, validSseConnection, response);
			}

			return c.json(response, 200, {
				"mcp-session-id": sessionId,
			});
		} catch (error) {
			// Check if this is a JSON parse error (-32700 Parse error)
			const isParseError =
				error instanceof SyntaxError ||
				(error instanceof Error &&
					error.message.toLowerCase().includes("json"));

			if (isParseError) {
				logger.warn("MCP JSON parse error", {
					error: error instanceof Error ? error.message : String(error),
				});
				return c.json(
					{
						jsonrpc: "2.0",
						error: {
							code: -32700,
							message: "Parse error: Invalid JSON",
						},
						id: null,
					},
					400,
				);
			}

			logger.error("MCP request error", toError(error));
			return c.json(
				{
					jsonrpc: "2.0",
					error: {
						code: -32603,
						message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
					},
					id: null,
				},
				500,
			);
		} finally {
			await server.close();
		}
	}

	if (method === "DELETE") {
		// Session termination uses the same owner boundary as reads and messages.
		const connection = sseConnections.get(sessionId);
		if (connection && connection.apiKey !== apiKey) {
			return c.json(
				{
					jsonrpc: "2.0",
					error: {
						code: -32001,
						message: "Session belongs to a different API key",
					},
					id: null,
				},
				403,
			);
		}
		sseConnections.delete(sessionId);
		return new Response(null, { status: 204 });
	}

	return c.json(
		{
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message: "Method not allowed",
			},
			id: null,
		},
		405,
	);
}
