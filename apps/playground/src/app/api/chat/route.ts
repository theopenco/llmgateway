import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { streamText, tool, type UIMessage, convertToModelMessages } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";

export const maxDuration = 300; // 5 minutes

interface McpServerConfig {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	enabled: boolean;
}

interface ChatRequestBody {
	messages: UIMessage[];
	model?: LLMGatewayChatModelId;
	apiKey?: string;
	provider?: string; // optional provider override
	mode?: "image" | "chat"; // optional hint to force image generation path
	image_config?: {
		aspect_ratio?:
			| "auto"
			| "1:1"
			| "9:16"
			| "16:9"
			| "3:4"
			| "4:3"
			| "3:2"
			| "2:3"
			| "5:4"
			| "4:5"
			| "21:9";
		image_size?: "1K" | "2K" | "4K" | string; // string for Alibaba WIDTHxHEIGHT format
	};
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
	web_search?: boolean;
	mcp_servers?: McpServerConfig[];
}

interface McpClientWrapper {
	client: Awaited<ReturnType<typeof createMCPClient>>;
	name: string;
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = await req.json();
	const {
		messages,
		model,
		apiKey,
		provider,
		image_config,
		reasoning_effort,
		web_search,
		mcp_servers,
	}: ChatRequestBody = body;

	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;
	const noFallbackHeader = req.headers.get("x-no-fallback") || undefined;

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value ||
		cookieStore.get("__Host-llmgateway_playground_key")?.value;
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ||
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseUrl: gatewayUrl,
		headers: {
			"x-source": "chat.llmgateway.io",
			...(noFallbackHeader ? { "x-no-fallback": noFallbackHeader } : {}),
		},
		extraBody: {
			...(reasoning_effort ? { reasoning_effort } : {}),
			...(image_config ? { image_config } : {}),
			...(web_search ? { web_search } : {}),
		},
	});

	// Respect root model IDs passed from the client without adding a provider prefix.
	// Only apply provider-based prefixing when the client did NOT explicitly specify a model
	// (i.e. we're using a header/default model value).
	let selectedModel = (model ?? headerModel ?? "auto") as LLMGatewayChatModelId;
	if (!model && provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}` as LLMGatewayChatModelId;
		}
	}

	// Initialize MCP clients if servers are provided
	const mcpClients: McpClientWrapper[] = [];
	const enabledMcpServers =
		mcp_servers?.filter((server) => server.enabled) || [];

	try {
		// Create MCP clients for each enabled server (with timeout)
		for (const server of enabledMcpServers) {
			try {
				// Use the official MCP SDK transport for better compatibility
				const transport = new StreamableHTTPClientTransport(
					new URL(server.url),
					{
						requestInit: {
							headers: server.apiKey
								? { Authorization: `Bearer ${server.apiKey}` }
								: undefined,
						},
					},
				);

				const clientPromise = createMCPClient({ transport });

				// Add 10 second timeout to prevent hanging
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(
						() =>
							reject(new Error(`MCP connection timeout for ${server.name}`)),
						10000,
					);
				});

				const client = await Promise.race([clientPromise, timeoutPromise]);
				mcpClients.push({ client, name: server.name });
			} catch (error) {
				console.error(
					`Failed to connect to MCP server "${server.name}":`,
					error,
				);
				// Continue with other servers
			}
		}

		// Collect tools from all MCP clients and create typed wrappers
		const allTools: Record<string, any> = {};

		// Helper to extract text from MCP result format
		const extractMcpResult = (result: any): string => {
			if (
				result &&
				typeof result === "object" &&
				"content" in result &&
				Array.isArray(result.content)
			) {
				const textParts = result.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text);
				return textParts.join("\n");
			}
			return typeof result === "string" ? result : JSON.stringify(result);
		};

		for (const { client, name } of mcpClients) {
			try {
				const mcpTools = await client.tools();

				for (const [toolName, mcpTool] of Object.entries(mcpTools)) {
					const prefixedName =
						mcpClients.length > 1 ? `${name}_${toolName}` : toolName;
					const originalTool = mcpTool as any;

					// Create typed tool wrappers with explicit schemas
					// This ensures the LLM knows exactly what parameters are required
					if (toolName === "list-models") {
						allTools[prefixedName] = tool({
							description:
								originalTool.description ||
								"List all available LLM models with their capabilities and pricing",
							inputSchema: z.object({
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
									.describe("Maximum number of models to return"),
								family: z
									.string()
									.optional()
									.describe(
										"Filter by model family (e.g., 'openai', 'anthropic')",
									),
							}),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const extracted = extractMcpResult(result);
								return { data: extracted };
							},
						});
					} else if (toolName === "chat") {
						allTools[prefixedName] = tool({
							description:
								"Send a message to another LLM and get a response. REQUIRED: You MUST provide 'model' (e.g., 'gpt-4o-mini') and 'messages' array with at least one message object containing 'role' and 'content'.",
							inputSchema: z.object({
								model: z
									.string()
									.describe(
										"REQUIRED: The model ID to use, e.g., 'gpt-4o-mini', 'claude-sonnet-4-20250514'",
									),
								messages: z
									.array(
										z.object({
											role: z
												.enum(["user", "assistant", "system"])
												.describe("The role: 'user', 'assistant', or 'system'"),
											content: z.string().describe("The message text content"),
										}),
									)
									.min(1)
									.describe(
										"REQUIRED: Array of message objects, each with 'role' and 'content'",
									),
								temperature: z
									.number()
									.min(0)
									.max(2)
									.optional()
									.describe("Optional: Sampling temperature (0-2)"),
								max_tokens: z
									.number()
									.positive()
									.optional()
									.describe("Optional: Maximum tokens to generate"),
							}),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const extracted = extractMcpResult(result);
								return { response: extracted };
							},
						});
					} else {
						// For unknown tools, use a permissive schema
						allTools[prefixedName] = tool({
							description:
								originalTool.description || `MCP tool: ${prefixedName}`,
							inputSchema: z.object({}).passthrough(),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const extracted = extractMcpResult(result);
								return { result: extracted };
							},
						});
					}
				}
			} catch (error) {
				console.error(`Failed to get tools from MCP server "${name}":`, error);
			}
		}

		const hasTools = Object.keys(allTools).length > 0;

		// Streaming chat with optional MCP tools
		const result = streamText({
			model: llmgateway.chat(selectedModel),
			messages: await convertToModelMessages(messages),
			...(hasTools ? { tools: allTools, maxSteps: 10 } : {}),
			onFinish: async () => {
				// Clean up MCP clients when streaming is done
				for (const { client } of mcpClients) {
					try {
						await client.close();
					} catch (error) {
						console.error("Failed to close MCP client:", error);
					}
				}
			},
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
			sendSources: true,
		});
	} catch (error: any) {
		// Clean up MCP clients on error
		for (const { client } of mcpClients) {
			try {
				await client.close();
			} catch (closeError) {
				console.error("Failed to close MCP client:", closeError);
			}
		}

		const message = error.message || "LLM Gateway request failed";
		const status = error.status || 500;
		return new Response(JSON.stringify({ error: message, details: error }), {
			status,
		});
	}
}
