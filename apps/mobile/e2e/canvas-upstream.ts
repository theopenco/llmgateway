import { z } from "zod";

const schema = z.object({
	model: z.string(),
	stream: z.boolean().optional(),
	messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});
const stats = { generated: 0, instructions: false, model: "" };
export const canvasFixture = {
	root: "root",
	state: { name: "Canvas visitor", confirmed: false },
	elements: {
		root: {
			type: "Stack",
			props: { direction: "vertical", align: "stretch", gap: "lg" },
			children: ["title", "name", "greeting", "confirm", "confirmed", "chart"],
		},
		title: {
			type: "Heading",
			props: { text: "Native canvas fixture", level: "h2" },
		},
		name: {
			type: "Input",
			props: {
				label: "Display name",
				name: "name",
				value: { $bindState: "/name" },
			},
		},
		greeting: { type: "Text", props: { text: { $state: "/name" } } },
		confirm: {
			type: "Button",
			props: { label: "Confirm canvas" },
			on: {
				press: {
					action: "setState",
					params: { statePath: "/confirmed", value: true },
				},
			},
		},
		confirmed: {
			type: "Text",
			props: { text: "Canvas confirmed" },
			visible: { $state: "/confirmed", eq: true },
		},
		chart: {
			type: "BarChart",
			props: {
				title: "Sample activity",
				data: [
					{ day: "Mon", visits: 3 },
					{ day: "Tue", visits: 7 },
				],
				xAxisKey: "day",
				series: [{ dataKey: "visits", label: "Visits" }],
			},
		},
	},
};

export async function canvasUpstream(
	request: Request,
): Promise<Response | null> {
	const path = new URL(request.url).pathname;
	if (path === "/mock/canvas") {
		return Response.json(stats);
	}
	if (path !== "/v1/chat/completions" || request.method !== "POST") {
		return null;
	}
	const parsed = schema.safeParse(await request.clone().json());
	if (!parsed.success) {
		return null;
	}
	const body = parsed.data;
	const prompt = JSON.stringify(
		body.messages.filter((item) => item.role === "user").at(-1)?.content ?? "",
	);
	if (!prompt.includes("NATIVE_CANVAS_")) {
		return null;
	}
	stats.generated++;
	stats.model = body.model;
	stats.instructions = body.messages.some(
		(item) =>
			item.role === "system" && String(item.content).includes("RadialBarChart"),
	);
	const content = prompt.includes("NATIVE_CANVAS_INVALID")
		? "This is not a canvas."
		: [
				{ op: "add", path: "/root", value: canvasFixture.root },
				{ op: "add", path: "/state", value: canvasFixture.state },
				...Object.entries(canvasFixture.elements).map(([key, value]) => ({
					op: "add",
					path: `/elements/${key}`,
					value,
				})),
			]
				.map((item) => JSON.stringify(item))
				.join("\n") + "\n";
	const base = { id: "chatcmpl-canvas", created: 1, model: body.model };
	if (!body.stream) {
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
	let cancelled = false;
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			async start(controller) {
				if (prompt.includes("NATIVE_CANVAS_SLOW")) {
					await new Promise((resolve) => setTimeout(resolve, 8000));
				}
				for (const line of content.split("\n")) {
					if (cancelled) {
						return;
					}
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: `${line}\n` }, finish_reason: null }] })}\n\n`,
						),
					);
					await new Promise((resolve) => setTimeout(resolve, 120));
				}
				if (cancelled) {
					return;
				}
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`,
					),
				);
				controller.close();
			},
			cancel() {
				cancelled = true;
			},
		}),
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
