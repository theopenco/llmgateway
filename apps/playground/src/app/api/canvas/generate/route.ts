import { streamText } from "ai";
import { cookies } from "next/headers";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

export const maxDuration = 300;

interface CanvasGenerateBody {
	prompt: string;
	model?: string;
	systemPrompt: string;
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = (await req.json()) as CanvasGenerateBody;
	const { prompt, model, systemPrompt } = body;

	if (!prompt) {
		return new Response(JSON.stringify({ error: "Missing prompt" }), {
			status: 400,
		});
	}

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value ??
		cookieStore.get("__Host-llmgateway_playground_key")?.value;

	if (!cookieApiKey) {
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
		apiKey: cookieApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "chat.llmgateway.io",
		},
	});

	const selectedModel = model ?? "anthropic/claude-sonnet-4-20250514";

	const result = streamText({
		model: llmgateway.chat(selectedModel as Parameters<typeof llmgateway.chat>[0]),
		system: systemPrompt,
		messages: [{ role: "user", content: prompt }],
	});

	return result.toTextStreamResponse();
}
