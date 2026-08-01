"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
	computeRms,
	floatToPcm16Base64,
	RealtimePlayback,
	resampleLinear,
	rmsToLevel,
	startMicrophoneCapture,
	type MicrophoneCaptureHandles,
} from "@/lib/realtime-audio";

import type {
	RealtimeCallStatus,
	RealtimeTranscriptEntry,
	RealtimeUsageTotals,
} from "@/hooks/use-realtime-call";

const EMPTY_USAGE: RealtimeUsageTotals = {
	responses: 0,
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	audioInputTokens: 0,
	audioOutputTokens: 0,
};

const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const METER_INTERVAL_MS = 80;
const METER_EPSILON = 0.02;
const SPEAKING_HOLD_MS = 300;

/** Gemini Live expects 16kHz PCM16 input and emits 24kHz PCM16 output. */
const GEMINI_INPUT_SAMPLE_RATE = 16000;

/**
 * Local voice-activity thresholds. Gemini's VAD runs server-side and reports
 * no speech-started event, so the "you are talking" indicator is derived from
 * the microphone level with hysteresis: rising past ON marks speech, and it
 * only clears after the level stays under OFF for the hold window.
 */
const SPEECH_ON_LEVEL = 0.2;
const SPEECH_OFF_LEVEL = 0.12;
const SPEECH_OFF_HOLD_MS = 500;

interface UseGeminiRealtimeCallOptions {
	model: string | null;
	voice: string | null;
	onCallError?: (message: string) => void;
}

interface MintResponse {
	client_secret: string;
	expires_at?: number;
	ws_url: string;
}

function readCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Total tokens carried by a Gemini `*TokensDetails` array for one modality.
 */
function sumModality(rawDetails: unknown, modality: string): number {
	if (!Array.isArray(rawDetails)) {
		return 0;
	}
	return rawDetails.reduce((total: number, rawEntry) => {
		const entry = asObject(rawEntry);
		return entry?.modality === modality
			? total + readCount(entry.tokenCount)
			: total;
	}, 0);
}

/**
 * A live Gemini Live call, driven over Gemini's native BidiGenerateContent
 * protocol. Returns the same shape as the OpenAI realtime hook so the call UI
 * does not need to know which provider is serving the session.
 */
export function useGeminiRealtimeCall({
	model,
	voice,
	onCallError,
}: UseGeminiRealtimeCallOptions) {
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
	const userSpeakingRef = useRef(false);
	const userQuietSinceRef = useRef(0);
	// Gemini carries no item ids, so conversational turns are numbered locally
	// and the transcript entries are keyed by those synthetic ids.
	const turnCounterRef = useRef(0);
	const userTurnIdRef = useRef<string | null>(null);
	const assistantTurnIdRef = useRef<string | null>(null);
	// A finished turn stays addressable until the next user input starts, so
	// transcription chunks that arrive after turnComplete still land on it.
	const turnClosedRef = useRef(true);
	// Set when the listener speaks over the assistant: audio still arriving for
	// the generation that was cut off is dropped rather than played. Suppression
	// is tracked per generation, not per turn id, because a finished turn keeps
	// its assistant id until the next user input opens a new one — an id cannot
	// tell the interrupted generation from the one answering next.
	const audioSuppressedRef = useRef(false);
	// Whether a generation is streaming: set by its first modelTurn, cleared by
	// the turnComplete or interruption that ends it.
	const generationOpenRef = useRef(false);
	const pendingUsageRef = useRef<Record<string, unknown> | null>(null);
	const voiceRef = useRef<string | null>(voice);
	voiceRef.current = voice;
	const onCallErrorRef = useRef(onCallError);
	onCallErrorRef.current = onCallError;

	const updateStatus = useCallback((next: RealtimeCallStatus) => {
		statusRef.current = next;
		setStatus(next);
	}, []);

	const sendMessage = useCallback((message: Record<string, unknown>) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return;
		}
		ws.send(JSON.stringify(message));
	}, []);

	const markAssistantInterrupted = useCallback(() => {
		const itemId = assistantTurnIdRef.current;
		if (!itemId) {
			return;
		}
		setTranscript((prev) =>
			prev.map((entry) =>
				entry.id === itemId && entry.role === "assistant"
					? { ...entry, status: "interrupted" }
					: entry,
			),
		);
	}, []);

	/**
	 * Stop assistant playback immediately and refuse any further audio for the
	 * turn that was cut off. Suppression matters because the provider may still
	 * be streaming the rest of that turn: without it, playback would restart a
	 * few hundred milliseconds after the listener spoke over it.
	 */
	const bargeIn = useCallback(() => {
		const playback = playbackRef.current;
		if (!playback?.isPlaying) {
			return;
		}
		playback.flush();
		audioSuppressedRef.current = true;
		markAssistantInterrupted();
	}, [markAssistantInterrupted]);

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
			if (userSpeakingRef.current) {
				if (nextInput >= SPEECH_OFF_LEVEL) {
					userQuietSinceRef.current = 0;
				} else {
					userQuietSinceRef.current ||= now;
					if (now - userQuietSinceRef.current >= SPEECH_OFF_HOLD_MS) {
						userSpeakingRef.current = false;
					}
				}
			} else if (nextInput >= SPEECH_ON_LEVEL) {
				userSpeakingRef.current = true;
				userQuietSinceRef.current = 0;
				// Rising edge of local speech: cut playback here rather than waiting
				// for the provider to say it was interrupted. Gemini streams a turn's
				// audio far faster than real time, so by the time the listener talks
				// over the tail the generation is usually already complete — there is
				// nothing left for the provider to interrupt, and no `interrupted`
				// message will ever arrive.
				bargeIn();
			}
			setUserSpeaking(userSpeakingRef.current);

			if (playback?.isPlaying) {
				speakingUntilRef.current = now + SPEAKING_HOLD_MS;
			}
			setAssistantSpeaking(speakingUntilRef.current > now);
		}, METER_INTERVAL_MS);
	}, [bargeIn]);

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
		userSpeakingRef.current = false;
		userQuietSinceRef.current = 0;
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
		pendingUsageRef.current = null;
		userTurnIdRef.current = null;
		assistantTurnIdRef.current = null;
		audioSuppressedRef.current = false;
		generationOpenRef.current = false;
		turnClosedRef.current = true;
		updateStatus("idle");
	}, [updateStatus]);

	const failCall = useCallback(
		(message: string) => {
			cleanup();
			onCallErrorRef.current?.(message);
		},
		[cleanup],
	);

	const appendTranscript = useCallback(
		(
			itemId: string,
			role: "user" | "assistant",
			delta: string,
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
							text: delta,
							status: entryStatus,
							timestamp: Date.now(),
						},
					];
				}
				const existing = prev[index];
				const next = [...prev];
				next[index] = {
					...existing,
					text: existing.text + delta,
					// Only a still-open entry takes the incoming status. Transcription
					// chunks can arrive after the turn they belong to was finalized, and
					// they must not walk a settled entry back to "partial".
					status: existing.status === "partial" ? entryStatus : existing.status,
				};
				return next;
			});
		},
		[],
	);

	const finalizeTurnEntries = useCallback(
		(entryStatus: RealtimeTranscriptEntry["status"]) => {
			const ids = [userTurnIdRef.current, assistantTurnIdRef.current].filter(
				(id): id is string => id !== null,
			);
			if (ids.length === 0) {
				return;
			}
			setTranscript((prev) =>
				prev.map((entry) =>
					ids.includes(entry.id) && entry.status === "partial"
						? { ...entry, status: entryStatus }
						: entry,
				),
			);
		},
		[],
	);

	/** Id of the user bubble for the turn being spoken, opening one if needed. */
	const currentUserTurnId = useCallback(() => {
		if (turnClosedRef.current || !userTurnIdRef.current) {
			turnCounterRef.current += 1;
			userTurnIdRef.current = `user-${turnCounterRef.current}`;
			assistantTurnIdRef.current = null;
			turnClosedRef.current = false;
		}
		return userTurnIdRef.current;
	}, []);

	/** Id of the assistant bubble answering the current turn. */
	const currentAssistantTurnId = useCallback(() => {
		if (!assistantTurnIdRef.current) {
			if (!userTurnIdRef.current) {
				turnCounterRef.current += 1;
			}
			assistantTurnIdRef.current = `assistant-${turnCounterRef.current}`;
		}
		return assistantTurnIdRef.current;
	}, []);

	/**
	 * Add one generation's reported usage at the same boundaries the gateway
	 * bills at (a function-call stage, or a completed turn). Gemini charges the
	 * full active prompt on every generation, retained history included, so the
	 * counts accumulate exactly as reported rather than being de-duplicated.
	 */
	const commitStageUsage = useCallback(() => {
		const raw = pendingUsageRef.current;
		pendingUsageRef.current = null;
		if (!raw) {
			return;
		}
		const inputTokens =
			readCount(raw.promptTokenCount) + readCount(raw.toolUsePromptTokenCount);
		const outputTokens =
			readCount(raw.responseTokenCount) + readCount(raw.thoughtsTokenCount);
		if (inputTokens === 0 && outputTokens === 0) {
			return;
		}
		const audioInputTokens =
			sumModality(raw.promptTokensDetails, "AUDIO") +
			sumModality(raw.toolUsePromptTokensDetails, "AUDIO");
		const audioOutputTokens = sumModality(raw.responseTokensDetails, "AUDIO");
		setUsage((prev) => ({
			responses: prev.responses + 1,
			inputTokens: prev.inputTokens + inputTokens,
			outputTokens: prev.outputTokens + outputTokens,
			totalTokens: prev.totalTokens + inputTokens + outputTokens,
			audioInputTokens: prev.audioInputTokens + audioInputTokens,
			audioOutputTokens: prev.audioOutputTokens + audioOutputTokens,
		}));
	}, []);

	const endGracefully = useCallback(() => {
		if (statusRef.current === "idle") {
			return;
		}
		updateStatus("ending");
		cleanup();
	}, [cleanup, updateStatus]);

	const handleServerMessage = useCallback(
		(message: Record<string, unknown>) => {
			// Gateway-generated errors are namespaced so they cannot be confused
			// with a real Gemini upstream error frame.
			const gatewayError = asObject(message.llmgatewayError);
			if (gatewayError) {
				onCallErrorRef.current?.(
					typeof gatewayError.message === "string"
						? gatewayError.message
						: "The realtime session reported an error.",
				);
				return;
			}
			const upstreamError = asObject(message.error);
			if (upstreamError) {
				onCallErrorRef.current?.(
					typeof upstreamError.message === "string"
						? upstreamError.message
						: "The realtime session reported an error.",
				);
				return;
			}

			if (message.usageMetadata !== undefined) {
				pendingUsageRef.current = asObject(message.usageMetadata) ?? null;
			}

			if (message.setupComplete !== undefined) {
				updateStatus("live");
				setElapsedSeconds(0);
				const startedAt = Date.now();
				elapsedTimerRef.current = setInterval(() => {
					setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
				}, 1000);
				startMeterLoop();
				return;
			}

			if (message.goAway !== undefined) {
				// The provider is ending the session. v1 does not resume or
				// reconnect, so the call simply ends in an orderly way.
				endGracefully();
				return;
			}

			if (message.toolCall !== undefined) {
				commitStageUsage();
				return;
			}

			const serverContent = asObject(message.serverContent);
			if (!serverContent) {
				return;
			}

			if (serverContent.interrupted === true) {
				// The provider cut the turn short (it was still generating). Local
				// barge-in may already have done this; both paths are idempotent.
				playbackRef.current?.flush();
				audioSuppressedRef.current = true;
				generationOpenRef.current = false;
				markAssistantInterrupted();
			}

			const inputTranscription = asObject(serverContent.inputTranscription);
			if (typeof inputTranscription?.text === "string") {
				appendTranscript(
					currentUserTurnId(),
					"user",
					inputTranscription.text,
					"partial",
				);
			}
			const outputTranscription = asObject(serverContent.outputTranscription);
			if (typeof outputTranscription?.text === "string") {
				appendTranscript(
					currentAssistantTurnId(),
					"assistant",
					outputTranscription.text,
					"partial",
				);
			}

			const modelTurn = asObject(serverContent.modelTurn);
			if (Array.isArray(modelTurn?.parts)) {
				const itemId = currentAssistantTurnId();
				if (!generationOpenRef.current) {
					// First frame of a new generation: whatever the listener spoke over
					// is behind us, so this answer is heard.
					generationOpenRef.current = true;
					audioSuppressedRef.current = false;
				}
				// One modelTurn can carry several parts; every audio part has to be
				// queued or the tail of the sentence is silently dropped. Audio for a
				// generation the listener already spoke over is dropped instead.
				if (!audioSuppressedRef.current) {
					for (const rawPart of modelTurn.parts) {
						const part = asObject(rawPart);
						const inlineData = asObject(part?.inlineData);
						if (typeof inlineData?.data === "string") {
							playbackRef.current?.enqueue(itemId, 0, inlineData.data);
						}
					}
				}
			}

			if (serverContent.turnComplete === true) {
				commitStageUsage();
				finalizeTurnEntries("final");
				turnClosedRef.current = true;
				generationOpenRef.current = false;
			}
		},
		[
			appendTranscript,
			commitStageUsage,
			currentAssistantTurnId,
			currentUserTurnId,
			endGracefully,
			finalizeTurnEntries,
			markAssistantInterrupted,
			startMeterLoop,
			updateStatus,
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

			updateStatus("connecting");
			// The secret travels only in the credential subprotocol — never in the
			// URL, where it would leak into logs and proxies. The provider-neutral
			// prefix is used because this client does not speak OpenAI's protocol.
			const wsUrl = `${mint.ws_url}?model=${encodeURIComponent(currentModel)}`;
			let ws: WebSocket;
			try {
				ws = new WebSocket(wsUrl, [
					"realtime",
					`llmgateway-insecure-api-key.${mint.client_secret}`,
				]);
			} catch {
				failCall("Could not open the realtime connection.");
				return;
			}
			wsRef.current = ws;
			playbackRef.current = new RealtimePlayback(context);
			turnCounterRef.current = 0;
			userTurnIdRef.current = null;
			assistantTurnIdRef.current = null;
			turnClosedRef.current = true;

			let opened = false;
			ws.onopen = () => {
				opened = true;
				updateStatus("configuring");
				sendMessage({
					setup: {
						model: currentModel,
						generationConfig: {
							responseModalities: ["AUDIO"],
							...(voiceRef.current
								? {
										speechConfig: {
											voiceConfig: {
												prebuiltVoiceConfig: { voiceName: voiceRef.current },
											},
										},
									}
								: {}),
						},
						// Native transcription: both directions are configured here and
						// billed through Gemini's own usage metadata.
						inputAudioTranscription: {},
						outputAudioTranscription: {},
						// End-of-turn detection is what the caller experiences as "how
						// long until it answers": the provider waits for this much
						// trailing silence before it starts generating. The default is
						// tuned for noisy far-field audio and feels sluggish on a
						// headset, where the browser is already applying noise
						// suppression and echo cancellation.
						realtimeInputConfig: {
							automaticActivityDetection: {
								startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
								endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
								prefixPaddingMs: 20,
								silenceDurationMs: 400,
							},
						},
					},
				});
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
					handleServerMessage(parsed as Record<string, unknown>);
				}
			};
			ws.onclose = (closeEvent: CloseEvent) => {
				if (isStale()) {
					return;
				}
				if (statusRef.current === "ending" || statusRef.current === "idle") {
					return;
				}
				// The gateway puts the diagnosis in the close reason (an upstream
				// rejection, a spend cap, a revoked key). Dropping it in favour of a
				// generic message is what makes a failed call look like a hang.
				const reason = closeEvent.reason?.trim();
				failCall(
					reason
						? `The call ended: ${reason}`
						: opened
							? "The call ended unexpectedly."
							: "Could not connect to the realtime service. Check your credits and try again.",
				);
			};
			ws.onerror = () => {
				// onclose fires next and carries the user-facing handling.
			};

			// Microphone chunks are dropped until setupComplete puts the call in the
			// live state, while muted, and under network backpressure rather than
			// building an unbounded queue.
			try {
				captureRef.current = await startMicrophoneCapture(
					context,
					stream,
					(samples) => {
						const socket = wsRef.current;
						const capturing = statusRef.current === "live" && !mutedRef.current;
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
						const resampled = resampleLinear(
							samples,
							context.sampleRate,
							GEMINI_INPUT_SAMPLE_RATE,
						);
						socket.send(
							JSON.stringify({
								realtimeInput: {
									audio: {
										data: floatToPcm16Base64(resampled),
										mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`,
									},
								},
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
		[failCall, handleServerMessage, model, sendMessage, updateStatus],
	);

	const reset = useCallback(() => {
		if (statusRef.current !== "idle") {
			return;
		}
		setTranscript([]);
		setUsage(EMPTY_USAGE);
		setElapsedSeconds(0);
	}, []);

	const start = useCallback(() => {
		if (statusRef.current !== "idle" || !model) {
			return;
		}
		reset();
		// The AudioContext must be created and resumed synchronously inside the
		// click gesture (before any await) or Safari drops the user activation.
		const context = new AudioContext();
		void context.resume().catch(() => {});
		audioContextRef.current = context;
		updateStatus("preparing-audio");
		const callId = callIdRef.current;
		void runStart(context, callId);
	}, [model, reset, runStart, updateStatus]);

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
			userSpeakingRef.current = false;
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
