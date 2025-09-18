import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { LLMGatewayChatModelId } from "@llmgateway/ai-sdk-provider/internal";
import { streamText, UIMessage, convertToModelMessages } from "ai";

export const maxDuration = 30;

type ChatRequestBody = {
	messages: UIMessage[];
	model?: LLMGatewayChatModelId;
	apiKey?: string;
};

export async function POST(req: Request) {
	const { messages, model, apiKey }: ChatRequestBody = await req.json();

	if (!messages || !Array.isArray(messages)) {
		return new Response(JSON.stringify({ error: "Missing messages" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") || undefined;
	const headerModel = req.headers.get("x-llmgateway-model") || undefined;

	const llmgateway = createLLMGateway({ apiKey: apiKey ?? headerApiKey });
	const selectedModel = (model ??
		headerModel ??
		"auto") as LLMGatewayChatModelId;

	const result = streamText({
		model: llmgateway.chat(selectedModel),
		messages: convertToModelMessages(messages),
	});

	return result.toUIMessageStreamResponse();
}
