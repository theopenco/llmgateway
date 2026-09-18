import { VoiceSession } from "@/lib/voice-session";

import type { VoiceSelection } from "@/api/realtime";
import type { CallEntry } from "@/lib/call-transcript";
import type { RealtimeSocket } from "@/lib/transcription-session";

const openai: VoiceSelection = {
	model: "openai/voice",
	protocol: "openai",
	voice: "alloy",
	transcriptionModel: "openai/asr",
};
const gemini: VoiceSelection = {
	model: "google-ai-studio/voice",
	protocol: "gemini",
	voice: "Puck",
};
const pcm = "AQACAA==";
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
	const playback = {
		resume: jest.fn().mockResolvedValue(undefined),
		close: jest.fn().mockResolvedValue(undefined),
		enqueue: jest.fn(),
		flush: jest.fn(() => [
			{ itemId: "assistant", contentIndex: 0, playedMs: 250 },
		]),
		getLevel: jest.fn(() => 0),
		isPlaying: false,
	};
	const socket: RealtimeSocket = {
		readyState: 1,
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null,
		send: jest.fn(),
		close: jest.fn(),
	};
	const mint = jest.fn(async (selection: VoiceSelection) => ({
		model: selection.model,
		url: "ws://localhost/realtime",
		secret: "ephemeral",
	}));
	const connect = jest.fn(() => socket);
	const onEnded = jest.fn();
	const createMicrophone = jest.fn(() => microphone);
	const session = new VoiceSession({
		microphone: createMicrophone,
		playback: () => playback,
		mint,
		connect,
		onEnded,
	});
	const event = (event: Record<string, unknown>) =>
		socket.onmessage?.({ data: JSON.stringify(event) });
	const start = async (selection = openai, seed: CallEntry[] = []) => {
		await session.start(selection, seed);
		socket.onopen?.();
		if (selection.protocol === "openai") {
			event({ type: "session.created" });
			event({ type: "session.updated" });
		} else {
			event({ setupComplete: {} });
		}
	};
	return {
		session,
		microphone,
		playback,
		socket,
		mint,
		connect,
		onEnded,
		createMicrophone,
		event,
		start,
		audio: (level = 0.5) => audio(pcm, level),
	};
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
});

test("configures authenticated OpenAI audio and stops sending while muted", async () => {
	const h = harness();
	await h.start();
	expect(h.createMicrophone).toHaveBeenCalledWith(24000);
	expect(h.connect).toHaveBeenCalledWith("ws://localhost/realtime", [
		"realtime",
		"openai-insecure-api-key.ephemeral",
	]);
	expect(JSON.parse(jest.mocked(h.socket.send).mock.calls[0][0])).toMatchObject(
		{
			type: "session.update",
			session: {
				output_modalities: ["audio"],
				audio: {
					input: {
						format: { type: "audio/pcm", rate: 24000 },
						transcription: { model: "openai/asr" },
						turn_detection: { interrupt_response: true },
					},
					output: { voice: "alloy" },
				},
			},
		},
	);
	h.audio();
	expect(h.socket.send).toHaveBeenLastCalledWith(
		JSON.stringify({ type: "input_audio_buffer.append", audio: pcm }),
	);
	const sent = jest.mocked(h.socket.send).mock.calls.length;
	h.session.setMuted(true);
	h.audio();
	expect(h.socket.send).toHaveBeenCalledTimes(sent);
	h.session.setMuted(false);
	h.audio();
	expect(h.socket.send).toHaveBeenCalledTimes(sent + 1);
	await h.session.end();
});

test("orders user transcripts before replies, archives audio, and counts a response once", async () => {
	const h = harness();
	await h.start();
	h.event({ type: "input_audio_buffer.committed", item_id: "user" });
	h.event({
		type: "response.output_audio.delta",
		item_id: "assistant",
		delta: pcm,
	});
	h.event({
		type: "response.output_audio_transcript.delta",
		item_id: "assistant",
		delta: "Hello",
	});
	h.event({
		type: "conversation.item.input_audio_transcription.completed",
		item_id: "user",
		transcript: "Hi",
	});
	h.event({
		type: "response.output_audio_transcript.done",
		item_id: "assistant",
		transcript: "Hello!",
	});
	const done = {
		type: "response.done",
		response: {
			id: "response",
			usage: {
				input_tokens: 12,
				output_tokens: 8,
				total_tokens: 20,
				input_token_details: { audio_tokens: 10 },
				output_token_details: { audio_tokens: 7 },
			},
		},
	};
	h.event(done);
	h.event(done);
	expect(h.session.getSnapshot()).toMatchObject({
		transcript: [
			{ role: "user", text: "Hi", status: "final" },
			{
				role: "assistant",
				text: "Hello!",
				status: "final",
				audio: { mediaType: "audio/wav" },
			},
		],
		usage: {
			responses: 1,
			totalTokens: 20,
			audioInputTokens: 10,
			audioOutputTokens: 7,
		},
	});
	await jest.advanceTimersByTimeAsync(2200);
	await h.session.end();
	expect(h.onEnded).toHaveBeenCalledWith(
		expect.objectContaining({ status: "idle", elapsed: 2 }),
	);
	expect(h.microphone.stop).toHaveBeenCalledTimes(1);
	expect(h.playback.close).toHaveBeenCalledTimes(1);
});

test("barge-in truncates heard audio and suppresses late chunks of the interrupted reply", async () => {
	const h = harness();
	await h.start();
	h.event({ type: "response.created" });
	h.event({
		type: "response.output_audio.delta",
		item_id: "assistant",
		delta: pcm,
	});
	h.playback.isPlaying = true;
	h.event({ type: "input_audio_buffer.speech_started" });
	expect(h.socket.send).toHaveBeenLastCalledWith(
		JSON.stringify({
			type: "conversation.item.truncate",
			item_id: "assistant",
			content_index: 0,
			audio_end_ms: 250,
		}),
	);
	h.event({
		type: "response.output_audio.delta",
		item_id: "assistant",
		delta: pcm,
	});
	h.event({
		type: "response.output_audio_transcript.done",
		item_id: "assistant",
		transcript: "Interrupted",
	});
	expect(h.playback.enqueue).toHaveBeenCalledTimes(1);
	expect(h.session.getSnapshot().transcript[0].status).toBe("interrupted");
	h.event({ type: "response.output_audio.delta", item_id: "next", delta: pcm });
	expect(h.playback.enqueue).toHaveBeenCalledTimes(2);
	await h.session.end();
});

test("continues saved OpenAI text with correct roles without replaying clips or charging seed usage", async () => {
	const h = harness();
	const seed: CallEntry[] = [
		{ id: "old", role: "user", text: "Earlier", status: "final", timestamp: 1 },
		{
			id: "reply",
			role: "assistant",
			text: "Response",
			status: "interrupted",
			timestamp: 2,
			audio: { base64: "audio", mediaType: "audio/wav" },
		},
		{
			id: "partial",
			role: "user",
			text: "Unfinished",
			status: "partial",
			timestamp: 3,
		},
	];
	await h.start(openai, seed);
	const messages = jest
		.mocked(h.socket.send)
		.mock.calls.map(([value]) => JSON.parse(value));
	expect(messages.slice(1)).toEqual([
		{
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Earlier" }],
			},
		},
		{
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Response" }],
			},
		},
	]);
	expect(h.playback.enqueue).not.toHaveBeenCalled();
	expect(h.session.getSnapshot().usage.responses).toBe(0);
	expect(h.session.getSnapshot().transcript.map((entry) => entry.id)).toEqual([
		"seed-0",
		"seed-1",
		"seed-2",
	]);
	await h.session.end();
	await h.session.start(gemini, seed);
	expect(h.session.getSnapshot().error).toContain("cannot continue");
	expect(h.microphone.start).toHaveBeenCalledTimes(1);
});

test("cancels late minting and waits for cleanup before allowing another call", async () => {
	const h = harness();
	const minted = deferred<{ model: string; url: string; secret: string }>();
	const stopped = deferred<undefined>();
	h.mint.mockReturnValue(minted.promise);
	h.microphone.stop.mockReturnValue(stopped.promise);
	const starting = h.session.start(openai);
	await Promise.resolve();
	await Promise.resolve();
	expect(h.mint).toHaveBeenCalledTimes(1);
	const ending = h.session.end();
	await h.session.start(gemini);
	expect(h.microphone.start).toHaveBeenCalledTimes(1);
	minted.resolve({ model: "late", url: "ws://localhost", secret: "late" });
	await starting;
	expect(h.connect).not.toHaveBeenCalled();
	stopped.resolve(undefined);
	await ending;
	expect(h.session.getSnapshot().status).toBe("idle");
	expect(h.onEnded).toHaveBeenCalledTimes(1);
});

test("times out connection setup and closes native resources", async () => {
	const h = harness();
	await h.session.start(openai);
	await jest.advanceTimersByTimeAsync(20_000);
	expect(h.session.getSnapshot()).toMatchObject({
		status: "idle",
		error: expect.stringContaining("timed out"),
	});
	expect(h.socket.onmessage).toBeNull();
	expect(h.playback.close).toHaveBeenCalledTimes(1);
});

test("reports a stalled microphone even when the socket remains connected", async () => {
	const h = harness();
	await h.start();
	await jest.advanceTimersByTimeAsync(5100);
	expect(h.session.getSnapshot()).toMatchObject({
		status: "idle",
		error: expect.stringContaining("microphone stopped"),
	});
	expect(h.playback.close).toHaveBeenCalledTimes(1);
});

test("keeps the server's error when it closes the connection", async () => {
	const h = harness();
	await h.start();
	h.event({
		type: "error",
		error: { message: "The selected voice is unavailable" },
	});
	h.socket.onclose?.();
	await h.session.end();
	expect(h.session.getSnapshot().error).toBe(
		"The selected voice is unavailable",
	);
});

test("does not mark a finished reply interrupted while waiting for a new response", async () => {
	const h = harness();
	await h.start();
	h.event({
		type: "response.output_audio.delta",
		item_id: "assistant",
		delta: pcm,
	});
	h.event({
		type: "response.output_audio_transcript.done",
		item_id: "assistant",
		transcript: "Finished",
	});
	h.event({ type: "response.done", response: { id: "previous" } });
	h.event({ type: "response.created", response: { id: "next" } });
	h.event({ type: "input_audio_buffer.speech_started" });
	expect(h.session.getSnapshot().transcript[0].status).toBe("final");
	expect(
		jest
			.mocked(h.socket.send)
			.mock.calls.some(([message]) =>
				message.includes("conversation.item.truncate"),
			),
	).toBe(false);
	await h.session.end();
});

test("configures Gemini native transcription and sends 16 kHz microphone PCM", async () => {
	const h = harness();
	await h.start(gemini);
	expect(h.createMicrophone).toHaveBeenCalledWith(16000);
	expect(JSON.parse(jest.mocked(h.socket.send).mock.calls[0][0])).toMatchObject(
		{
			setup: {
				model: "google-ai-studio/voice",
				inputAudioTranscription: {},
				outputAudioTranscription: {},
				generationConfig: {
					responseModalities: ["AUDIO"],
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
					},
				},
			},
		},
	);
	h.audio();
	expect(h.socket.send).toHaveBeenLastCalledWith(
		JSON.stringify({
			realtimeInput: { audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } },
		}),
	);
	await h.session.end();
});

test("keeps late Gemini assistant text on the completed turn and plays all audio parts", async () => {
	const h = harness();
	await h.start(gemini);
	h.event({ serverContent: { inputTranscription: { text: "Hi" } } });
	h.event({
		serverContent: {
			outputTranscription: { text: "Hello" },
			modelTurn: {
				parts: [
					{ inlineData: { data: pcm, mimeType: "audio/pcm;rate=24000" } },
					{ inlineData: { data: pcm, mimeType: "audio/pcm;rate=16000" } },
				],
			},
		},
	});
	h.event({ serverContent: { turnComplete: true } });
	h.event({ serverContent: { outputTranscription: { text: " there" } } });
	expect(
		h.session
			.getSnapshot()
			.transcript.map((entry) => [entry.id, entry.text, entry.status]),
	).toEqual([
		["user-1", "Hi", "final"],
		["assistant-1", "Hello there", "final"],
	]);
	expect(h.playback.enqueue).toHaveBeenCalledTimes(2);
	h.event({
		serverContent: {
			inputTranscription: { text: "Again" },
			outputTranscription: { text: "Welcome" },
		},
	});
	expect(h.session.getSnapshot().transcript.map((entry) => entry.id)).toEqual([
		"user-1",
		"assistant-1",
		"user-2",
		"assistant-2",
	]);
	await h.session.end();
});

test("Gemini barge-in stops completed playback tails and allows the next generation", async () => {
	const h = harness();
	await h.start(gemini);
	const chunk = {
		serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm } }] } },
	};
	h.event({ serverContent: { inputTranscription: { text: "Hi" } } });
	h.event(chunk);
	h.playback.isPlaying = true;
	h.playback.flush.mockReturnValue([
		{ itemId: "assistant-1", contentIndex: 0, playedMs: 250 },
	]);
	h.audio(0.5);
	h.event(chunk);
	expect(h.playback.enqueue).toHaveBeenCalledTimes(1);
	h.event({ serverContent: { turnComplete: true } });
	h.event(chunk);
	expect(h.playback.enqueue).toHaveBeenCalledTimes(2);
	expect(
		h.session
			.getSnapshot()
			.transcript.find((entry) => entry.id === "assistant-1")?.status,
	).toBe("interrupted");
	await h.session.end();
});

test("accumulates Gemini function and response stages and settles trailing usage on close", async () => {
	const h = harness();
	await h.start(gemini);
	const usageMetadata = {
		promptTokenCount: 10,
		toolUsePromptTokenCount: 2,
		responseTokenCount: 5,
		thoughtsTokenCount: 3,
		promptTokensDetails: [{ modality: "AUDIO", tokenCount: 7 }],
		responseTokensDetails: [{ modality: "AUDIO", tokenCount: 4 }],
	};
	h.event({ usageMetadata, toolCall: {} });
	h.event({ usageMetadata, serverContent: { turnComplete: true } });
	h.event({ usageMetadata });
	h.event({ goAway: {} });
	await h.session.end();
	expect(h.session.getSnapshot().usage).toEqual({
		responses: 3,
		inputTokens: 36,
		outputTokens: 24,
		totalTokens: 60,
		audioInputTokens: 21,
		audioOutputTokens: 12,
	});
});

test("playback failure during local barge-in ends the call without leaking resources", async () => {
	const h = harness();
	await h.start(gemini);
	h.playback.isPlaying = true;
	h.playback.flush.mockImplementation(() => {
		throw new Error("Playback failed");
	});
	expect(() => h.audio()).not.toThrow();
	await h.session.end();
	expect(h.session.getSnapshot().error).toBe("Playback failed");
	expect(h.microphone.stop).toHaveBeenCalledTimes(1);
});
