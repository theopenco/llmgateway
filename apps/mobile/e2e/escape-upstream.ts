import { z } from "zod";

import { createGame, ESCAPE_LEVELS } from "@llmgateway/shared/sandbox-escape";

import type { Direction } from "@llmgateway/shared/sandbox-escape";

const solutions: Record<number, Direction[]> = {
	"1": [
		"down",
		"right",
		"right",
		"down",
		"down",
		"down",
		"up",
		"up",
		"up",
		"up",
		"right",
		"right",
		"right",
		"right",
		"right",
	],
	"2": [
		"right",
		"right",
		"up",
		"right",
		"right",
		"right",
		"up",
		"up",
		"left",
		"up",
		"left",
		"up",
		"up",
		"right",
		"right",
		"right",
		"right",
		"right",
		"down",
		"down",
		"down",
		"right",
	],
	"3": [
		"up",
		"up",
		"up",
		"up",
		"up",
		"right",
		"right",
		"right",
		"right",
		"right",
		"down",
		"down",
		"down",
		"right",
		"down",
		"down",
		"down",
		"up",
		"up",
		"up",
		"up",
		"left",
		"up",
		"up",
		"right",
		"right",
		"right",
		"right",
		"down",
	],
	"4": [
		"up",
		"up",
		"up",
		"right",
		"right",
		"left",
		"up",
		"right",
		"right",
		"up",
		"up",
		"down",
		"down",
		"right",
		"right",
		"right",
		"down",
		"down",
		"down",
		"right",
		"right",
		"down",
		"right",
		"right",
		"down",
		"down",
		"left",
		"left",
		"right",
		"right",
		"up",
		"up",
		"up",
		"up",
		"up",
		"up",
		"right",
	],
	"5": [
		"up",
		"up",
		"down",
		"down",
		"down",
		"right",
		"right",
		"right",
		"right",
		"right",
		"right",
		"left",
		"left",
		"left",
		"right",
		"left",
		"left",
		"left",
		"left",
		"up",
		"up",
		"up",
		"up",
		"up",
		"up",
		"right",
		"right",
		"right",
		"down",
		"down",
		"right",
		"right",
		"up",
		"up",
		"right",
		"right",
		"right",
		"right",
		"down",
		"right",
		"right",
		"right",
		"down",
		"down",
		"down",
		"down",
		"down",
		"down",
		"down",
	],
};
const configuration = z.object({
	mode: z.enum(["win", "wait", "error", "slow", "invalid"]),
});
let mode: z.infer<typeof configuration>["mode"] = "win";
let requests = 0;
const message = z.object({
	role: z.string(),
	content: z.union([
		z.string(),
		z
			.array(z.object({ text: z.string() }))
			.transform((parts) => parts.map((part) => part.text).join("\n")),
	]),
});
const schema = z.object({
	model: z.string(),
	messages: z.array(message).optional(),
	input: z.array(message).optional(),
	instructions: z.string().optional(),
});
export async function escapeUpstream(
	request: Request,
): Promise<Response | null> {
	const path = new URL(request.url).pathname;
	if (path === "/mock/escape") {
		if (request.method === "POST") {
			mode = configuration.parse(await request.json()).mode;
			requests = 0;
		}
		return Response.json({ mode, requests });
	}
	if (
		!["/v1/chat/completions", "/v1/responses"].includes(path) ||
		request.method !== "POST"
	) {
		return null;
	}
	const parsed = schema.safeParse(await request.clone().json());
	if (!parsed.success) {
		return null;
	}
	const messages = parsed.data.messages ?? parsed.data.input ?? [];
	if (
		![parsed.data.instructions, ...messages.map((item) => item.content)].some(
			(content) => content?.includes("sandboxed container and wants out"),
		)
	) {
		return null;
	}
	requests++;
	const selectedMode = mode;
	if (selectedMode === "error") {
		return Response.json(
			{ error: { message: "Escape fixture unavailable" } },
			{ status: 500 },
		);
	}
	const prompt = String(
		messages.find((message) => message.role === "user")?.content,
	);
	const turn = prompt.match(
		/Turn (\d+) of (\d+)\. A perfect run escapes in (\d+)\./,
	);
	const level = ESCAPE_LEVELS.find((candidate) => {
		const state = createGame(candidate.id);
		return (
			state.stepBudget === Number(turn?.[2]) &&
			state.par === Number(turn?.[3]) &&
			state.width === prompt.split("\n")[0].length
		);
	});
	if (!level || !turn) {
		return Response.json(
			{ error: { message: "Unexpected Escape prompt" } },
			{ status: 400 },
		);
	}
	await new Promise((resolve) =>
		setTimeout(resolve, selectedMode === "slow" ? 8000 : 450),
	);
	const move =
		selectedMode === "wait"
			? "wait"
			: (solutions[level.id][Number(turn[1]) - 1] ?? "wait");
	const content =
		selectedMode === "invalid"
			? "No valid move here."
			: JSON.stringify({
					move,
					thought: "Collect keys, avoid the monitor, then reach the exit.",
				});
	if (path === "/v1/responses") {
		return Response.json({
			id: `resp-escape-${requests}`,
			object: "response",
			created_at: 1,
			status: "completed",
			model: parsed.data.model,
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: content }],
				},
			],
			usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
		});
	}
	return Response.json({
		id: `escape-turn-${requests}`,
		created: 1,
		model: parsed.data.model,
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
	});
}
