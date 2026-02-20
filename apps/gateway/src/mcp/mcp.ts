import fs from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { logger } from "@llmgateway/logger";
import {
	models as modelsList,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { OpenAPIHono } from "@hono/zod-openapi";
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
		.default("qwen-image-plus")
		.describe(
			'Image generation model to use (e.g., "qwen-image-plus", "qwen-image-max")',
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
function createMcpServer(apiKey: string): McpServer {
	const server = new McpServer({
		name: "llmgateway",
		version: "1.0.0",
	});

	// Register the chat tool
	server.tool(
		"chat",
		"Generate TEXT responses using a language model. Use this for text-based tasks like answering questions, writing, analysis, coding, explanations, etc. Do NOT use this for image generation - use the 'generate-image' tool instead when the user wants to create, draw, or generate images.",
		chatInputSchema.shape,
		async (input: ChatInput) => {
			try {
				// Call the internal chat completions endpoint
				const gatewayUrl =
					process.env.MCP_GATEWAY_URL ??
					(process.env.NODE_ENV === "production"
						? "https://api.llmgateway.io"
						: "http://localhost:4001");

				const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
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
				logger.error(
					"MCP chat tool error",
					error instanceof Error ? error : new Error(String(error)),
				);
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
							responseText += `  - Context: ${model.context_length.toLocaleString()} tokens\n`;
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
				logger.error(
					"MCP list-models tool error",
					error instanceof Error ? error : new Error(String(error)),
				);
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
				const gatewayUrl =
					process.env.MCP_GATEWAY_URL ??
					(process.env.NODE_ENV === "production"
						? "https://api.llmgateway.io"
						: "http://localhost:4001");

				// Call the chat completions endpoint with image generation model
				const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
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
							// Parse data URL: data:image/png;base64,<data>
							const matches = url.match(/^data:([^;]+);base64,(.+)$/);
							if (matches) {
								contentBlocks.push({
									type: "image" as const,
									data: matches[2],
									mimeType: matches[1],
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
				logger.error(
					"MCP generate-image tool error",
					error instanceof Error ? error : new Error(String(error)),
				);
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
		`Generate an image using Gemini 3 Pro Image Preview (Nano Banana). Tailored for AI coding agents - always returns an inline image preview.${process.env.UPLOAD_DIR ? " Also saves images to disk and returns file paths." : " Set UPLOAD_DIR to enable saving images to disk."}`,
		generateNanoBananaInputSchema.shape,
		async (input: GenerateNanoBananaInput) => {
			try {
				const gatewayUrl =
					process.env.MCP_GATEWAY_URL ??
					(process.env.NODE_ENV === "production"
						? "https://api.llmgateway.io"
						: "http://localhost:4001");

				const body: Record<string, unknown> = {
					model: "gemini-3-pro-image-preview",
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
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
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

				const uploadDir = process.env.UPLOAD_DIR;
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
					| { baseName: string; fileExt: string | undefined }
					| undefined;
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

					const matches = url.match(/^data:([^;]+);base64,(.+)$/);
					if (!matches) {
						continue;
					}

					const mimeType = matches[1];
					const base64Data = matches[2];

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
				logger.error(
					"MCP generate-nano-banana tool error",
					error instanceof Error ? error : new Error(String(error)),
				);
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
						modelData.requestPrice > 0
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
				responseText += `  model: "qwen-image-plus",\n`;
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
				logger.error(
					"MCP list-image-models tool error",
					error instanceof Error ? error : new Error(String(error)),
				);
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

/**
 * Extract API key from request headers
 */
function extractApiKey(c: Context): string | null {
	const auth = c.req.header("Authorization");
	if (auth) {
		const parts = auth.split("Bearer ");
		if (parts.length === 2 && parts[1]) {
			return parts[1];
		}
	}

	const xApiKey = c.req.header("x-api-key");
	if (xApiKey) {
		return xApiKey;
	}

	return null;
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
	} finally {
		await client.close();
	}
}

// Store active SSE connections for message routing
const sseConnections = new Map<
	string,
	{
		controller: ReadableStreamDefaultController;
		apiKey: string;
	}
>();

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

	logger.debug("MCP request received", {
		method,
		url: c.req.url,
		headers: {
			accept: c.req.header("Accept"),
			contentType: c.req.header("Content-Type"),
			authorization: c.req.header("Authorization") ? "[REDACTED]" : undefined,
		},
	});

	// Handle OPTIONS for CORS
	if (method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers":
					"Content-Type, Authorization, x-api-key, mcp-session-id",
				"Access-Control-Expose-Headers": "mcp-session-id",
			},
		});
	}

	// Extract API key for authentication
	const apiKey = extractApiKey(c);
	if (!apiKey) {
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
					"LLM Gateway MCP Server - Access multiple LLM providers through a unified API",
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
		const requestUrl = new URL(c.req.url);
		const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
		const mcpEndpointUrl = `${baseUrl}/mcp`;

		// SSE endpoint for server-to-client messages
		const stream = new ReadableStream({
			start(controller) {
				// Store the connection with apiKey for ownership validation
				sseConnections.set(sessionId!, { controller, apiKey });

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
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers":
					"Content-Type, Authorization, x-api-key, mcp-session-id",
				"mcp-session-id": sessionId,
			},
		});
	}

	if (method === "POST") {
		const server = createMcpServer(apiKey);
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
						sendSseEvent(validSseConnection.controller, "message", response);
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
				sendSseEvent(validSseConnection.controller, "message", response);
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

			logger.error(
				"MCP request error",
				error instanceof Error ? error : new Error(String(error)),
			);
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
		// Session termination
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

/**
 * OAuth2 metadata for MCP authentication
 * This implements the OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * to allow Claude Code to authenticate via OAuth instead of custom headers
 */
function getOAuthMetadata(baseUrl: string) {
	return {
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/oauth/authorize`,
		token_endpoint: `${baseUrl}/oauth/token`,
		registration_endpoint: `${baseUrl}/oauth/register`,
		response_types_supported: ["code"],
		grant_types_supported: [
			"authorization_code",
			"client_credentials",
			"refresh_token",
		],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: [
			"client_secret_basic",
			"client_secret_post",
		],
		scopes_supported: ["mcp:tools", "mcp:resources", "mcp:prompts"],
	};
}

/**
 * OAuth authorization endpoint handler
 * For MCP, we use a simplified flow where the API key IS the authorization
 */
async function oauthAuthorizeHandler(c: Context): Promise<Response> {
	const url = new URL(c.req.url);
	const clientId = url.searchParams.get("client_id");
	const redirectUri = url.searchParams.get("redirect_uri");
	const state = url.searchParams.get("state");
	const codeChallenge = url.searchParams.get("code_challenge");
	const codeChallengeMethod = url.searchParams.get("code_challenge_method");

	if (!clientId || !redirectUri) {
		return c.json(
			{
				error: "invalid_request",
				error_description: "Missing client_id or redirect_uri",
			},
			400,
		);
	}

	// Validate redirect_uri against registered client
	// This MUST happen before generating any auth code to prevent code leakage
	const registeredClient = getRegisteredClient(clientId);
	if (!registeredClient) {
		// Client not registered - reject the request
		// Do NOT redirect to the unverified redirect_uri
		return c.json(
			{
				error: "invalid_client",
				error_description:
					"Client not registered. Please register the client first via /oauth/register",
			},
			401,
		);
	}

	if (registeredClient.redirectUris.length === 0) {
		// No redirect URIs registered - reject
		return c.json(
			{
				error: "invalid_request",
				error_description:
					"No redirect URIs registered for this client. Register redirect_uris via /oauth/register",
			},
			400,
		);
	}

	if (!isValidRedirectUri(redirectUri, registeredClient.redirectUris)) {
		// redirect_uri does not match any registered URI - reject
		// Do NOT redirect to the invalid URI or generate any code
		return c.json(
			{
				error: "invalid_redirect_uri",
				error_description:
					"The redirect_uri does not match any registered redirect URI for this client",
			},
			400,
		);
	}

	// For MCP OAuth, the client_id is the API key
	// Generate an authorization code that encodes the API key
	const authCode = Buffer.from(
		JSON.stringify({
			client_id: clientId,
			code_challenge: codeChallenge,
			code_challenge_method: codeChallengeMethod,
			created_at: Date.now(),
		}),
	).toString("base64url");

	// Store the auth code temporarily (in production, use Redis)
	authCodes.set(authCode, {
		clientId,
		codeChallenge,
		codeChallengeMethod,
		createdAt: Date.now(),
	});

	// Clean up old codes (older than 10 minutes)
	// eslint-disable-next-line no-mixed-operators
	const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
	for (const [code, data] of authCodes.entries()) {
		if (data.createdAt < tenMinutesAgo) {
			authCodes.delete(code);
		}
	}

	// Redirect back with the authorization code
	const redirectUrl = new URL(redirectUri);
	redirectUrl.searchParams.set("code", authCode);
	if (state) {
		redirectUrl.searchParams.set("state", state);
	}

	return c.redirect(redirectUrl.toString(), 302);
}

// Store auth codes temporarily (in production, use Redis with TTL)
const authCodes = new Map<
	string,
	{
		clientId: string;
		codeChallenge: string | null;
		codeChallengeMethod: string | null;
		createdAt: number;
	}
>();

// Store registered OAuth clients with their allowed redirect URIs
interface RegisteredClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	createdAt: number;
}

const registeredClients = new Map<string, RegisteredClient>();

/**
 * Validate redirect_uri against registered URIs for a client
 * Supports loopback addresses (127.0.0.1, [::1], localhost) with any port for native apps (RFC 8252)
 */
function isValidRedirectUri(
	redirectUri: string,
	registeredUris: string[],
): boolean {
	// Parse the redirect URI
	let parsedUri: URL;
	try {
		parsedUri = new URL(redirectUri);
	} catch {
		return false;
	}

	// Check for loopback addresses (RFC 8252 Section 7.3)
	// Native apps can use any port on loopback addresses
	const isLoopback =
		parsedUri.hostname === "127.0.0.1" ||
		parsedUri.hostname === "[::1]" ||
		parsedUri.hostname === "localhost";

	if (isLoopback && parsedUri.protocol === "http:") {
		// For loopback, check if any registered URI matches the loopback pattern (ignoring port)
		for (const registered of registeredUris) {
			try {
				const parsedRegistered = new URL(registered);
				const registeredIsLoopback =
					parsedRegistered.hostname === "127.0.0.1" ||
					parsedRegistered.hostname === "[::1]" ||
					parsedRegistered.hostname === "localhost";

				if (
					registeredIsLoopback &&
					parsedRegistered.protocol === parsedUri.protocol &&
					parsedRegistered.pathname === parsedUri.pathname
				) {
					// Loopback match - port can differ per RFC 8252
					return true;
				}
			} catch {
				continue;
			}
		}
	}

	// For non-loopback URIs, require exact match
	return registeredUris.includes(redirectUri);
}

/**
 * Get a registered client by client_id
 */
function getRegisteredClient(clientId: string): RegisteredClient | undefined {
	return registeredClients.get(clientId);
}

/**
 * Verify PKCE code_verifier against code_challenge
 */
async function verifyPkce(
	codeVerifier: string,
	codeChallenge: string,
	method: string,
): Promise<boolean> {
	if (method !== "S256") {
		return false;
	}

	// SHA256 hash the verifier and base64url encode it
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = new Uint8Array(hashBuffer);
	const hashBase64 = Buffer.from(hashArray)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");

	return hashBase64 === codeChallenge;
}

/**
 * OAuth token endpoint handler
 * Supports both authorization_code and client_credentials grants
 */
async function oauthTokenHandler(c: Context): Promise<Response> {
	let grantType: string | null = null;
	let code: string | null = null;
	let codeVerifier: string | null = null;
	let clientId: string | null = null;
	let clientSecret: string | null = null;

	// Parse request body (can be form-urlencoded or JSON)
	const contentType = c.req.header("Content-Type") ?? "";

	if (contentType.includes("application/x-www-form-urlencoded")) {
		const formData = await c.req.parseBody();
		grantType = formData["grant_type"] as string;
		code = formData["code"] as string;
		codeVerifier = formData["code_verifier"] as string;
		clientId = formData["client_id"] as string;
		clientSecret = formData["client_secret"] as string;
	} else if (contentType.includes("application/json")) {
		const body = await c.req.json();
		grantType = body.grant_type;
		code = body.code;
		codeVerifier = body.code_verifier;
		clientId = body.client_id;
		clientSecret = body.client_secret;
	}

	// Also check Basic auth header for client credentials
	const authHeader = c.req.header("Authorization");
	if (authHeader?.startsWith("Basic ")) {
		const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
		const [basicClientId, basicClientSecret] = decoded.split(":");
		clientId ??= basicClientId ?? null;
		clientSecret ??= basicClientSecret ?? null;
	}

	if (!grantType) {
		return c.json(
			{
				error: "invalid_request",
				error_description: "Missing grant_type",
			},
			400,
		);
	}

	// Handle authorization_code grant
	if (grantType === "authorization_code") {
		if (!code) {
			return c.json(
				{
					error: "invalid_request",
					error_description: "Missing authorization code",
				},
				400,
			);
		}

		const authCodeData = authCodes.get(code);
		if (!authCodeData) {
			return c.json(
				{
					error: "invalid_grant",
					error_description: "Invalid or expired authorization code",
				},
				400,
			);
		}

		// Check TTL: reject if code has expired (10 minutes)
		const codeAgeMs = Date.now() - authCodeData.createdAt;
		const maxCodeAgeMs = 10 * 60 * 1000; // 10 minutes
		if (codeAgeMs > maxCodeAgeMs) {
			// Delete expired code to prevent replay attempts
			authCodes.delete(code);
			return c.json(
				{
					error: "invalid_grant",
					error_description: "Authorization code has expired",
				},
				400,
			);
		}

		// Verify client identity: the requesting client must match the original client
		if (clientId && clientId !== authCodeData.clientId) {
			return c.json(
				{
					error: "invalid_grant",
					error_description:
						"Client ID does not match the original authorization request",
				},
				400,
			);
		}

		// Verify PKCE if code_challenge was provided during authorization
		if (authCodeData.codeChallenge && authCodeData.codeChallengeMethod) {
			if (!codeVerifier) {
				return c.json(
					{
						error: "invalid_request",
						error_description: "Missing code_verifier",
					},
					400,
				);
			}

			const pkceValid = await verifyPkce(
				codeVerifier,
				authCodeData.codeChallenge,
				authCodeData.codeChallengeMethod,
			);

			if (!pkceValid) {
				return c.json(
					{
						error: "invalid_grant",
						error_description: "Invalid code_verifier",
					},
					400,
				);
			}
		}

		// Delete the used code
		authCodes.delete(code);

		// The client_id is the API key - use it as the access token
		const accessToken = authCodeData.clientId;

		return c.json({
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: 3600,
			scope: "mcp:tools mcp:resources mcp:prompts",
		});
	}

	// Handle client_credentials grant
	if (grantType === "client_credentials") {
		// For client_credentials, the client_secret IS the API key
		const apiKey = clientSecret ?? clientId;

		if (!apiKey) {
			return c.json(
				{
					error: "invalid_client",
					error_description:
						"Missing client credentials. Provide API key as client_secret.",
				},
				401,
			);
		}

		// Return the API key as the access token
		return c.json({
			access_token: apiKey,
			token_type: "Bearer",
			expires_in: 3600,
			scope: "mcp:tools mcp:resources mcp:prompts",
		});
	}

	return c.json(
		{
			error: "unsupported_grant_type",
			error_description: `Grant type '${grantType}' is not supported`,
		},
		400,
	);
}

/**
 * OAuth client registration endpoint (Dynamic Client Registration - RFC 7591)
 * This allows clients to register and receive their client_id
 */
async function oauthRegisterHandler(c: Context): Promise<Response> {
	try {
		const body = await c.req.json();

		// For MCP, the client provides their API key during registration
		// We use the API key as the client_id
		const clientName = body.client_name ?? "mcp-client";
		const redirectUris = body.redirect_uris ?? [];

		// Check if an API key was provided (either in body or header)
		let apiKey = body.api_key;
		if (!apiKey) {
			const authHeader = c.req.header("Authorization");
			if (authHeader?.startsWith("Bearer ")) {
				apiKey = authHeader.slice(7);
			}
		}

		if (!apiKey) {
			// Generate a placeholder client_id - the user will need to configure their actual API key
			// This allows the OAuth flow to start, and the API key can be provided later
			return c.json(
				{
					error: "invalid_request",
					error_description:
						"API key required. Provide your LLM Gateway API key in the request body as 'api_key' or in Authorization header.",
				},
				400,
			);
		}

		// Validate redirect_uris if provided
		const validatedRedirectUris: string[] = [];
		if (Array.isArray(redirectUris)) {
			for (const uri of redirectUris) {
				if (typeof uri !== "string") {
					continue;
				}
				try {
					const parsedUri = new URL(uri);
					// Only allow http for loopback, https for everything else
					const isLoopback =
						parsedUri.hostname === "127.0.0.1" ||
						parsedUri.hostname === "[::1]" ||
						parsedUri.hostname === "localhost";

					if (isLoopback && parsedUri.protocol === "http:") {
						validatedRedirectUris.push(uri);
					} else if (parsedUri.protocol === "https:") {
						validatedRedirectUris.push(uri);
					}
					// Skip invalid URIs (non-https, non-loopback)
				} catch {
					// Skip invalid URIs
				}
			}
		}

		// Store the client registration
		registeredClients.set(apiKey, {
			clientId: apiKey,
			clientName,
			redirectUris: validatedRedirectUris,
			createdAt: Date.now(),
		});

		// Clean up old client registrations (older than 30 days)
		// eslint-disable-next-line no-mixed-operators
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		for (const [id, client] of registeredClients.entries()) {
			if (client.createdAt < thirtyDaysAgo) {
				registeredClients.delete(id);
			}
		}

		// Return registration response with API key as client_id
		return c.json(
			{
				client_id: apiKey,
				client_secret: apiKey, // Same as client_id for our simplified flow
				client_name: clientName,
				redirect_uris: validatedRedirectUris,
				grant_types: ["authorization_code", "client_credentials"],
				response_types: ["code"],
				token_endpoint_auth_method: "client_secret_basic",
			},
			201,
		);
	} catch (error) {
		logger.error(
			"OAuth registration error",
			error instanceof Error ? error : new Error(String(error)),
		);
		return c.json(
			{
				error: "invalid_request",
				error_description: "Invalid request body",
			},
			400,
		);
	}
}

/**
 * OAuth metadata endpoint handler
 */
function oauthMetadataHandler(c: Context): Response {
	const url = new URL(c.req.url);
	const baseUrl = `${url.protocol}//${url.host}`;
	return c.json(getOAuthMetadata(baseUrl));
}

/**
 * Register MCP OAuth routes on the Hono app
 * This adds the OAuth endpoints required for Claude Code authentication
 */
export function registerMcpOAuthRoutes(app: OpenAPIHono<ServerTypes>): void {
	// OAuth 2.0 Authorization Server Metadata (RFC 8414)
	app.get("/.well-known/oauth-authorization-server", oauthMetadataHandler);

	// Also serve at the MCP-relative path
	app.get("/.well-known/oauth-authorization-server/mcp", oauthMetadataHandler);

	// OAuth endpoints
	app.get("/oauth/authorize", oauthAuthorizeHandler);
	app.post("/oauth/token", oauthTokenHandler);
	app.post("/oauth/register", oauthRegisterHandler);
}
