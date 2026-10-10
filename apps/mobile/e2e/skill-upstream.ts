import { z } from "zod";

const schema = z.object({
	model: z.string(),
	stream: z.boolean().optional(),
	input: z.unknown().optional(),
	tools: z
		.array(
			z.union([
				z.object({ name: z.string() }),
				z.object({ function: z.object({ name: z.string() }) }),
			]),
		)
		.optional(),
	messages: z
		.array(z.object({ role: z.string(), content: z.unknown() }))
		.optional(),
});
const stats = { generated: 0, probes: 0 };
const draft = {
	name: "harbor-writing",
	description: "A reusable writing skill.",
	instructions: "Use the word HARBOR when answering.",
};

export async function skillUpstream(
	request: Request,
): Promise<Response | null> {
	const path = new URL(request.url).pathname;
	if (path === "/mock/skills") {
		return Response.json(stats);
	}
	if (
		request.method !== "POST" ||
		!["/v1/responses", "/v1/chat/completions"].includes(path)
	) {
		return null;
	}
	const parsed = schema.safeParse(await request.clone().json());
	if (!parsed.success) {
		return null;
	}
	const body = parsed.data;
	if (
		body.tools?.some(
			(tool) =>
				("name" in tool ? tool.name : tool.function.name) === "save_skill",
		)
	) {
		stats.generated++;
		if (
			JSON.stringify(body.input ?? body.messages ?? []).includes(
				"SKILL_CANCEL_PROBE",
			)
		) {
			await new Promise((resolve) => setTimeout(resolve, 8000));
		}
		if (path === "/v1/responses") {
			return Response.json({
				id: "resp-skill",
				object: "response",
				created_at: 1,
				status: "completed",
				model: body.model,
				output: [
					{
						type: "function_call",
						id: "fc-skill",
						call_id: "call-skill",
						name: "save_skill",
						arguments: JSON.stringify(draft),
						status: "completed",
					},
				],
				usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
			});
		}
		return Response.json({
			id: "chatcmpl-skill",
			object: "chat.completion",
			created: 1,
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
								id: "call-skill",
								type: "function",
								function: {
									name: "save_skill",
									arguments: JSON.stringify(draft),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
		});
	}
	const prompt = JSON.stringify(
		body.messages?.filter((message) => message.role === "user").at(-1)
			?.content ?? "",
	);
	if (!/SKILL_(ENABLED|EDITED|DISABLED|DELETED)_PROBE/.test(prompt)) {
		return null;
	}
	stats.probes++;
	const system =
		body.messages
			?.filter((message) => message.role === "system")
			.map((message) => String(message.content))
			.join("\n") ?? "";
	const expected = prompt.includes("SKILL_ENABLED_PROBE")
		? "HARBOR"
		: prompt.includes("SKILL_EDITED_PROBE")
			? "LIGHTHOUSE"
			: null;
	const skillName = prompt.match(/Native writing \d+/)?.[0];
	const skillContext = system
		.split("\n\n")
		.find((section) => section.startsWith(`Skill: ${skillName}\n`));
	const correct =
		!!skillName &&
		(expected
			? !!skillContext?.includes(`Use the word ${expected} when answering.`)
			: !skillContext);
	const content = correct
		? expected
			? `Enabled skill verified: ${expected}.`
			: "Skill excluded from context."
		: "Skill context check failed.";
	const base = { id: "chatcmpl-skill-probe", created: 1, model: body.model };
	if (body.stream) {
		return new Response(
			[
				{
					...base,
					object: "chat.completion.chunk",
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
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
				},
			]
				.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
				.join("") + "data: [DONE]\n\n",
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
		usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
	});
}
