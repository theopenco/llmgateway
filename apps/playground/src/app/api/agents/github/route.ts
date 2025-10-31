import { createAgentUIStreamResponse, ToolLoopAgent } from "ai";
import { cookies } from "next/headers";

import { getUser } from "@/lib/getUser";
import { getGithubMcpTools } from "@/lib/mcp/github";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

import type { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";

export const maxDuration = 300;

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
		provider,
	}: { messages: any[]; model?: LLMGatewayChatModelId; provider?: string } =
		body ?? {};
	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;
	const githubTokenHeader = req.headers.get("x-github-token") || undefined;

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value ||
		cookieStore.get("__Host-llmgateway_playground_key")?.value;
	const finalApiKey = headerApiKey ?? cookieApiKey;
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
		headers: { "x-source": "chat.llmgateway.io" },
	});

	let selectedModel = (model ?? headerModel ?? "auto") as LLMGatewayChatModelId;
	if (provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}` as LLMGatewayChatModelId;
		}
	}

	try {
		const tools = await getGithubMcpTools(githubTokenHeader);

		if (!tools) {
			return new Response(JSON.stringify({ error: "No tools found" }), {
				status: 500,
			});
		}

		const agent = new ToolLoopAgent({
			model: llmgateway.chat(selectedModel),
			instructions:
				"You are a helpful GitHub assistant. Use the available tools to browse repositories, issues, PRs, and code. Always ask for clarification before making impactful changes.",
			tools,
		});

		return await createAgentUIStreamResponse({
			agent,
			messages: messages as any,
		});
	} catch {
		return new Response(
			JSON.stringify({ error: "GitHub agent request failed" }),
			{
				status: 500,
			},
		);
	}
}
