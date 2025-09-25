// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	streamText,
	type UIMessage,
	convertToModelMessages,
	// experimental_createMCPClient,
} from "ai";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";
// import type { experimental_MCPClient } from "ai";

export const maxDuration = 300; // 5 minutes

interface ChatRequestBody {
	messages: UIMessage[];
	model?: LLMGatewayChatModelId;
	apiKey?: string;
}

// let githubMCP: experimental_MCPClient | null = null;
// let tools: any | null = null;

export async function POST(req: Request) {
	const body = await req.json();
	const { messages, model, apiKey }: ChatRequestBody = body;

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

	const finalApiKey = apiKey ?? headerApiKey;
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
	});
	const selectedModel = (model ??
		headerModel ??
		"auto") as LLMGatewayChatModelId;

	try {
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
