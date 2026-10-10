import { z } from "zod";

const requestSchema = z.object({
	model: z.string(),
	stream: z.boolean().optional(),
	messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
	tools: z
		.array(z.object({ function: z.object({ name: z.string() }) }))
		.optional(),
});
const stats = { knowledgeRequests: 0, memoryRequests: 0 };
const responsesSchema = z.object({
	model: z.string(),
	input: z.unknown(),
	tools: z.array(z.object({ name: z.string() })).optional(),
});

export async function projectUpstream(
	request: Request,
): Promise<Response | null> {
	const path = new URL(request.url).pathname;
	if (path === "/mock/projects") {
		return Response.json(stats);
	}
	if (path === "/v1/responses" && request.method === "POST") {
		const parsed = responsesSchema.safeParse(await request.clone().json());
		if (
			parsed.success &&
			parsed.data.tools?.some((tool) => tool.name === "save_memories")
		) {
			stats.memoryRequests++;
			return Response.json({
				id: "resp-project-memory",
				object: "response",
				created_at: Math.floor(Date.now() / 1000),
				status: "completed",
				model: parsed.data.model,
				output: [
					{
						type: "function_call",
						id: "fc-memory",
						call_id: "call-memory",
						name: "save_memories",
						arguments: JSON.stringify({
							memories: JSON.stringify(parsed.data.input).includes(
								"I prefer concise answers",
							)
								? ["Prefers concise answers."]
								: [],
						}),
						status: "completed",
					},
				],
				usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
			});
		}
		return null;
	}
	if (path !== "/v1/chat/completions" || request.method !== "POST") {
		return null;
	}
	const parsed = requestSchema.safeParse(await request.clone().json());
	if (!parsed.success) {
		return null;
	}
	const body = parsed.data;
	if (body.tools?.some((tool) => tool.function.name === "save_memories")) {
		stats.memoryRequests++;
		const prompt = body.messages
			.map((message) => JSON.stringify(message.content))
			.join("\n");
		return Response.json({
			id: "chatcmpl-project-memory",
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: body.model,
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call-memory",
								type: "function",
								function: {
									name: "save_memories",
									arguments: JSON.stringify({
										memories: prompt.includes("I prefer concise answers")
											? ["Prefers concise answers."]
											: [],
									}),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
		});
	}
	const lastUser = body.messages
		.filter((message) => message.role === "user")
		.at(-1);
	const prompt = JSON.stringify(lastUser?.content ?? "");
	if (!/PROJECT_(CONTEXT|MEMORY|REMOVED_FILE|DETACHED)_PROBE/.test(prompt)) {
		return null;
	}
	stats.knowledgeRequests++;
	const system = body.messages
		.filter((message) => message.role === "system")
		.map((message) => String(message.content))
		.join("\n");
	let content: string;
	if (prompt.includes("PROJECT_MEMORY_PROBE")) {
		content = system.includes("Prefers concise answers.")
			? "Learned memory verified."
			: "Learned memory is missing.";
	} else if (prompt.includes("PROJECT_REMOVED_FILE_PROBE")) {
		content =
			!system.includes("ORBIT-42") &&
			system.includes("Prefers concise answers.")
				? "File removal verified; memory retained."
				: "File removal check failed.";
	} else if (prompt.includes("PROJECT_DETACHED_PROBE")) {
		content =
			!system.includes("Project:") &&
			!system.includes("ORBIT-42") &&
			!system.includes("Prefers concise answers.")
				? "Detached conversation verified."
				: "Deleted project context is still present.";
	} else {
		content =
			system.includes("Use metric units.") &&
			system.includes("Preferred timezone is UTC.") &&
			system.includes("ORBIT-42") &&
			system.includes("[Source: lounge-knowledge.md]")
				? "Project context verified: ORBIT-42, metric units, UTC."
				: "Project context is missing.";
	}
	const base = {
		id: "chatcmpl-project-context",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: body.model,
	};
	if (body.stream) {
		const chunks = [
			{
				...base,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content },
						finish_reason: null,
					},
				],
			},
			{
				...base,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
			},
		];
		return new Response(
			chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
				"data: [DONE]\n\n",
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	}
	return Response.json({
		...base,
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
	});
}
