import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAdaptorServer } from "@hono/node-server";
import "dotenv/config";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { WebSocket } from "ws";

import {
	beforeAllHook,
	beforeEachHook,
	getTestOptions,
	logMode,
	realtimeTranscriptionModels,
} from "@/chat-helpers.e2e.js";

import { and, db, desc, eq, isNotNull, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { attachRealtimeServer } from "./realtime/server.js";

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 24 kHz mono PCM16: the fixture already matches the audio/pcm session format.
const FIXTURE_AUDIO_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-audio.wav",
);

function readWavPcm(file: string): Buffer {
	const wav = fs.readFileSync(file);
	let offset = 12;
	while (offset + 8 <= wav.length) {
		const id = wav.toString("ascii", offset, offset + 4);
		const size = wav.readUInt32LE(offset + 4);
		if (id === "data") {
			return wav.subarray(offset + 8, offset + 8 + size);
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error("fixture has no data chunk");
}

/**
 * Live transcription sessions over the /v1/realtime WebSocket: the upstream
 * URL, the gateway's model pin, the usage contract of the completed event and
 * the billed log row. Sessions run serially against a real provider.
 */
describe("e2e realtime transcription sessions", () => {
	let server: Server;
	let port: number;
	let realtime: ReturnType<typeof attachRealtimeServer>;

	beforeAll(async () => {
		await beforeAllHook();
		server = createAdaptorServer({ fetch: app.fetch }) as Server;
		realtime = attachRealtimeServer(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		port = (server.address() as AddressInfo).port;
	});
	beforeEach(beforeEachHook);
	afterAll(async () => {
		realtime?.closeAll(1001, "test_teardown");
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	});

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(realtimeTranscriptionModels)(
		"transcription session $model",
		getTestOptions(),
		async ({ model, provider, originalModel }) => {
			const pcm = readWavPcm(FIXTURE_AUDIO_PATH);
			const events: Record<string, unknown>[] = [];
			const ws = new WebSocket(
				`ws://127.0.0.1:${port}/v1/realtime?intent=transcription&model=${encodeURIComponent(model)}`,
				{ headers: { Authorization: "Bearer real-token" } },
			);

			const completed = await new Promise<Record<string, unknown>>(
				(resolve, reject) => {
					const timer = setTimeout(
						() =>
							reject(
								new Error(
									`timed out; events: ${events.map((e) => e.type).join(",")}`,
								),
							),
						60_000,
					);
					ws.on("unexpected-response", (_req, res) => {
						let body = "";
						res.on("data", (chunk) => (body += chunk));
						res.on("end", () => {
							clearTimeout(timer);
							reject(new Error(`upgrade rejected ${res.statusCode}: ${body}`));
						});
					});
					ws.on("error", (error) => {
						clearTimeout(timer);
						reject(error);
					});
					ws.on("open", () => {
						ws.send(
							JSON.stringify({
								type: "session.update",
								session: {
									type: "transcription",
									audio: {
										input: {
											format: { type: "audio/pcm", rate: 24000 },
											transcription: { model },
											turn_detection: null,
										},
									},
								},
							}),
						);
						const chunk = 4800;
						for (let i = 0; i < pcm.length; i += chunk) {
							ws.send(
								JSON.stringify({
									type: "input_audio_buffer.append",
									audio: pcm.subarray(i, i + chunk).toString("base64"),
								}),
							);
						}
						ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
					});
					ws.on("message", (data) => {
						const event = JSON.parse(data.toString()) as Record<
							string,
							unknown
						>;
						events.push(event);
						if (logMode) {
							console.log("realtime event:", JSON.stringify(event));
						}
						if (
							event.type ===
							"conversation.item.input_audio_transcription.completed"
						) {
							clearTimeout(timer);
							resolve(event);
						}
						if (
							event.type === "error" ||
							event.type ===
								"conversation.item.input_audio_transcription.failed"
						) {
							clearTimeout(timer);
							reject(new Error(`session error: ${JSON.stringify(event)}`));
						}
					});
				},
			);

			const closed = new Promise<void>((resolve) =>
				ws.on("close", () => resolve()),
			);
			ws.close();
			await closed;

			// The gateway pins the model itself; the echoed config must carry the
			// canonical id, never the provider's.
			const updated = events.find((e) => e.type === "session.updated") as
				| {
						session: { audio: { input: { transcription: { model: string } } } };
				  }
				| undefined;
			expect(updated?.session.audio.input.transcription.model).toBe(
				`${provider.providerId}/${originalModel}`,
			);

			const transcript = completed.transcript as string;
			expect(transcript.toLowerCase()).toContain("fox");
			const usage = completed.usage as Record<string, unknown>;
			// Duration or token usage is fine, but the event must carry one: the
			// billing path fails closed without it.
			expect(["duration", "tokens"]).toContain(usage.type);

			// Billed before the transcript was forwarded, attributed to the ASR
			// mapping and linked to the session.
			const [row] = await db
				.select({
					billingCost: tables.log.billingCost,
					usedModel: tables.log.usedModel,
					realtimeUsage: tables.log.realtimeUsage,
				})
				.from(tables.log)
				.where(
					and(
						isNotNull(tables.log.realtimeSessionId),
						eq(tables.log.requestedModel, model),
					),
				)
				.orderBy(desc(tables.log.createdAt))
				.limit(1);
			expect(row).toBeDefined();
			expect(row?.usedModel).toBe(`${provider.providerId}/${originalModel}`);
			expect(Number(row?.billingCost)).toBeGreaterThan(0);
			expect(row?.realtimeUsage?.status).toBe("completed");
		},
	);
});
