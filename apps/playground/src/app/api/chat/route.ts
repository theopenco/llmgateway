import {
	streamText,
	type UIMessage,
	convertToModelMessages,
	stepCountIs,
} from "ai";
import { cookies } from "next/headers";

import { getUser } from "@/lib/getUser";
import { getGithubMcpTools } from "@/lib/mcp/github";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";

export const maxDuration = 300; // 5 minutes

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
			| "3:4"
			| "4:3"
			| "3:2"
			| "2:3"
			| "5:4"
			| "4:5"
			| "21:9";
		image_size?: "1K" | "2K" | "4K";
	};
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = await req.json();
	const { messages, model, apiKey, provider, image_config }: ChatRequestBody =
		body;

	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;
	const githubTokenHeader = req.headers.get("x-github-token") || undefined;
	const githubTokenBody = (body as any)?.githubToken || undefined;
	const reasoningEffort = (body as any)?.reasoning_effort || undefined;

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
		const tokenForMcp = githubTokenHeader || githubTokenBody;
		if (tokenForMcp) {
			const { tools, client: githubMCPClient } = await getGithubMcpTools(
				tokenForMcp as string,
			);

			const result = streamText({
				model: llmgateway.chat(selectedModel),
				messages: convertToModelMessages(messages),
				tools,
				...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
				...(image_config ? { image_config } : {}),
				stopWhen: stepCountIs(10),
				onFinish: async () => {
					if (githubMCPClient) {
						await githubMCPClient.close();
					}
				},
			});

			return result.toUIMessageStreamResponse({
				sendReasoning: true,
				sendSources: true,
			});
		}

		// Default streaming chat path (no tools)
		const result = streamText({
			model: llmgateway.chat(selectedModel),
			messages: convertToModelMessages(messages),
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
			...(image_config ? { image_config } : {}),
		});

		return result.toUIMessageStreamResponse({ sendReasoning: true });
	} catch (error: any) {
		const message = error.message || "LLM Gateway request failed";
		const status = error.status || 500;
		return new Response(JSON.stringify({ error: message, details: error }), {
			status,
		});
	}
}
