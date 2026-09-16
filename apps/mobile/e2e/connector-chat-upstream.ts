import { randomUUID } from "node:crypto";

import { z } from "zod";

const schema = z.object({
	model: z.string(),
	stream: z.boolean().optional(),
	messages: z.array(
		z.object({
			role: z.string(),
			content: z.unknown(),
			tool_calls: z.unknown().optional(),
		}),
	),
});
export const connectorChatStats = {
	proposals: 0,
	continuations: 0,
	toolDenials: 0,
};

export async function connectorChatUpstream(
	request: Request,
): Promise<Response | null> {
	if (
		request.method !== "POST" ||
		new URL(request.url).pathname !== "/v1/chat/completions"
	) {
		return null;
	}
	const parsed = schema.safeParse(await request.clone().json());
	if (!parsed.success) {
		return null;
	}
	const body = parsed.data;
	const userIndex = body.messages
		.map((message) => message.role)
		.lastIndexOf("user");
	const prompt = JSON.stringify(body.messages[userIndex]?.content ?? "");
	if (!prompt.includes("NATIVE_CONNECTOR_")) {
		return null;
	}
	const outputs = body.messages
		.slice(userIndex + 1)
		.filter((message) => message.role === "tool");
	const denied = outputs.some((message) =>
		/denied|not approved/i.test(JSON.stringify(message.content)),
	);
	const failed = outputs.some((message) =>
		/could not be confirmed/i.test(JSON.stringify(message.content)),
	);
	const read = outputs.some((message) =>
		JSON.stringify(message.content).includes(
			"The demo meeting starts at noon.",
		),
	);
	const content = denied
		? "Request declined. No mailbox access was performed."
		: failed
			? "The previous action has an uncertain result. I will not repeat it."
			: read
				? "The demo meeting starts at noon."
				: null;
	const name = outputs.length
		? "gmail__read_message"
		: "gmail__search_messages";
	const input = outputs.length
		? { id: "fixture-message" }
		: {
				query: prompt.includes("NATIVE_CONNECTOR_STOP")
					? "NATIVE_CONNECTOR_STOP"
					: "demo",
				limit: 5,
			};
	if (content) {
		connectorChatStats.continuations++;
		if (denied) {
			connectorChatStats.toolDenials++;
		}
	} else {
		connectorChatStats.proposals++;
	}
	const toolCalls = content
		? undefined
		: [
				{
					index: 0,
					id: `call-${randomUUID()}`,
					type: "function",
					function: { name, arguments: JSON.stringify(input) },
				},
			];
	const base = {
		id: `chatcmpl-${randomUUID()}`,
		created: Math.floor(Date.now() / 1000),
		model: body.model,
	};
	const finishReason = toolCalls ? "tool_calls" : "stop";
	const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
	if (!body.stream) {
		return Response.json({
			...base,
			object: "chat.completion",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content, tool_calls: toolCalls },
					finish_reason: finishReason,
				},
			],
			usage,
		});
	}
	return new Response(
		[
			{
				...base,
				object: "chat.completion.chunk",
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content, tool_calls: toolCalls },
						finish_reason: null,
					},
				],
			},
			{
				...base,
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
				usage,
			},
		]
			.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
			.join("") + "data: [DONE]\n\n",
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
