import { streamText } from "ai";
import { cookies } from "next/headers";

import { catalog } from "@/lib/canvas/catalog";
import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

export const maxDuration = 300;

interface CanvasGenerateBody {
	prompt: string;
	model?: string;
}

export async function POST(req: Request) {
	// Parse the body while the auth round-trip is in flight; auth still gates
	// every use of it.
	const userPromise = getUser();
	const parsedPromise = req.json().then(
		(value) => ({ ok: true as const, value: value as CanvasGenerateBody }),
		() => ({ ok: false as const }),
	);

	const user = await userPromise;

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const parsed = await parsedPromise;
	if (!parsed.ok) {
		return new Response(JSON.stringify({ error: "Invalid JSON" }), {
			status: 400,
		});
	}
	const body = parsed.value;
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
	const cookieApiKey = getPlaygroundKeyForRequest(cookieStore)?.trim();
	const finalApiKey = headerApiKey || cookieApiKey;

	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: getGatewayApiBaseUrl(),
		headers: {
			"x-source": LOUNGE_SOURCE,
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
