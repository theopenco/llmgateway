import { streamText } from "ai";
import { cookies } from "next/headers";

import { catalog } from "@/lib/canvas/catalog";
import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

export const maxDuration = 300;

interface CanvasGenerateBody {
	prompt: string;
	model?: string;
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	let body: CanvasGenerateBody;
	try {
		body = (await req.json()) as CanvasGenerateBody;
	} catch {
		return new Response(JSON.stringify({ error: "Invalid JSON" }), {
			status: 400,
		});
	}
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	const model = typeof body.model === "string" ? body.model.trim() : undefined;
	const systemPrompt = catalog.prompt();

	if (!prompt) {
		return new Response(JSON.stringify({ error: "Missing prompt" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key")?.trim() || undefined;

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value.trim() ||
		cookieStore.get("__Host-llmgateway_playground_key")?.value.trim();
	const finalApiKey = headerApiKey || cookieApiKey;

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
		},
	});

	const selectedModel = model || "anthropic/claude-sonnet-4-20250514";

	const result = streamText({
		model: llmgateway.chat(
			selectedModel as Parameters<typeof llmgateway.chat>[0],
		),
		system: systemPrompt,
		messages: [{ role: "user", content: prompt }],
	});

	return result.toTextStreamResponse();
}
