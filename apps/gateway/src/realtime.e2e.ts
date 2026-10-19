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
	realtimeModels,
} from "@/chat-helpers.e2e.js";

import { db, desc, eq, tables } from "@llmgateway/db";

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
 * Speech-to-speech sessions over the /v1/realtime WebSocket: a text turn and
 * an audio turn against a real provider, each billed to its own log row before
 * its response.done reaches the client.
 */
describe("e2e realtime sessions", () => {
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

	test.each(realtimeModels)(
		"realtime session $model",
		getTestOptions(),
		async ({ model, provider, originalModel }) => {
			const pcm = readWavPcm(FIXTURE_AUDIO_PATH);
			const events: Record<string, unknown>[] = [];
			const ws = new WebSocket(
				`ws://127.0.0.1:${port}/v1/realtime?model=${encodeURIComponent(model)}`,
				{ headers: { Authorization: "Bearer real-token" } },
			);

			const responses = await new Promise<Record<string, unknown>[]>(
				(resolve, reject) => {
					const done: Record<string, unknown>[] = [];
					const timer = setTimeout(
						() =>
							reject(
								new Error(
									`timed out; events: ${events.map((e) => e.type).join(",")}`,
								),
							),
						50_000,
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
					ws.on("close", (code, reason) => {
						clearTimeout(timer);
						reject(new Error(`session closed ${code}: ${reason.toString()}`));
					});
					ws.on("open", () => {
						ws.send(
							JSON.stringify({
								type: "session.update",
								session: {
									type: "realtime",
									instructions: "Answer in one short sentence.",
									audio: {
										input: {
											format: { type: "audio/pcm", rate: 24000 },
											turn_detection: null,
										},
									},
								},
							}),
						);
						ws.send(
							JSON.stringify({
								type: "conversation.item.create",
								item: {
									type: "message",
									role: "user",
									content: [{ type: "input_text", text: "Say hello." }],
								},
							}),
						);
						ws.send(JSON.stringify({ type: "response.create" }));
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
						if (event.type === "error") {
							clearTimeout(timer);
							reject(new Error(`session error: ${JSON.stringify(event)}`));
						}
						if (event.type !== "response.done") {
							return;
						}
						done.push(event);
						if (done.length === 1) {
							// Second turn: the fixture's spoken audio.
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
							ws.send(JSON.stringify({ type: "response.create" }));
							return;
						}
						clearTimeout(timer);
						resolve(done);
					});
				},
			);

			const closed = new Promise<void>((resolve) =>
				ws.on("close", () => resolve()),
			);
			ws.close();
			await closed;

			const canonical = `${provider.providerId}/${originalModel}`;
			for (const event of responses) {
				const response = event.response as Record<string, unknown>;
				expect(response.status).toBe("completed");
				expect(response.model).toBe(canonical);
			}

			// Each response was billed before its terminal event was forwarded.
			const [session] = await db
				.select({ id: tables.realtimeSession.id })
				.from(tables.realtimeSession)
				.where(eq(tables.realtimeSession.requestedModel, model))
				.orderBy(desc(tables.realtimeSession.createdAt))
				.limit(1);
			expect(session).toBeDefined();
			const rows = await db
				.select({
					billingCost: tables.log.billingCost,
					usedModel: tables.log.usedModel,
					realtimeUsage: tables.log.realtimeUsage,
				})
				.from(tables.log)
				.where(eq(tables.log.realtimeSessionId, session!.id));
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row.usedModel).toBe(canonical);
				expect(Number(row.billingCost)).toBeGreaterThan(0);
				expect(row.realtimeUsage?.status).toBe("completed");
			}
		},
	);
});
