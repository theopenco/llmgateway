import { readFileSync } from "node:fs";
import process from "node:process";

import { projectUpstream } from "./project-upstream";
import {
	mockOpenAIServer,
	getMockVideos,
	setMockVideoAsset,
	setMockAudioAsset,
	setMockVideoStatus,
	startMockServer,
} from "../../gateway/dist/test-utils/mock-openai-server.js";
import { startMockRealtimeServer } from "../../gateway/dist/test-utils/mock-realtime-server.js";

if (!process.env.STACK_SUFFIX || !process.env.GATEWAY_PORT) {
	throw new Error(
		"Load an isolated stack environment before starting the mock provider.",
	);
}

const image = readFileSync(
	new URL("../../gateway/src/test-fixtures/test-image.png", import.meta.url),
).toString("base64");
setMockVideoAsset(
	readFileSync(new URL("./fixtures/test-video.mp4", import.meta.url)),
);
const voiceWav = readFileSync(
	new URL("../../gateway/src/test-fixtures/test-audio.wav", import.meta.url),
);
setMockAudioAsset("wav", voiceWav);
let voicePcm: Buffer | undefined;
for (let offset = 12; offset + 8 <= voiceWav.length;) {
	const length = voiceWav.readUInt32LE(offset + 4);
	if (voiceWav.toString("ascii", offset, offset + 4) === "data") {
		voicePcm = voiceWav.subarray(offset + 8, offset + 8 + length);
		break;
	}
	offset += 8 + length + (length % 2);
}
if (!voicePcm?.length) {
	throw new Error("The voice fixture has no PCM data.");
}
for (const format of ["mp3", "aac", "flac", "opus"]) {
	setMockAudioAsset(
		format,
		readFileSync(new URL(`./fixtures/test-audio.${format}`, import.meta.url)),
	);
}
setInterval(() => {
	for (const job of getMockVideos()) {
		const createdAtMs = job.created_at * 1000;
		const age = Date.now() - createdAtMs;
		if (job.status === "queued" && age >= 2000) {
			setMockVideoStatus(job.id, "in_progress", { progress: 50 });
		} else if (job.status === "in_progress" && age >= 5000) {
			setMockVideoStatus(job.id, "completed");
		}
	}
}, 1000).unref();
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

const voiceFixture = Buffer.concat(Array<Buffer>(4).fill(voicePcm));

void startMockServer(
	Number(process.env.GATEWAY_PORT) + 8,
	async (request) =>
		await ((await projectUpstream(request)) ?? mockOpenAIServer.fetch(request)),
)
	.then((url) => {
		startMockRealtimeServer(
			Number(process.env.GATEWAY_PORT) + 9,
			url,
			voiceFixture,
		);
	})
	.catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
		);
		process.exitCode = 1;
	});
