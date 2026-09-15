import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { z } from "zod";

const clientEvent = z.object({
	type: z.string(),
	audio: z.string().optional(),
	session: z
		.object({
			audio: z
				.object({
					input: z
						.object({ turn_detection: z.unknown().optional() })
						.optional(),
				})
				.optional(),
		})
		.optional(),
});

/** Local upstream for native microphone/protocol tests; audio never leaves this process. */
export function startMockRealtimeServer(port: number, httpBaseUrl: string) {
	const stats = { connections: 0, audioBytes: 0, turns: 0 };
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
	sockets.on("connection", (socket) => {
		stats.connections++;
		let automatic = false;
		let bufferedBytes = 0;
		let turn = 0;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const send = (event: Record<string, unknown>) => {
			if (socket.readyState === 1) {
				socket.send(JSON.stringify(event));
			}
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
					usage: {
						type: "tokens",
						input_tokens: Math.ceil(seconds * 50),
						output_tokens: 6,
						total_tokens: Math.ceil(seconds * 50) + 6,
						input_token_details: {
							audio_tokens: Math.ceil(seconds * 50),
							text_tokens: 0,
						},
					},
				});
			}, 1000);
			timers.add(timer);
		};
		socket.on("message", (data) => {
			try {
				const event = clientEvent.parse(JSON.parse(data.toString()));
				if (event.type === "session.update") {
					const detection = event.session?.audio?.input?.turn_detection;
					if (detection !== undefined) {
						automatic = detection !== null;
					}
					send({ type: "session.updated", session: event.session });
				} else if (event.type === "input_audio_buffer.append" && event.audio) {
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
						send({ type: "input_audio_buffer.speech_stopped" });
						commit();
					}
				} else if (event.type === "input_audio_buffer.commit") {
					commit();
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
		send({
			type: "session.created",
			session: { id: "mock_session", type: "transcription" },
		});
	});
	return server;
}
