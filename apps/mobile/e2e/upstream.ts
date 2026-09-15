import { readFileSync } from "node:fs";
import process from "node:process";

import {
	mockOpenAIServer,
	startMockServer,
} from "../../gateway/dist/test-utils/mock-openai-server.js";

if (!process.env.STACK_SUFFIX || !process.env.GATEWAY_PORT) {
	throw new Error(
		"Load an isolated stack environment before starting the mock provider.",
	);
}

const image = readFileSync(
	new URL("../../gateway/src/test-fixtures/test-image.png", import.meta.url),
).toString("base64");
function imageResponse(count: number, stream: boolean, type: string) {
	if (stream) {
		return new Response(
			`data: ${JSON.stringify({ type, b64_json: image })}\n\n`,
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	}
	return Response.json({
		created: Math.floor(Date.now() / 1000),
		data: Array.from({ length: count }, () => ({ b64_json: image })),
	});
}
mockOpenAIServer.post("/v1/images/generations", async (context) => {
	const body = await context.req.json<{ n?: number; stream?: boolean }>();
	return imageResponse(
		body.n ?? 1,
		!!body.stream,
		"image_generation.completed",
	);
});
mockOpenAIServer.post("/v1/images/edits", async (context) => {
	const body = await context.req.parseBody();
	if (!body.image && !body["image[]"]) {
		return context.json(
			{ error: { message: "A reference image is required." } },
			400,
		);
	}
	return imageResponse(
		Number(body.n ?? 1),
		String(body.stream).toLowerCase() === "true",
		"image_edit.completed",
	);
});

void startMockServer(Number(process.env.GATEWAY_PORT) + 8).catch(
	(error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
		);
		process.exitCode = 1;
	},
);
