// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { streamText, type UIMessage, convertToModelMessages } from "ai";
import { cookies } from "next/headers";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";
// import type { experimental_MCPClient } from "ai";

export const maxDuration = 300; // 5 minutes

interface ChatRequestBody {
	messages: UIMessage[];
	model?: LLMGatewayChatModelId;
	apiKey?: string;
	provider?: string; // optional provider override
	mode?: "image" | "chat"; // optional hint to force image generation path
}

// let githubMCP: experimental_MCPClient | null = null;
// let tools: any | null = null;

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = await req.json();
	const { messages, model, apiKey, provider }: ChatRequestBody = body;

	// if (!githubMCP) {
	// 	const transport = new StreamableHTTPClientTransport(
	// 		new URL("https://api.githubcopilot.com/mcp"),
	// 		{
	// 			requestInit: {
	// 				method: "POST",
	// 				headers: {
	// 					Authorization: `Bearer ${githubToken}`,
	// 				},
	// 			},
	// 		},
	// 	);
	// 	githubMCP = await experimental_createMCPClient({ transport });
	// 	if (!tools) {
	// 		tools = await githubMCP.tools();
	// 	}
	// }

	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;

	// Prefer explicit apiKey or header, else read from httpOnly cookie set by backend.
	// Accept both api.llmgateway cookie and current-domain cookie for local dev.
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
		},
	});
	let selectedModel = (model ?? headerModel ?? "auto") as LLMGatewayChatModelId;
	if (provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}` as LLMGatewayChatModelId;
		}
	}

	try {
		// Default streaming chat path
		const result = streamText({
			model: llmgateway.chat(selectedModel),
			messages: convertToModelMessages(messages),
			// tools,
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
		});
	} catch {
		return new Response(
			JSON.stringify({ error: "LLM Gateway request failed" }),
			{
				status: 500,
			},
		);
	}
}
