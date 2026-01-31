import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { streamText, tool, type UIMessage, convertToModelMessages } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";

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

	// Block localhost and common local hostnames
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

	// Check if hostname is an IP address and validate against private ranges
	const ipValidation = validateIpAddress(hostname);
	if (ipValidation.isIp && !ipValidation.isPublic) {
		return {
			valid: false,
			error: `Blocked IP address: ${hostname}. Private/reserved IP ranges not allowed.`,
		};
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

/**
 * Debug logging utilities with PII redaction
 * Only logs when ENABLE_DEBUG_LOGS environment variable is set
 */
const isDebugEnabled = process.env.ENABLE_DEBUG_LOGS === "true";

/**
 * Redact potentially sensitive information from log messages
 * Removes API keys, tokens, user content, and other PII
 */
function redactPII(input: unknown): unknown {
	if (input === null || input === undefined) {
		return input;
	}

	if (typeof input === "string") {
		// Redact API keys and tokens (common patterns)
		let redacted = input
			.replace(/Bearer\s+[A-Za-z0-9_-]+/gi, "Bearer [REDACTED]")
			.replace(
				/api[_-]?key[=:]\s*["']?[A-Za-z0-9_-]+["']?/gi,
				"api_key=[REDACTED]",
			)
			.replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
			.replace(/key-[A-Za-z0-9_-]+/g, "key-[REDACTED]");

		// Truncate long strings that might contain user content
		if (redacted.length > 200) {
			redacted = redacted.slice(0, 200) + "...[TRUNCATED]";
		}

		return redacted;
	}

	if (input instanceof Error) {
		return {
			name: input.name,
			message: redactPII(input.message),
			stack: undefined, // Don't log stack traces which may contain sensitive paths
		};
	}

	if (Array.isArray(input)) {
		return input.slice(0, 5).map(redactPII); // Limit array length
	}

	if (typeof input === "object") {
		const redacted: Record<string, unknown> = {};
		const sensitiveKeys = [
			"apiKey",
			"api_key",
			"authorization",
			"token",
			"password",
			"secret",
			"content",
			"text",
			"arguments",
			"args",
		];

		for (const [key, value] of Object.entries(input)) {
			if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
				redacted[key] = "[REDACTED]";
			} else {
				redacted[key] = redactPII(value);
			}
		}
		return redacted;
	}

	return input;
}

/**
 * Debug logger that only logs when enabled and applies PII redaction
 * Console usage is intentional here as this is the centralized logging utility
 */

const debugLogger = {
	debug: (message: string, ...args: unknown[]) => {
		if (isDebugEnabled) {
			console.debug(
				`[MCP Debug] ${redactPII(message)}`,
				...args.map(redactPII),
			);
		}
	},
	info: (message: string, ...args: unknown[]) => {
		if (isDebugEnabled) {
			console.info(`[MCP Info] ${redactPII(message)}`, ...args.map(redactPII));
		}
	},
	warn: (message: string, ...args: unknown[]) => {
		if (isDebugEnabled) {
			console.warn(`[MCP Warn] ${redactPII(message)}`, ...args.map(redactPII));
		}
	},
	error: (message: string, ...args: unknown[]) => {
		if (isDebugEnabled) {
			console.error(
				`[MCP Error] ${redactPII(message)}`,
				...args.map(redactPII),
			);
		}
	},
};

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
				// SSRF Protection: Validate URL before creating transport
				const urlValidation = validateMcpServerUrl(server.url);
				if (!urlValidation.valid) {
					debugLogger.error(
						`SSRF Protection: Blocked MCP server "${server.name}": ${urlValidation.error}`,
					);
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
			} catch (error) {
				debugLogger.error(
					`Failed to connect to MCP server "${server.name}"`,
					error,
				);
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
					.map((c) => c.text);
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
					// Cast to McpToolDefinition - the MCP client returns tools with description and execute
					const originalTool = mcpTool as McpToolDefinition;

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
				debugLogger.error(
					`Failed to get tools from MCP server "${name}"`,
					error,
				);
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
						debugLogger.error("Failed to close MCP client", error);
					}
				}
			},
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
			sendSources: true,
		});
	} catch (error: unknown) {
		// Clean up MCP clients on error
		for (const { client } of mcpClients) {
			try {
				await client.close();
			} catch (closeError) {
				debugLogger.error("Failed to close MCP client", closeError);
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
