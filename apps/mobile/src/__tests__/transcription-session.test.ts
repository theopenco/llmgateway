import { TranscriptionSession } from "@/lib/transcription-session";

import type { RealtimeSocket } from "@/lib/transcription-session";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function harness() {
	let audio: (data: string, level: number) => void = () => {
		throw new Error("Microphone not started");
	};
	const microphone = {
		start: jest.fn(async (callback: typeof audio) => {
			audio = callback;
		}),
		stop: jest.fn().mockResolvedValue(undefined),
	};
	const socket: RealtimeSocket = {
		readyState: 1,
		bufferedAmount: 0,
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null,
		send: jest.fn(),
		close: jest.fn(),
	};
	const mint = jest.fn().mockResolvedValue({
		secret: "ephemeral",
		url: "ws://localhost/realtime",
		model: "openai/asr",
	});
	const connect = jest.fn(() => socket);
	const session = new TranscriptionSession({
		microphone: () => microphone,
		mint,
		connect,
	});
	const event = (type: string, fields: Record<string, unknown> = {}) =>
		socket.onmessage?.({ data: JSON.stringify({ type, ...fields }) });
	const start = async (manual = true) => {
		await session.start("openai/asr", manual);
		socket.onopen?.();
		event("session.created");
		event("session.updated");
	};
	return {
		session,
		socket,
		microphone,
		mint,
		connect,
		event,
		start,
		audio: (level = 0.5) => audio("AQACAA==", level),
	};
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
});

test("authenticates through a subprotocol, configures PCM, and drops muted audio", async () => {
	const h = harness();
	await h.start();
	expect(h.connect).toHaveBeenCalledWith("ws://localhost/realtime", [
		"realtime",
		"openai-insecure-api-key.ephemeral",
	]);
	expect(h.socket.send).toHaveBeenCalledWith(
		JSON.stringify({
			type: "session.update",
			session: {
				type: "transcription",
				audio: {
					input: {
						format: { type: "audio/pcm", rate: 24000 },
						transcription: { model: "openai/asr" },
						turn_detection: null,
					},
				},
			},
		}),
	);
	h.audio();
	expect(h.session.getSnapshot().uncommitted).toBe(true);
	const sent = jest.mocked(h.socket.send).mock.calls.length;
	h.session.setMuted(true);
	h.audio();
	expect(h.socket.send).toHaveBeenCalledTimes(sent);
	expect(h.session.getSnapshot().level).toBe(0);
	h.session.setMuted(false);
	h.audio();
	expect(h.socket.send).toHaveBeenCalledTimes(sent + 1);
	await h.session.finish();
});

test("stops microphone immediately and waits for the last committed transcript", async () => {
	const h = harness();
	await h.start();
	h.audio();
	h.session.stop();
	expect(h.microphone.stop).toHaveBeenCalledTimes(1);
	expect(h.session.getSnapshot().status).toBe("ending");
	expect(h.socket.send).toHaveBeenLastCalledWith(
		'{"type":"input_audio_buffer.commit"}',
	);
	expect(h.socket.close).not.toHaveBeenCalled();
	h.event("input_audio_buffer.committed", { item_id: "one" });
	h.event("conversation.item.input_audio_transcription.delta", {
		item_id: "one",
		delta: "Hello",
	});
	expect(h.session.getSnapshot().segments[0].text).toBe("Hello");
	h.event("conversation.item.input_audio_transcription.completed", {
		item_id: "one",
		transcript: "Hello world.",
		usage: { input_tokens: 4, output_tokens: 3 },
	});
	await h.session.finish();
	expect(h.session.getSnapshot()).toMatchObject({
		status: "idle",
		segments: [{ text: "Hello world.", status: "complete" }],
		usage: { segments: 1, inputTokens: 4, outputTokens: 3 },
	});
	expect(h.microphone.stop).toHaveBeenCalledTimes(1);
});

test("keeps manual audio recorded while a previous commit is acknowledged", async () => {
	const h = harness();
	await h.start();
	h.audio();
	h.session.commit();
	h.audio();
	h.event("input_audio_buffer.committed", { item_id: "one" });
	expect(h.session.getSnapshot().uncommitted).toBe(true);
	h.session.stop();
	expect(
		jest
			.mocked(h.socket.send)
			.mock.calls.filter(([data]) =>
				data.includes("input_audio_buffer.commit"),
			),
	).toHaveLength(2);
	await h.session.finish();
});

test("waits for automatic speech detection's pending commit and isolates segment failures", async () => {
	const h = harness();
	await h.start(false);
	h.event("input_audio_buffer.speech_started");
	h.event("input_audio_buffer.speech_stopped");
	h.session.stop();
	expect(h.socket.close).not.toHaveBeenCalled();
	h.event("input_audio_buffer.committed", { item_id: "one" });
	h.event("conversation.item.input_audio_transcription.delta", {
		item_id: "one",
		delta: "Kept partial",
	});
	h.event("conversation.item.input_audio_transcription.failed", {
		item_id: "one",
		error: { message: "Unable to transcribe" },
	});
	await h.session.finish();
	expect(h.session.getSnapshot().segments).toEqual([
		{
			id: "one",
			text: "Kept partial",
			status: "failed",
			error: "Unable to transcribe",
		},
	]);
});

test("cancels minting without opening a socket and waits for microphone cleanup before restarting", async () => {
	const h = harness();
	const minted = deferred<{ secret: string; url: string; model: string }>();
	const stopped = deferred<undefined>();
	h.mint.mockReturnValue(minted.promise);
	h.microphone.stop.mockReturnValue(stopped.promise);
	const starting = h.session.start("asr", true);
	await Promise.resolve();
	h.session.stop();
	await h.session.start("another", true);
	expect(h.microphone.start).toHaveBeenCalledTimes(1);
	minted.resolve({ secret: "late", model: "asr", url: "ws://localhost" });
	await starting;
	expect(h.connect).not.toHaveBeenCalled();
	stopped.resolve(undefined);
	await h.session.finish();
	expect(h.session.getSnapshot().status).toBe("idle");
});

test("bounds finalization time and preserves incomplete text", async () => {
	const h = harness();
	await h.start();
	h.event("conversation.item.input_audio_transcription.delta", {
		item_id: "one",
		delta: "Partial",
	});
	h.session.stop();
	await jest.advanceTimersByTimeAsync(5000);
	expect(h.session.getSnapshot()).toMatchObject({
		status: "idle",
		segments: [{ text: "Partial" }],
		error: expect.stringContaining("final transcript"),
	});
});

test("can force-stop finalization and ignores duplicate completed events", async () => {
	const h = harness();
	await h.start();
	const fields = { item_id: "one", transcript: "Done", usage: { seconds: 2 } };
	h.event("conversation.item.input_audio_transcription.completed", fields);
	h.event("conversation.item.input_audio_transcription.completed", fields);
	expect(h.session.getSnapshot().usage).toMatchObject({
		segments: 1,
		seconds: 2,
	});
	h.audio();
	h.session.stop();
	h.session.stop();
	await h.session.finish();
	expect(h.socket.close).toHaveBeenCalledTimes(1);
	h.session.reset();
	expect(h.session.getSnapshot().segments).toEqual([]);
});

test("fails closed on malformed events or sustained socket congestion", async () => {
	const h = harness();
	await h.start();
	h.socket.onmessage?.({ data: "not JSON" });
	await h.session.finish();
	expect(h.session.getSnapshot().error).toContain("unreadable");
	await h.start();
	h.socket.bufferedAmount = 2 * 1024 * 1024;
	h.audio();
	jest.advanceTimersByTime(3100);
	h.audio();
	await h.session.finish();
	expect(h.session.getSnapshot().error).toContain("too slow");
});

test("submits trailing manual audio after an in-flight commit finishes during stop", async () => {
	const h = harness();
	await h.start();
	h.audio();
	h.session.commit();
	h.audio();
	h.session.stop();
	h.event("input_audio_buffer.committed", { item_id: "one" });
	expect(
		jest
			.mocked(h.socket.send)
			.mock.calls.filter(([data]) =>
				data.includes("input_audio_buffer.commit"),
			),
	).toHaveLength(2);
	h.event("conversation.item.input_audio_transcription.completed", {
		item_id: "one",
		transcript: "First",
	});
	expect(h.socket.close).not.toHaveBeenCalled();
	h.event("input_audio_buffer.committed", { item_id: "two" });
	h.event("conversation.item.input_audio_transcription.completed", {
		item_id: "two",
		transcript: "Last",
	});
	await h.session.finish();
	expect(
		h.session.getSnapshot().segments.map((segment) => segment.text),
	).toEqual(["First", "Last"]);
});
