import { createAdaptorServer } from "@hono/node-server";
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
	realtimeModels,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";
import { attachRealtimeServer } from "./realtime/server.js";

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

interface CapabilityCase {
	capability: string;
	session: Record<string, unknown>;
}

const capabilityModels =
	process.env.FULL_MODE === "true"
		? realtimeModels.filter(
				({ provider }) =>
					provider.providerId === "azure" || provider.providerId === "openai",
			)
		: [];
const capabilityCases = capabilityModels.flatMap((entry) => {
	const settings: CapabilityCase[] = [
		...(entry.provider.supportedVoices ?? []).map((voice) => ({
			capability: "voice " + voice,
			session: { audio: { output: { voice } } },
		})),
		...["audio/pcmu", "audio/pcma"].map((type) => ({
			capability: type,
			session: {
				audio: { input: { format: { type } }, output: { format: { type } } },
			},
		})),
		...[0.25, 1.5].map((speed) => ({
			capability: "speed " + speed,
			session: { audio: { output: { speed } } },
		})),
		{
			capability: "input transcription",
			session: {
				include: ["item.input_audio_transcription.logprobs"],
				audio: {
					input: {
						transcription: {
							model: entry.provider.providerId + "/gpt-4o-mini-transcribe",
							language: "en",
							prompt: "A greeting.",
						},
						noise_reduction: { type: "far_field" },
					},
				},
			},
		},
		{
			capability: "semantic VAD",
			session: {
				audio: {
					input: {
						turn_detection: {
							type: "semantic_vad",
							eagerness: "low",
							create_response: false,
							interrupt_response: true,
						},
					},
				},
			},
		},
		{
			capability: "server VAD and noise reduction",
			session: {
				audio: {
					input: {
						noise_reduction: { type: "near_field" },
						turn_detection: {
							type: "server_vad",
							threshold: 0.6,
							prefix_padding_ms: 200,
							silence_duration_ms: 600,
							create_response: false,
							interrupt_response: true,
						},
					},
				},
			},
		},
		{
			capability: "function tools and text output",
			session: {
				output_modalities: ["text"],
				instructions: "Always call the ping function.",
				tools: [
					{
						type: "function",
						name: "ping",
						description: "Check connectivity.",
						parameters: {
							type: "object",
							properties: {},
							required: [],
							additionalProperties: false,
						},
					},
				],
				tool_choice: "required",
				max_output_tokens: 1024,
			},
		},
	];
	return settings.map((setting) => ({ ...entry, ...setting }));
});

function configureSession(
	port: number,
	model: string,
	settings: Record<string, unknown>,
): Promise<{
	session: Record<string, unknown>;
	responses: Record<string, unknown>[];
	audioBytes: number;
	toolOutputAcknowledged: boolean;
}> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(
			`ws://127.0.0.1:${port}/v1/realtime?model=${encodeURIComponent(model)}`,
			{ headers: { Authorization: "Bearer real-token" } },
		);
		let session: Record<string, unknown> = {};
		const responses: Record<string, unknown>[] = [];
		let audioBytes = 0;
		let toolOutputAcknowledged = false;
		let settled = false;
		const timer = setTimeout(
			() => finish(new Error("Timed out configuring realtime session")),
			50_000,
		);
		function finish(error?: Error) {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			ws.close();
			if (error) {
				reject(error);
			} else {
				resolve({ session, responses, audioBytes, toolOutputAcknowledged });
			}
		}
		ws.on("unexpected-response", (_req, res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			res.on("end", () =>
				finish(new Error(`Upgrade rejected ${res.statusCode}: ${body}`)),
			);
		});
		ws.on("error", (error) => finish(error));
		ws.on("close", (code, reason) =>
			finish(new Error(`Session closed ${code}: ${reason.toString()}`)),
		);
		ws.on("open", () =>
			ws.send(
				JSON.stringify({
					type: "session.update",
					session: {
						type: "realtime",
						instructions: "Reply with exactly Hi.",
						max_output_tokens: 128,
						...settings,
					},
				}),
			),
		);
		ws.on("message", (data) => {
			const event = JSON.parse(data.toString()) as Record<string, unknown>;
			const item = event.item as Record<string, unknown> | undefined;
			if (item?.type === "function_call_output" && item.output === "PONG") {
				toolOutputAcknowledged = true;
			}
			if (event.type === "error") {
				finish(new Error(JSON.stringify(event)));
			} else if (event.type === "session.updated") {
				session = event.session as Record<string, unknown>;
				ws.send(
					JSON.stringify({
						type: "conversation.item.create",
						item: {
							type: "message",
							role: "user",
							content: [{ type: "input_text", text: "Say hi." }],
						},
					}),
				);
				ws.send(JSON.stringify({ type: "response.create" }));
			} else if (
				event.type === "response.output_audio.delta" &&
				typeof event.delta === "string"
			) {
				audioBytes += Buffer.from(event.delta, "base64").length;
			} else if (event.type === "response.done") {
				const response = event.response as Record<string, unknown>;
				responses.push(response);
				const details = response.status_details as
					Record<string, unknown> | undefined;
				if (
					response.status !== "completed" &&
					!(
						response.status === "incomplete" &&
						details?.reason === "content_filter" &&
						audioBytes > 0 &&
						!settings.tools
					)
				) {
					finish(new Error(JSON.stringify(response)));
					return;
				}
				if (settings.tools && responses.length === 1) {
					const output = response.output as Record<string, unknown>[];
					const call = output.find(
						(item) => item.type === "function_call" && item.name === "ping",
					);
					if (!call) {
						finish(
							new Error(`Missing function call: ${JSON.stringify(response)}`),
						);
						return;
					}
					ws.send(
						JSON.stringify({
							type: "conversation.item.create",
							item: {
								type: "function_call_output",
								call_id: call.call_id,
								output: "PONG",
							},
						}),
					);
					ws.send(
						JSON.stringify({
							type: "response.create",
							response: {
								tool_choice: "none",
								instructions: "Reply with PONG from the tool result.",
							},
						}),
					);
				} else {
					finish();
				}
			}
		});
	});
}

describe("e2e realtime capability parity", () => {
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
	test.each(capabilityCases)(
		"$model $capability",
		getTestOptions(),
		async ({ model, session }) => {
			const updated = await configureSession(port, model, session);
			expect(updated.session).toMatchObject(session);
			if (session.tools) {
				expect(updated.responses).toHaveLength(2);
				expect(updated.toolOutputAcknowledged).toBe(true);
				const last = updated.responses[1]!;
				expect(last.output).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							type: "message",
							content: expect.arrayContaining([
								expect.objectContaining({
									type: "output_text",
									text: expect.stringMatching(/\S/),
								}),
							]),
						}),
					]),
				);
			} else {
				expect(updated.responses).toHaveLength(1);
				expect(updated.audioBytes).toBeGreaterThan(0);
			}
		},
	);
});
