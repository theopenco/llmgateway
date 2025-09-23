import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";
import { streamText, UIMessage, convertToModelMessages } from "ai";

export const maxDuration = 300; // 5 minutes

type ChatRequestBody = {
	messages: UIMessage[];
	model?: LLMGatewayChatModelId;
	apiKey?: string;
};

export async function POST(req: Request) {
	const body = await req.json();
	const { messages, model, apiKey }: ChatRequestBody = body;

	if (!messages || !Array.isArray(messages)) {
		console.error("Invalid messages:", messages);
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;

	const finalApiKey = apiKey ?? headerApiKey;
	if (!finalApiKey) {
		console.error("No API key provided in body or headers");
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
		});

		return result.toUIMessageStreamResponse();
	} catch (error) {
		console.error("LLM Gateway error:", error);
		return new Response(
			JSON.stringify({ error: "LLM Gateway request failed" }),
			{
				status: 500,
			},
		);
	}
}
