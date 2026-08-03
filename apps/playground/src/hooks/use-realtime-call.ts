"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
	computeRms,
	floatToPcm16Base64,
	pcm16ChunksToWavBase64,
	RealtimePlayback,
	resampleLinear,
	rmsToLevel,
	startMicrophoneCapture,
	type MicrophoneCaptureHandles,
} from "@/lib/realtime-audio";

export type RealtimeCallStatus =
	| "idle"
	| "preparing-audio"
	| "requesting-mic"
	| "minting"
	| "connecting"
	| "configuring"
	| "live"
	| "ending";

export interface RealtimeTranscriptEntry {
	id: string;
	role: "user" | "assistant";
	text: string;
	status: "partial" | "final" | "interrupted";
	timestamp: number;
	/** Assistant speech for this turn, retained so it can be replayed. */
	audio?: { base64: string; mediaType: "audio/wav" };
}

export interface RealtimeUsageTotals {
	responses: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	audioInputTokens: number;
	audioOutputTokens: number;
}

const EMPTY_USAGE: RealtimeUsageTotals = {
	responses: 0,
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	audioInputTokens: 0,
	audioOutputTokens: 0,
};

const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
/** Meter refresh cadence — fast enough to look live, slow enough to be cheap. */
const METER_INTERVAL_MS = 80;
/** Ignore level changes below this so the meter does not re-render on noise. */
const METER_EPSILON = 0.02;
/**
 * Assistant playback drains buffer-by-buffer, so a momentary gap between
 * queued deltas would otherwise flicker the "speaking" state off and on.
 */
const SPEAKING_HOLD_MS = 300;
/**
 * Ceiling on retained assistant PCM for one call (~8 minutes of speech at
 * 24kHz mono PCM16). Past it, audio capture stops for the rest of the call so
 * a long conversation cannot grow an unbounded in-memory buffer or an
 * unsendable save payload; the transcript text is still recorded in full. A
 * continued call starts with its seeded turns' audio already counted, so
 * repeated continuations cannot grow one saved conversation past this budget
 * either.
 */
const MAX_CALL_AUDIO_BYTES = 24 * 1024 * 1024;

interface UseRealtimeCallOptions {
	model: string | null;
	voice: string | null;
	onCallError?: (message: string) => void;
}

interface MintResponse {
	client_secret: string;
	expires_at?: number;
	transcription_model?: string;
	ws_url: string;
}

function readCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function useRealtimeCall({
	model,
	voice,
	onCallError,
}: UseRealtimeCallOptions) {
	const [status, setStatus] = useState<RealtimeCallStatus>("idle");
	const [muted, setMutedState] = useState(false);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [transcript, setTranscript] = useState<RealtimeTranscriptEntry[]>([]);
	const [usage, setUsage] = useState<RealtimeUsageTotals>(EMPTY_USAGE);
	const [userSpeaking, setUserSpeaking] = useState(false);
	const [assistantSpeaking, setAssistantSpeaking] = useState(false);
	const [inputLevel, setInputLevel] = useState(0);
	const [outputLevel, setOutputLevel] = useState(0);

	const statusRef = useRef<RealtimeCallStatus>("idle");
	const mutedRef = useRef(false);
	const callIdRef = useRef(0);
	const audioContextRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const captureRef = useRef<MicrophoneCaptureHandles | null>(null);
	const playbackRef = useRef<RealtimePlayback | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const inputLevelRef = useRef(0);
	const speakingUntilRef = useRef(0);
	const responseActiveRef = useRef(false);
	const transcriptionModelRef = useRef<string | null>(null);
	/** Base64 PCM deltas per in-progress assistant item, pending WAV encoding. */
	const audioChunksRef = useRef(new Map<string, string[]>());
	const audioBytesRef = useRef(0);
	const seedRef = useRef<RealtimeTranscriptEntry[] | null>(null);
	const voiceRef = useRef<string | null>(voice);
	voiceRef.current = voice;
	const onCallErrorRef = useRef(onCallError);
	onCallErrorRef.current = onCallError;

	const updateStatus = useCallback((next: RealtimeCallStatus) => {
		statusRef.current = next;
		setStatus(next);
	}, []);

	const sendEvent = useCallback((event: Record<string, unknown>) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return;
		}
		ws.send(JSON.stringify(event));
	}, []);

	/**
	 * Sample both meters on one timer so a live call costs a bounded number of
	 * renders per second regardless of how fast audio chunks arrive.
	 */
	const startMeterLoop = useCallback(() => {
		if (meterTimerRef.current) {
			return;
		}
		meterTimerRef.current = setInterval(() => {
			const nextInput = inputLevelRef.current;
			setInputLevel((prev) =>
				Math.abs(prev - nextInput) >= METER_EPSILON || nextInput === 0
					? nextInput
					: prev,
			);

			const playback = playbackRef.current;
			const nextOutput = playback?.getLevel() ?? 0;
			setOutputLevel((prev) =>
				Math.abs(prev - nextOutput) >= METER_EPSILON || nextOutput === 0
					? nextOutput
					: prev,
			);

			const now = Date.now();
			if (playback?.isPlaying) {
				speakingUntilRef.current = now + SPEAKING_HOLD_MS;
			}
			setAssistantSpeaking(speakingUntilRef.current > now);
		}, METER_INTERVAL_MS);
	}, []);

	/**
	 * Encode every finished item's buffered PCM into a WAV and hang it off the
	 * matching transcript entry. This runs at response.done rather than at the
	 * transcript's own done event because audio deltas can still trail the
	 * transcript. An interrupted turn keeps every delta that arrived — a little
	 * more than the listener actually heard, but the entry already reads as
	 * interrupted, and truncating to the played duration would cost a decode
	 * pass for no real gain.
	 */
	const finalizeResponseAudio = useCallback(() => {
		const pending = audioChunksRef.current;
		if (pending.size === 0) {
			return;
		}
		const encoded = new Map<string, string>();
		pending.forEach((chunks, itemId) => {
			if (chunks.length > 0) {
				encoded.set(itemId, pcm16ChunksToWavBase64(chunks));
			}
		});
		pending.clear();
		if (encoded.size === 0) {
			return;
		}
		setTranscript((prev) =>
			prev.map((entry) => {
				const base64 =
					entry.role === "assistant" ? encoded.get(entry.id) : undefined;
				return base64
					? { ...entry, audio: { base64, mediaType: "audio/wav" as const } }
					: entry;
			}),
		);
	}, []);

	/**
	 * Tear down every media/audio/network resource. Safe to call from any
	 * state and idempotent per call attempt.
	 */
	const cleanup = useCallback(() => {
		callIdRef.current += 1;
		if (elapsedTimerRef.current) {
			clearInterval(elapsedTimerRef.current);
			elapsedTimerRef.current = null;
		}
		if (meterTimerRef.current) {
			clearInterval(meterTimerRef.current);
			meterTimerRef.current = null;
		}
		inputLevelRef.current = 0;
		speakingUntilRef.current = 0;
		setInputLevel(0);
		setOutputLevel(0);
		setUserSpeaking(false);
		setAssistantSpeaking(false);
		captureRef.current?.stop();
		captureRef.current = null;
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		playbackRef.current?.flush();
		playbackRef.current = null;
		const ws = wsRef.current;
		wsRef.current = null;
		if (ws) {
			ws.onopen = null;
			ws.onmessage = null;
			ws.onerror = null;
			ws.onclose = null;
			try {
				ws.close(1000);
			} catch {
				// Already closed.
			}
		}
		const context = audioContextRef.current;
		audioContextRef.current = null;
		if (context && context.state !== "closed") {
			void context.close().catch(() => {});
		}
		responseActiveRef.current = false;
		// Ending mid-response: encode whatever assistant audio is already
		// buffered so the final turn keeps its replay clip instead of losing
		// it with the buffers.
		finalizeResponseAudio();
		audioChunksRef.current.clear();
		audioBytesRef.current = 0;
		seedRef.current = null;
		updateStatus("idle");
	}, [finalizeResponseAudio, updateStatus]);

	const failCall = useCallback(
		(message: string) => {
			cleanup();
			onCallErrorRef.current?.(message);
		},
		[cleanup],
	);

	const markAssistantInterrupted = useCallback((itemId: string) => {
		setTranscript((prev) =>
			prev.map((entry) =>
				entry.id === itemId && entry.role === "assistant"
					? { ...entry, status: "interrupted" }
					: entry,
			),
		);
	}, []);

	const upsertTranscript = useCallback(
		(
			itemId: string,
			role: "user" | "assistant",
			update: (previousText: string) => string,
			entryStatus: RealtimeTranscriptEntry["status"],
		) => {
			setTranscript((prev) => {
				const index = prev.findIndex(
					(entry) => entry.id === itemId && entry.role === role,
				);
				if (index === -1) {
					return [
						...prev,
						{
							id: itemId,
							role,
							text: update(""),
							status: entryStatus,
							timestamp: Date.now(),
						},
					];
				}
				const existing = prev[index];
				const next = [...prev];
				next[index] = {
					...existing,
					text: update(existing.text),
					// An interruption is terminal for the visible entry.
					status:
						existing.status === "interrupted" ? "interrupted" : entryStatus,
				};
				return next;
			});
		},
		[],
	);

	const handleBargeIn = useCallback(() => {
		const playback = playbackRef.current;
		if (!playback) {
			return;
		}
		if (!playback.isPlaying && !responseActiveRef.current) {
			return;
		}
		// Stop local playback immediately, then tell the server how much the
		// user actually heard so its conversation history matches. With
		// interrupt_response enabled, server VAD cancels the active response
		// itself — no duplicate response.cancel is sent.
		const { itemId, contentIndex, playedMs } = playback.flush();
		if (itemId) {
			sendEvent({
				type: "conversation.item.truncate",
				item_id: itemId,
				content_index: contentIndex,
				audio_end_ms: playedMs,
			});
			markAssistantInterrupted(itemId);
		}
	}, [markAssistantInterrupted, sendEvent]);

	const handleServerEvent = useCallback(
		(event: Record<string, unknown>) => {
			const type = typeof event.type === "string" ? event.type : "";
			switch (type) {
				case "session.created": {
					// Configure the session; the call is not live until the matching
					// session.updated echo arrives.
					updateStatus("configuring");
					const session: Record<string, unknown> = {
						type: "realtime",
						output_modalities: ["audio"],
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24000 },
								...(transcriptionModelRef.current
									? {
											transcription: {
												model: transcriptionModelRef.current,
											},
										}
									: {}),
								turn_detection: {
									type: "semantic_vad",
									create_response: true,
									interrupt_response: true,
								},
							},
							output: {
								format: { type: "audio/pcm", rate: 24000 },
								...(voiceRef.current ? { voice: voiceRef.current } : {}),
							},
						},
					};
					sendEvent({ type: "session.update", session });
					return;
				}
				case "session.updated":
					if (statusRef.current === "configuring") {
						// Replay a continued call's prior turns before going live, so the
						// model has the earlier conversation in context. Fire-and-forget
						// is safe: microphone chunks are dropped until the status flips
						// to "live" below, so nothing can race ahead of the seed, and a
						// rejected item surfaces through the server's "error" event like
						// any other session fault. Only the text is replayed — the
						// realtime API cannot accept assistant audio items — and the
						// content type is the role's side of the GA enum: input_text for
						// user, output_text for assistant. Interrupted turns are replayed
						// in full: the heard-text boundary is unknowable client-side, and
						// the full text is what the transcript already shows the user.
						const seed = seedRef.current;
						seedRef.current = null;
						for (const entry of seed ?? []) {
							if (entry.status === "partial" || !entry.text.trim()) {
								continue;
							}
							sendEvent({
								type: "conversation.item.create",
								item: {
									type: "message",
									role: entry.role,
									content: [
										{
											type:
												entry.role === "user" ? "input_text" : "output_text",
											text: entry.text,
										},
									],
								},
							});
						}
						updateStatus("live");
						setElapsedSeconds(0);
						const startedAt = Date.now();
						elapsedTimerRef.current = setInterval(() => {
							setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
						}, 1000);
						startMeterLoop();
					}
					return;
				case "response.created":
					responseActiveRef.current = true;
					return;
				case "response.done": {
					responseActiveRef.current = false;
					finalizeResponseAudio();
					const response =
						event.response && typeof event.response === "object"
							? (event.response as Record<string, unknown>)
							: undefined;
					const rawUsage =
						response?.usage && typeof response.usage === "object"
							? (response.usage as Record<string, unknown>)
							: undefined;
					if (rawUsage) {
						const inputDetails =
							rawUsage.input_token_details &&
							typeof rawUsage.input_token_details === "object"
								? (rawUsage.input_token_details as Record<string, unknown>)
								: {};
						const outputDetails =
							rawUsage.output_token_details &&
							typeof rawUsage.output_token_details === "object"
								? (rawUsage.output_token_details as Record<string, unknown>)
								: {};
						setUsage((prev) => ({
							responses: prev.responses + 1,
							inputTokens: prev.inputTokens + readCount(rawUsage.input_tokens),
							outputTokens:
								prev.outputTokens + readCount(rawUsage.output_tokens),
							totalTokens: prev.totalTokens + readCount(rawUsage.total_tokens),
							audioInputTokens:
								prev.audioInputTokens + readCount(inputDetails.audio_tokens),
							audioOutputTokens:
								prev.audioOutputTokens + readCount(outputDetails.audio_tokens),
						}));
					}
					return;
				}
				case "response.output_audio.delta": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const delta = typeof event.delta === "string" ? event.delta : null;
					const contentIndex =
						typeof event.content_index === "number" ? event.content_index : 0;
					if (itemId && delta) {
						playbackRef.current?.enqueue(itemId, contentIndex, delta);
						if (audioBytesRef.current < MAX_CALL_AUDIO_BYTES) {
							audioBytesRef.current += Math.ceil((delta.length * 3) / 4);
							const chunks = audioChunksRef.current.get(itemId);
							if (chunks) {
								chunks.push(delta);
							} else {
								audioChunksRef.current.set(itemId, [delta]);
							}
							if (audioBytesRef.current >= MAX_CALL_AUDIO_BYTES) {
								// Over budget: drop what is still buffered, including this
								// half-captured item, rather than save a truncated clip.
								audioChunksRef.current.clear();
							}
						}
					}
					return;
				}
				case "response.output_audio_transcript.delta": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (itemId) {
						upsertTranscript(
							itemId,
							"assistant",
							(previous) => previous + delta,
							"partial",
						);
					}
					return;
				}
				case "response.output_audio_transcript.done": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const text =
						typeof event.transcript === "string" ? event.transcript : null;
					if (itemId) {
						upsertTranscript(
							itemId,
							"assistant",
							(previous) => text ?? previous,
							"final",
						);
					}
					return;
				}
				case "conversation.item.input_audio_transcription.delta": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (itemId) {
						upsertTranscript(
							itemId,
							"user",
							(previous) => previous + delta,
							"partial",
						);
					}
					return;
				}
				case "conversation.item.input_audio_transcription.completed": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const text =
						typeof event.transcript === "string" ? event.transcript : null;
					if (itemId) {
						upsertTranscript(
							itemId,
							"user",
							(previous) => text ?? previous,
							"final",
						);
					}
					return;
				}
				case "input_audio_buffer.speech_started":
					// Server-side VAD is the authoritative "we hear you" signal: it is
					// what actually decides when a turn is captured.
					setUserSpeaking(true);
					handleBargeIn();
					return;
				case "input_audio_buffer.speech_stopped":
				case "input_audio_buffer.committed":
					setUserSpeaking(false);
					return;
				case "error": {
					const error =
						event.error && typeof event.error === "object"
							? (event.error as Record<string, unknown>)
							: undefined;
					const message =
						typeof error?.message === "string"
							? error.message
							: "The realtime session reported an error.";
					onCallErrorRef.current?.(message);
					break;
				}
				default:
			}
		},
		[
			finalizeResponseAudio,
			handleBargeIn,
			sendEvent,
			startMeterLoop,
			updateStatus,
			upsertTranscript,
		],
	);

	const runStart = useCallback(
		async (context: AudioContext, callId: number) => {
			const isStale = () => callIdRef.current !== callId;
			const currentModel = model;
			if (!currentModel) {
				failCall("Select a realtime model first.");
				return;
			}

			updateStatus("requesting-mic");
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						channelCount: 1,
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
				});
			} catch {
				if (!isStale()) {
					failCall(
						"Microphone access was denied. Allow microphone access to start a call.",
					);
				}
				return;
			}
			if (isStale()) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				return;
			}
			streamRef.current = stream;

			updateStatus("minting");
			let mint: MintResponse;
			try {
				const response = await fetch("/api/realtime/session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model: currentModel }),
				});
				if (!response.ok) {
					const data = (await response.json().catch(() => null)) as {
						error?: string;
					} | null;
					throw new Error(
						data?.error ?? `Failed to start the call (HTTP ${response.status})`,
					);
				}
				mint = (await response.json()) as MintResponse;
			} catch (error) {
				if (!isStale()) {
					failCall(
						error instanceof Error
							? error.message
							: "Failed to start the call.",
					);
				}
				return;
			}
			if (isStale()) {
				return;
			}
			if (!mint.client_secret || !mint.ws_url) {
				failCall("The call setup response was invalid.");
				return;
			}
			transcriptionModelRef.current = mint.transcription_model ?? null;

			updateStatus("connecting");
			// The secret travels only in the official credential subprotocol —
			// never in the URL, where it would leak into logs and proxies.
			const wsUrl = `${mint.ws_url}?model=${encodeURIComponent(currentModel)}`;
			let ws: WebSocket;
			try {
				ws = new WebSocket(wsUrl, [
					"realtime",
					`openai-insecure-api-key.${mint.client_secret}`,
				]);
			} catch {
				failCall("Could not open the realtime connection.");
				return;
			}
			wsRef.current = ws;
			playbackRef.current = new RealtimePlayback(context);

			let opened = false;
			ws.onopen = () => {
				opened = true;
			};
			ws.onmessage = (messageEvent: MessageEvent) => {
				if (isStale()) {
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(String(messageEvent.data));
				} catch {
					return;
				}
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					handleServerEvent(parsed as Record<string, unknown>);
				}
			};
			ws.onclose = () => {
				if (isStale()) {
					return;
				}
				if (statusRef.current === "ending" || statusRef.current === "idle") {
					return;
				}
				// Browsers hide handshake failure details, and a second mint cannot
				// diagnose an upgrade-time failure — surface a generic error.
				failCall(
					opened
						? "The call ended unexpectedly."
						: "Could not connect to the realtime service. Check your credits and try again.",
				);
			};
			ws.onerror = () => {
				// onclose fires next and carries the user-facing handling.
			};

			// Start streaming microphone audio; chunks are dropped until the call
			// is live (session.updated received) or while muted, and under
			// network backpressure rather than building an unbounded queue.
			try {
				captureRef.current = await startMicrophoneCapture(
					context,
					stream,
					(samples) => {
						const socket = wsRef.current;
						const capturing = statusRef.current === "live" && !mutedRef.current;
						// Metered before the send guards so the level still reflects a
						// dropped chunk, and reads zero the moment the mic is muted.
						inputLevelRef.current = capturing
							? rmsToLevel(computeRms(samples))
							: 0;
						if (
							!capturing ||
							!socket ||
							socket.readyState !== WebSocket.OPEN ||
							socket.bufferedAmount > MAX_WS_BUFFERED_BYTES
						) {
							return;
						}
						const resampled = resampleLinear(samples, context.sampleRate);
						socket.send(
							JSON.stringify({
								type: "input_audio_buffer.append",
								audio: floatToPcm16Base64(resampled),
							}),
						);
					},
				);
			} catch {
				if (!isStale()) {
					failCall("Could not initialize microphone processing.");
				}
			}
		},
		[failCall, handleServerEvent, model, updateStatus],
	);

	/** Clear the finished call from view. No-op while a call is in progress. */
	const reset = useCallback(() => {
		if (statusRef.current !== "idle") {
			return;
		}
		setTranscript([]);
		setUsage(EMPTY_USAGE);
		setElapsedSeconds(0);
		audioChunksRef.current.clear();
		audioBytesRef.current = 0;
	}, []);

	/**
	 * Begin a call. A seed continues an earlier conversation: its entries are
	 * shown immediately (audio included, so they stay playable) and replayed to
	 * the model once the session is configured.
	 */
	const start = useCallback(
		(seed?: RealtimeTranscriptEntry[]) => {
			if (statusRef.current !== "idle" || !model) {
				return;
			}
			reset();
			seedRef.current = seed?.length ? seed : null;
			if (seed?.length) {
				setTranscript(seed);
				// Seeded audio counts toward the call's audio budget (see
				// MAX_CALL_AUDIO_BYTES); base64 decodes to 3/4 of its length.
				audioBytesRef.current = seed.reduce(
					(total, entry) =>
						entry.audio
							? total + Math.ceil((entry.audio.base64.length * 3) / 4)
							: total,
					0,
				);
			}
			// The AudioContext must be created and resumed synchronously inside the
			// click gesture (before any await) or Safari drops the user activation.
			const context = new AudioContext();
			void context.resume().catch(() => {});
			audioContextRef.current = context;
			updateStatus("preparing-audio");
			const callId = callIdRef.current;
			void runStart(context, callId);
		},
		[model, reset, runStart, updateStatus],
	);

	const end = useCallback(() => {
		if (statusRef.current === "idle") {
			return;
		}
		updateStatus("ending");
		cleanup();
	}, [cleanup, updateStatus]);

	const setMuted = useCallback((next: boolean) => {
		mutedRef.current = next;
		setMutedState(next);
		if (next) {
			inputLevelRef.current = 0;
			setInputLevel(0);
			setUserSpeaking(false);
		}
	}, []);

	// Unmount safety net: never leave the mic or socket running.
	useEffect(() => {
		return () => {
			cleanup();
		};
	}, [cleanup]);

	return {
		status,
		muted,
		setMuted,
		elapsedSeconds,
		transcript,
		usage,
		userSpeaking,
		assistantSpeaking,
		inputLevel,
		outputLevel,
		start,
		end,
		reset,
	};
}
