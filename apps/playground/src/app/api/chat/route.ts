import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	streamText,
	tool,
	type UIMessage,
	convertToModelMessages,
	JsonToSseTransformStream,
} from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

export const maxDuration = 300; // 5 minutes

/**
 * MCP Content Types - Based on MCP SDK CallToolResult content types
 */
interface McpTextContent {
	type: "text";
	text: string;
}

interface McpImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

interface McpResourceContent {
	type: "resource";
	resource: {
		uri: string;
		text?: string;
		blob?: string;
		mimeType?: string;
	};
}

type McpContent = McpTextContent | McpImageContent | McpResourceContent;

interface McpCallToolResult {
	content: McpContent[];
	isError?: boolean;
}

/**
 * Type guard to check if a value is an MCP CallToolResult
 */
function isMcpCallToolResult(value: unknown): value is McpCallToolResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		Array.isArray((value as McpCallToolResult).content)
	);
}

/**
 * Type guard to check if an MCP content item is text content
 */
function isMcpTextContent(value: unknown): value is McpTextContent {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		(value as McpTextContent).type === "text" &&
		"text" in value &&
		typeof (value as McpTextContent).text === "string"
	);
}

/**
 * Type guard to check if an MCP content item is image content
 */
function isMcpImageContent(value: unknown): value is McpImageContent {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		(value as McpImageContent).type === "image" &&
		"data" in value &&
		typeof (value as McpImageContent).data === "string" &&
		"mimeType" in value &&
		typeof (value as McpImageContent).mimeType === "string"
	);
}

/**
 * MCP Tool type from client.tools() return value
 * The execute function is typed loosely to accommodate different MCP tool implementations
 */
interface McpToolDefinition {
	description?: string;
	execute: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * SSRF Protection: Validate MCP server URLs to prevent Server-Side Request Forgery
 * Blocks private/local addresses and validates against allowlist if configured
 */
function validateMcpServerUrl(urlString: string): {
	valid: boolean;
	error?: string;
	url?: URL;
} {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return { valid: false, error: "Invalid URL format" };
	}

	// Only allow HTTP(S) protocols
	if (!["http:", "https:"].includes(url.protocol)) {
		return {
			valid: false,
			error: `Invalid protocol: ${url.protocol}. Only HTTP(S) allowed.`,
		};
	}

	const hostname = url.hostname.toLowerCase();

	// Allow localhost in development mode
	const isDevelopment = process.env.NODE_ENV === "development";

	// Block localhost and common local hostnames (except in development)
	const blockedHostnames = [
		"localhost",
		"127.0.0.1",
		"0.0.0.0",
		"[::1]",
		"::1",
		"local",
		"internal",
		"intranet",
		"corp",
		"private",
	];

	if (!isDevelopment) {
		if (
			blockedHostnames.includes(hostname) ||
			hostname.endsWith(".local") ||
			hostname.endsWith(".localhost") ||
			hostname.endsWith(".internal")
		) {
			return {
				valid: false,
				error: `Blocked hostname: ${hostname}. Local/internal addresses not allowed.`,
			};
		}
	}

	// Check if hostname is an IP address and validate against private ranges (except in development)
	if (!isDevelopment) {
		const ipValidation = validateIpAddress(hostname);
		if (ipValidation.isIp && !ipValidation.isPublic) {
			return {
				valid: false,
				error: `Blocked IP address: ${hostname}. Private/reserved IP ranges not allowed.`,
			};
		}
	}

	// Optional: Check against allowlist if configured
	const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(",").map((h) =>
		h.trim().toLowerCase(),
	);
	if (allowedHosts && allowedHosts.length > 0) {
		const isAllowed = allowedHosts.some(
			(allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
		);
		if (!isAllowed) {
			return {
				valid: false,
				error: `Hostname ${hostname} not in allowlist`,
			};
		}
	}

	return { valid: true, url };
}

/**
 * Validate if a string is an IP address and check if it's in private/reserved ranges
 */
function validateIpAddress(hostname: string): {
	isIp: boolean;
	isPublic: boolean;
} {
	// IPv4 pattern
	const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
	const ipv4Match = hostname.match(ipv4Pattern);

	if (ipv4Match) {
		const octets = ipv4Match.slice(1, 5).map(Number);

		// Validate octet ranges
		if (octets.some((o) => o > 255)) {
			return { isIp: true, isPublic: false };
		}

		const [a, b, c] = octets;

		// Check private/reserved IPv4 ranges
		const isPrivate =
			a === 0 || // 0.0.0.0/8 - Current network
			a === 10 || // 10.0.0.0/8 - Private
			(a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 - Carrier-grade NAT
			a === 127 || // 127.0.0.0/8 - Loopback
			(a === 169 && b === 254) || // 169.254.0.0/16 - Link-local
			(a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 - Private
			(a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 - IETF Protocol
			(a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 - TEST-NET-1
			(a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 - 6to4 relay
			(a === 192 && b === 168) || // 192.168.0.0/16 - Private
			(a === 198 && b >= 18 && b <= 19) || // 198.18.0.0/15 - Benchmark
			(a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 - TEST-NET-2
			(a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 - TEST-NET-3
			a >= 224; // 224.0.0.0+ - Multicast and reserved

		return { isIp: true, isPublic: !isPrivate };
	}

	// IPv6 pattern (simplified - handles bracketed and non-bracketed)
	const ipv6Hostname = hostname.replace(/^\[|\]$/g, "");
	if (ipv6Hostname.includes(":")) {
		// Check common private/reserved IPv6 patterns
		const lowerIpv6 = ipv6Hostname.toLowerCase();
		const isPrivate =
			lowerIpv6 === "::1" || // Loopback
			lowerIpv6 === "::" || // Unspecified
			lowerIpv6.startsWith("fc") || // fc00::/7 - Unique local
			lowerIpv6.startsWith("fd") || // fc00::/7 - Unique local
			lowerIpv6.startsWith("fe80") || // fe80::/10 - Link-local
			lowerIpv6.startsWith("::ffff:127.") || // IPv4-mapped loopback
			lowerIpv6.startsWith("::ffff:10.") || // IPv4-mapped private
			lowerIpv6.startsWith("::ffff:192.168.") || // IPv4-mapped private
			lowerIpv6.startsWith("::ffff:172."); // IPv4-mapped private (partial check)

		return { isIp: true, isPublic: !isPrivate };
	}

	return { isIp: false, isPublic: true };
}

interface McpServerConfig {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	enabled: boolean;
}

interface ChatRequestBody {
	messages: UIMessage[];
	model?: string;
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

	const headerApiKey = req.headers.get("x-llmgateway-key") ?? undefined;
	const headerModel = req.headers.get("x-llmgateway-model") ?? undefined;
	const noFallbackHeader = req.headers.get("x-no-fallback") ?? undefined;

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value ??
		cookieStore.get("__Host-llmgateway_playground_key")?.value;
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "chat.llmgateway.io",
			...(noFallbackHeader ? { "x-no-fallback": noFallbackHeader } : {}),
		},
		extraBody: {
			reasoning_effort,
			image_config,
			web_search,
		},
	}) as any;

	// Respect root model IDs passed from the client without adding a provider prefix.
	// Only apply provider-based prefixing when the client did NOT explicitly specify a model
	// (i.e. we're using a header/default model value).
	let selectedModel = (model ?? headerModel ?? "auto") as string;
	if (!model && provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}`;
		}
	}

	// Initialize MCP clients if servers are provided
	const mcpClients: McpClientWrapper[] = [];
	const enabledMcpServers =
		mcp_servers?.filter((server) => server.enabled) ?? [];

	try {
		// Create MCP clients for each enabled server (with timeout)
		for (const server of enabledMcpServers) {
			try {
				// SSRF Protection: Validate URL before creating transport
				const urlValidation = validateMcpServerUrl(server.url);
				if (!urlValidation.valid) {
					continue; // Skip this server
				}

				// Use the official MCP SDK transport for better compatibility
				const transport = new StreamableHTTPClientTransport(
					urlValidation.url!,
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
			} catch {
				// Continue with other servers
			}
		}

		// Collect tools from all MCP clients and create typed wrappers
		// Type assertion needed to allow heterogeneous tool schemas in a single record
		const allTools: Record<string, ReturnType<typeof tool<any, any>>> = {};

		// Helper to extract text from MCP result format using type guards
		const extractMcpResult = (result: unknown): string => {
			if (isMcpCallToolResult(result)) {
				const textParts = result.content
					.filter(isMcpTextContent)
					.map((c) => c.text)
					// Filter out structured data comments
					.filter((text) => !text.startsWith("<!--STRUCTURED_DATA:"));
				return textParts.join("\n");
			}
			return typeof result === "string" ? result : JSON.stringify(result);
		};

		// Helper to extract structured data from MCP result (embedded as HTML comment)
		const extractStructuredData = (
			result: unknown,
		): { type: string; data: unknown } | null => {
			if (isMcpCallToolResult(result)) {
				for (const content of result.content) {
					if (isMcpTextContent(content)) {
						const match = content.text.match(
							/<!--STRUCTURED_DATA:([\s\S]+?)-->/,
						);
						if (match) {
							try {
								return JSON.parse(match[1]);
							} catch {
								return null;
							}
						}
					}
				}
			}
			return null;
		};

		// Helper to extract images from MCP result format
		// Returns array of image objects with base64 and mediaType for the Image component
		const extractMcpImages = (
			result: unknown,
		): { images: { base64: string; mediaType: string }[]; text: string } => {
			if (isMcpCallToolResult(result)) {
				const images = result.content
					.filter(isMcpImageContent)
					.map((c) => ({ base64: c.data, mediaType: c.mimeType }));
				const textParts = result.content
					.filter(isMcpTextContent)
					.map((c) => c.text);
				return { images, text: textParts.join("\n") };
			}
			return { images: [], text: extractMcpResult(result) };
		};

		for (const { client, name } of mcpClients) {
			try {
				const mcpTools = await client.tools();

				for (const [toolName, mcpTool] of Object.entries(mcpTools)) {
					const prefixedName =
						mcpClients.length > 1 ? `${name}_${toolName}` : toolName;
					// Cast to McpToolDefinition - the MCP client returns tools with description and execute
					const originalTool = mcpTool as McpToolDefinition;

					// Create typed tool wrappers with explicit schemas
					// This ensures the LLM knows exactly what parameters are required
					if (toolName === "list-models") {
						allTools[prefixedName] = tool({
							description:
								"List and discover available LLM models. Use this ONLY when the user asks to see what models are available, NOT when they want to actually use a model. For generating content or images, use the 'chat' tool instead.",
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
								const structured = extractStructuredData(result);
								return {
									text: extracted,
									...(structured?.type === "models"
										? { models: structured.data }
										: {}),
								};
							},
						});
					} else if (toolName === "chat") {
						// Chat tool - send a message to another LLM
						// Rename to "generate_content" for better model understanding
						const generateToolName =
							mcpClients.length > 1
								? `${name}_generate_content`
								: "generate_content";

						allTools[generateToolName] = tool({
							description:
								"Generate TEXT responses using a language model. Use this for text-based tasks like answering questions, writing, analysis, coding, etc. Do NOT use this for image generation - use 'generate-image' tool instead when the user wants to create, draw, or generate images.",
							inputSchema: z.object({
								model: z
									.string()
									.describe(
										"The language model ID to use for text generation, e.g. 'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.0-flash'",
									),
								prompt: z
									.string()
									.describe(
										"The text prompt for the language model, e.g. 'explain quantum physics' or 'write a poem about nature'",
									),
							}),
							execute: async (args) => {
								// Convert simple prompt to messages array format for the MCP tool
								const mcpArgs = {
									model: args.model,
									messages: [{ role: "user" as const, content: args.prompt }],
								};
								const result = await originalTool.execute(mcpArgs);
								const extracted = extractMcpResult(result);
								return { response: extracted };
							},
						});
					} else if (toolName === "generate-image") {
						// Generate image tool - requires prompt parameter
						allTools[prefixedName] = tool({
							description:
								"CREATE AND GENERATE IMAGES from text descriptions. Use this tool whenever the user wants to create, draw, generate, make, or produce an image, picture, illustration, artwork, or visual content. This is the ONLY tool for image generation - do not use generate_content for images.",
							inputSchema: z.object({
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
										"Image generation model to use (e.g., 'qwen-image-plus', 'qwen-image-max')",
									),
								size: z
									.string()
									.optional()
									.default("1024x1024")
									.describe(
										"Image size in WxH format (e.g., '1024x1024', '1024x768', '768x1024')",
									),
								n: z
									.number()
									.optional()
									.default(1)
									.describe("Number of images to generate (1-4)"),
							}),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const { images, text } = extractMcpImages(result);
								return { images, text };
							},
						});
					} else if (toolName === "list-image-models") {
						// List image models tool - no required parameters
						allTools[prefixedName] = tool({
							description:
								"List all available image generation models with their capabilities and pricing. Use this to discover which models can be used with generate-image.",
							inputSchema: z.object({}),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const extracted = extractMcpResult(result);
								const structured = extractStructuredData(result);
								return {
									text: extracted,
									...(structured?.type === "image-models"
										? { imageModels: structured.data }
										: {}),
								};
							},
						});
					} else {
						// For unknown tools, use a permissive schema
						allTools[prefixedName] = tool({
							description:
								originalTool.description ?? `MCP tool: ${prefixedName}`,
							inputSchema: z.object({}).passthrough(),
							execute: async (args) => {
								const result = await originalTool.execute(args);
								const extracted = extractMcpResult(result);
								return { result: extracted };
							},
						});
					}
				}
			} catch {
				// Failed to get tools from MCP server
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
					} catch {
						// Ignore close errors
					}
				}
			},
		});

		// Build the UI message stream and pipe through SSE formatting
		const uiStream = result.toUIMessageStream({
			sendReasoning: true,
			sendSources: true,
		});
		const sseStream = uiStream.pipeThrough(new JsonToSseTransformStream());

		// Add SSE keepalive comments (`: ping`) to prevent proxy/load balancer
		// timeouts on long-running requests (e.g. tool calls, reasoning).
		// Uses a push-based ReadableStream with setInterval so that pings are
		// flushed to the response independently of consumer backpressure.
		const KEEPALIVE_INTERVAL_MS = 15_000;
		const encoder = new TextEncoder();
		const reader = sseStream.getReader();

		const streamWithKeepalive = new ReadableStream<Uint8Array>({
			start(controller) {
				// Send a keepalive ping every KEEPALIVE_INTERVAL_MS.
				const keepaliveTimer = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(": ping\n\n"));
					} catch {
						// Stream already closed, clean up.
						clearInterval(keepaliveTimer);
					}
				}, KEEPALIVE_INTERVAL_MS);

				// Read upstream chunks in a loop and forward them.
				void (async () => {
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) {
								clearInterval(keepaliveTimer);
								controller.close();
								return;
							}
							controller.enqueue(encoder.encode(value));
						}
					} catch (err) {
						clearInterval(keepaliveTimer);
						controller.error(err);
					}
				})();
			},
			cancel() {
				void reader.cancel();
			},
		});

		return new Response(streamWithKeepalive, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"x-vercel-ai-ui-message-stream": "v1",
				"x-accel-buffering": "no",
			},
		});
	} catch (error: unknown) {
		// Clean up MCP clients on error
		for (const { client } of mcpClients) {
			try {
				await client.close();
			} catch {
				// Ignore close errors
			}
		}

		const message =
			error instanceof Error ? error.message : "LLM Gateway request failed";
		const status =
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			typeof (error as { status: unknown }).status === "number"
				? (error as { status: number }).status
				: 500;
		return new Response(JSON.stringify({ error: message }), {
			status,
		});
	}
}
