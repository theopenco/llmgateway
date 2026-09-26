import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { z } from "zod";

import { models } from "@llmgateway/models";

import type { ModelDefinition } from "@llmgateway/models";

const clientEvent = z.object({
	type: z.string(),
	audio: z.string().optional(),
	session: z
		.object({
			type: z.string().optional(),
			audio: z
				.object({
					input: z
						.object({
							turn_detection: z.unknown().optional(),
							transcription: z.object({ model: z.string() }).nullish(),
						})
						.optional(),
				})
				.optional(),
		})
		.optional(),
});

/** Local upstream for native microphone/protocol tests; audio never leaves this process. */
export function startMockRealtimeServer(
	port: number,
	httpBaseUrl: string,
	voiceAudio?: Buffer,
) {
	const stats = {
		connections: 0,
		audioBytes: 0,
		turns: 0,
		voiceTurns: 0,
		geminiTurns: 0,
		truncated: 0,
		seeded: 0,
	};
	const server = createServer(
		getRequestListener((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/mock/realtime") {
				return Response.json(stats);
			}
			return fetch(
				new Request(
					new URL(`${url.pathname}${url.search}`, httpBaseUrl),
					request,
				),
			);
		}),
	);
	server.listen(port);
	const sockets = new WebSocketServer({ server });
	sockets.on("connection", (socket, request) => {
		stats.connections++;
		const gemini = request.url?.includes("BidiGenerateContent") === true;
		const voice = gemini || !request.url?.includes("intent=transcription");
		let automatic = false;
		let durationTranscription = false;
		let readyAt = 0;
		let bufferedBytes = 0;
		let turn = 0;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const send = (event: Record<string, unknown>) => {
			if (socket.readyState === 1) {
				socket.send(JSON.stringify(event));
			}
		};
		const later = (fn: () => void, ms: number) => {
			const timer = setTimeout(() => {
				timers.delete(timer);
				fn();
			}, ms);
			timers.add(timer);
		};
		const transcriptionUsage = (seconds: number) =>
			durationTranscription
				? { type: "duration", seconds }
				: {
						type: "tokens",
						input_tokens: Math.ceil(seconds * 50),
						output_tokens: 6,
						total_tokens: Math.ceil(seconds * 50) + 6,
						input_token_details: {
							audio_tokens: Math.ceil(seconds * 50),
							text_tokens: 0,
						},
					};
		const reply = () => {
			if (!voiceAudio) {
				throw new Error("A PCM voice fixture is required.");
			}
			turn++;
			stats.voiceTurns++;
			bufferedBytes = 0;
			readyAt = Date.now() + 12000;
			const data = voiceAudio.toString("base64");
			if (gemini) {
				stats.geminiTurns++;
				send({
					serverContent: {
						inputTranscription: { text: "Welcome to the Lounge." },
					},
				});
				send({
					serverContent: {
						outputTranscription: { text: "Hello! Let's talk." },
						modelTurn: {
							parts: [
								{ inlineData: { data, mimeType: "audio/pcm;rate=24000" } },
							],
						},
					},
				});
				later(
					() =>
						send({
							usageMetadata: {
								promptTokenCount: 10,
								responseTokenCount: 20,
								promptTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }],
								responseTokensDetails: [{ modality: "AUDIO", tokenCount: 20 }],
							},
							serverContent: { turnComplete: true },
						}),
					300,
				);
				return;
			}
			const item_id = `assistant_${turn}`;
			send({ type: "input_audio_buffer.speech_stopped" });
			send({ type: "input_audio_buffer.committed", item_id: `user_${turn}` });
			send({
				type: "conversation.item.input_audio_transcription.completed",
				item_id: `user_${turn}`,
				transcript: "Welcome to the Lounge.",
				usage: transcriptionUsage(2),
			});
			send({ type: "response.created", response: { id: `response_${turn}` } });
			send({
				type: "response.output_audio.delta",
				item_id,
				content_index: 0,
				delta: data,
			});
			send({
				type: "response.output_audio_transcript.done",
				item_id,
				transcript: "Hello! Let's talk.",
			});
			later(
				() =>
					send({
						type: "response.done",
						response: {
							id: `response_${turn}`,
							status: "completed",
							usage: {
								input_tokens: 10,
								output_tokens: 20,
								total_tokens: 30,
								input_token_details: {
									audio_tokens: 10,
									text_tokens: 0,
									cached_tokens: 0,
								},
								output_token_details: { audio_tokens: 20, text_tokens: 0 },
							},
						},
					}),
				300,
			);
		};
		const commit = () => {
			if (!bufferedBytes) {
				send({ type: "error", error: { message: "No audio received." } });
				return;
			}
			turn++;
			stats.turns++;
			const itemId = `transcript_${turn}`;
			const seconds = bufferedBytes / 48000;
			bufferedBytes = 0;
			send({ type: "input_audio_buffer.committed", item_id: itemId });
			send({
				type: "conversation.item.input_audio_transcription.delta",
				item_id: itemId,
				delta: "Welcome to ",
			});
			const timer = setTimeout(() => {
				timers.delete(timer);
				send({
					type: "conversation.item.input_audio_transcription.completed",
					item_id: itemId,
					transcript: "Welcome to the Lounge.",
					usage: transcriptionUsage(seconds),
				});
			}, 1000);
			timers.add(timer);
		};
		socket.on("message", (data) => {
			try {
				if (gemini) {
					const event = z
						.object({
							setup: z.unknown().optional(),
							realtimeInput: z
								.object({
									audio: z
										.object({
											data: z.string(),
											mimeType: z.literal("audio/pcm;rate=16000"),
										})
										.optional(),
								})
								.optional(),
						})
						.parse(JSON.parse(data.toString()));
					if (event.setup !== undefined) {
						send({ setupComplete: {} });
					}
					const audio = event.realtimeInput?.audio;
					if (audio && Date.now() >= readyAt) {
						const bytes = Buffer.from(audio.data, "base64");
						if (!bytes.length || bytes.length % 2) {
							throw new Error("Expected PCM16 audio");
						}
						stats.audioBytes += bytes.length;
						bufferedBytes += bytes.length;
						if (bufferedBytes >= 64000) {
							reply();
						}
					}
					return;
				}
				const event = clientEvent.parse(JSON.parse(data.toString()));
				if (event.type === "session.update") {
					const transcription = event.session?.audio?.input?.transcription;
					if (transcription?.model) {
						const mapping = models
							.flatMap((model: ModelDefinition) => model.providers)
							.find(
								(mapping) =>
									mapping.providerId === "openai" &&
									mapping.externalId === transcription.model,
							);
						durationTranscription = mapping?.inputAudioHourPrice !== undefined;
					}
					const detection = event.session?.audio?.input?.turn_detection;
					if (detection !== undefined) {
						automatic = detection !== null;
					}
					send({ type: "session.updated", session: event.session });
				} else if (event.type === "input_audio_buffer.append" && event.audio) {
					if (Date.now() < readyAt) {
						return;
					}
					const bytes = Buffer.from(event.audio, "base64");
					if (!bytes.length || bytes.length % 2) {
						throw new Error("Expected PCM16 audio");
					}
					if (automatic && !bufferedBytes) {
						send({ type: "input_audio_buffer.speech_started" });
					}
					bufferedBytes += bytes.length;
					stats.audioBytes += bytes.length;
					if (automatic && bufferedBytes >= 96000) {
						if (voice) {
							reply();
							return;
						}
						send({ type: "input_audio_buffer.speech_stopped" });
						commit();
					}
				} else if (event.type === "input_audio_buffer.commit") {
					commit();
				} else if (event.type === "conversation.item.truncate") {
					stats.truncated++;
				} else if (event.type === "conversation.item.create") {
					stats.seeded++;
				}
			} catch (error) {
				console.error(
					"Mock realtime protocol failed",
					error instanceof Error ? error.message : "Invalid event",
				);
				socket.close(1008, "Invalid realtime event");
			}
		});
		socket.on("error", (error) =>
			console.error("Mock realtime socket failed", error.message),
		);
		socket.on("close", () => timers.forEach(clearTimeout));
		if (!gemini) {
			send({
				type: "session.created",
				session: {
					id: "mock_session",
					type: voice ? "realtime" : "transcription",
				},
			});
		}
	});
	return server;
}
