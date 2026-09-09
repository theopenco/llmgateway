"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
	computeRms,
	floatToPcm16Base64,
	resampleLinear,
	rmsToLevel,
	startMicrophoneCapture,
	type MicrophoneCaptureHandles,
} from "@/lib/realtime-audio";

import type { RealtimeCallStatus } from "@/hooks/use-realtime-call";

/**
 * "server_vad" lets the provider segment speech and commit each turn itself;
 * "manual" streams audio uncommitted until commit() is called, matching the
 * docs' `turn_detection: null` example.
 */
export type TranscriptionTurnDetection = "server_vad" | "manual";

export interface TranscriptionSegment {
	/** Upstream conversation item id of the audio this segment transcribes. */
	id: string;
	text: string;
	status: "partial" | "final" | "failed";
	timestamp: number;
}

/**
 * Usage reported by completed transcription events. Duration-metered models
 * (gpt-live-transcribe) fill audioSeconds; token-metered ones fill the token
 * counts.
 */
export interface TranscriptionUsageTotals {
	segments: number;
	audioSeconds: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	audioInputTokens: number;
}

const EMPTY_USAGE: TranscriptionUsageTotals = {
	segments: 0,
	audioSeconds: 0,
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	audioInputTokens: 0,
};

const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const METER_INTERVAL_MS = 80;
const METER_EPSILON = 0.02;
/**
 * Local speech detection for manual turns, where the server sends no VAD
 * events: rising past ON marks speech, and it only clears after the level
 * stays under OFF for the hold window.
 */
const SPEECH_ON_LEVEL = 0.2;
const SPEECH_OFF_LEVEL = 0.12;
const SPEECH_OFF_HOLD_MS = 500;
/**
 * Upper bound on holding the socket open after Stop for the final segment's
 * terminal event; past it the session is torn down regardless.
 */
const STOP_DRAIN_TIMEOUT_MS = 5000;

interface UseTranscriptionSessionOptions {
	model: string | null;
	turnDetection: TranscriptionTurnDetection;
	onError?: (message: string) => void;
}

interface MintResponse {
	client_secret: string;
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
 * Transcription-only session on the gateway's /v1/realtime WebSocket
 * (`intent=transcription`): microphone audio in, transcript segments out, no
 * speech model and no playback.
 */
export function useTranscriptionSession({
	model,
	turnDetection,
	onError,
}: UseTranscriptionSessionOptions) {
	const [status, setStatus] = useState<RealtimeCallStatus>("idle");
	const [muted, setMutedState] = useState(false);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
	const [usage, setUsage] = useState<TranscriptionUsageTotals>(EMPTY_USAGE);
	const [userSpeaking, setUserSpeaking] = useState(false);
	const [inputLevel, setInputLevel] = useState(0);

	const statusRef = useRef<RealtimeCallStatus>("idle");
	const mutedRef = useRef(false);
	const sessionIdRef = useRef(0);
	const audioContextRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const captureRef = useRef<MicrophoneCaptureHandles | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const inputLevelRef = useRef(0);
	const userSpeakingRef = useRef(false);
	const userQuietSinceRef = useRef(0);
	// Audio items whose terminal transcription event (completed or failed) has
	// not arrived: Stop keeps the socket open until this empties.
	const pendingItemsRef = useRef(new Set<string>());
	// Audio the provider has not committed yet: streamed chunks on manual turns,
	// or a server-VAD turn whose speech_started has no committed event yet.
	const uncommittedAudioRef = useRef(false);
	// A commit whose committed (or error) event is still expected: one sent by
	// Stop, or the server VAD's own commit that follows speech_stopped.
	const awaitingCommitRef = useRef(false);
	const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const turnDetectionRef = useRef<TranscriptionTurnDetection>(turnDetection);
	turnDetectionRef.current = turnDetection;
	const modelRef = useRef<string | null>(null);
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

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
			if (turnDetectionRef.current !== "manual") {
				return;
			}
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
			}
			setUserSpeaking(userSpeakingRef.current);
		}, METER_INTERVAL_MS);
	}, []);

	const releaseMicrophone = useCallback(() => {
		captureRef.current?.stop();
		captureRef.current = null;
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
	}, []);

	const cleanup = useCallback(() => {
		sessionIdRef.current += 1;
		if (elapsedTimerRef.current) {
			clearInterval(elapsedTimerRef.current);
			elapsedTimerRef.current = null;
		}
		if (meterTimerRef.current) {
			clearInterval(meterTimerRef.current);
			meterTimerRef.current = null;
		}
		if (stopTimerRef.current) {
			clearTimeout(stopTimerRef.current);
			stopTimerRef.current = null;
		}
		pendingItemsRef.current.clear();
		uncommittedAudioRef.current = false;
		awaitingCommitRef.current = false;
		inputLevelRef.current = 0;
		userSpeakingRef.current = false;
		userQuietSinceRef.current = 0;
		setInputLevel(0);
		setUserSpeaking(false);
		releaseMicrophone();
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
		updateStatus("idle");
	}, [releaseMicrophone, updateStatus]);

	/** After Stop: tear down once every outstanding transcription has landed. */
	const finishStopIfDrained = useCallback(() => {
		if (
			statusRef.current === "ending" &&
			!awaitingCommitRef.current &&
			pendingItemsRef.current.size === 0
		) {
			cleanup();
		}
	}, [cleanup]);

	const fail = useCallback(
		(message: string) => {
			cleanup();
			onErrorRef.current?.(message);
		},
		[cleanup],
	);

	const upsertSegment = useCallback(
		(
			itemId: string,
			update: (previousText: string) => string,
			segmentStatus: TranscriptionSegment["status"],
		) => {
			setSegments((prev) => {
				const index = prev.findIndex((segment) => segment.id === itemId);
				if (index === -1) {
					return [
						...prev,
						{
							id: itemId,
							text: update(""),
							status: segmentStatus,
							timestamp: Date.now(),
						},
					];
				}
				const next = [...prev];
				next[index] = {
					...prev[index],
					text: update(prev[index].text),
					status: segmentStatus,
				};
				return next;
			});
		},
		[],
	);

	const handleServerEvent = useCallback(
		(event: Record<string, unknown>) => {
			const type = typeof event.type === "string" ? event.type : "";
			switch (type) {
				case "session.created": {
					// The gateway already pinned the transcription model; naming it
					// again must pass its lock check. The session is live once the
					// session.updated echo arrives.
					updateStatus("configuring");
					sendEvent({
						type: "session.update",
						session: {
							type: "transcription",
							audio: {
								input: {
									format: { type: "audio/pcm", rate: 24000 },
									...(modelRef.current
										? { transcription: { model: modelRef.current } }
										: {}),
									turn_detection:
										turnDetectionRef.current === "server_vad"
											? { type: "server_vad" }
											: null,
								},
							},
						},
					});
					return;
				}
				case "session.updated":
					if (statusRef.current === "configuring") {
						updateStatus("live");
						setElapsedSeconds(0);
						const startedAt = Date.now();
						elapsedTimerRef.current = setInterval(() => {
							setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
						}, 1000);
						startMeterLoop();
					}
					return;
				case "conversation.item.input_audio_transcription.delta": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (itemId) {
						pendingItemsRef.current.add(itemId);
						upsertSegment(itemId, (previous) => previous + delta, "partial");
					}
					return;
				}
				case "conversation.item.input_audio_transcription.completed": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					const text =
						typeof event.transcript === "string" ? event.transcript : null;
					if (itemId) {
						pendingItemsRef.current.delete(itemId);
						upsertSegment(itemId, (previous) => text ?? previous, "final");
					}
					const rawUsage = asObject(event.usage);
					const inputDetails = asObject(rawUsage?.input_token_details) ?? {};
					setUsage((prev) => ({
						segments: prev.segments + 1,
						audioSeconds:
							prev.audioSeconds +
							(rawUsage?.type === "duration" ? readCount(rawUsage.seconds) : 0),
						inputTokens: prev.inputTokens + readCount(rawUsage?.input_tokens),
						outputTokens:
							prev.outputTokens + readCount(rawUsage?.output_tokens),
						totalTokens: prev.totalTokens + readCount(rawUsage?.total_tokens),
						audioInputTokens:
							prev.audioInputTokens + readCount(inputDetails.audio_tokens),
					}));
					finishStopIfDrained();
					return;
				}
				case "conversation.item.input_audio_transcription.failed": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					if (itemId) {
						pendingItemsRef.current.delete(itemId);
						upsertSegment(itemId, (previous) => previous, "failed");
					}
					const message = asObject(event.error)?.message;
					onErrorRef.current?.(
						typeof message === "string"
							? message
							: "Transcription failed for the last turn.",
					);
					finishStopIfDrained();
					return;
				}
				case "input_audio_buffer.speech_started":
					uncommittedAudioRef.current = true;
					setUserSpeaking(true);
					return;
				case "input_audio_buffer.speech_stopped":
					uncommittedAudioRef.current = false;
					awaitingCommitRef.current = true;
					setUserSpeaking(false);
					return;
				case "input_audio_buffer.committed": {
					const itemId =
						typeof event.item_id === "string" ? event.item_id : null;
					if (itemId) {
						pendingItemsRef.current.add(itemId);
					}
					uncommittedAudioRef.current = false;
					awaitingCommitRef.current = false;
					setUserSpeaking(false);
					finishStopIfDrained();
					return;
				}
				case "error": {
					const message = asObject(event.error)?.message;
					onErrorRef.current?.(
						typeof message === "string"
							? message
							: "The transcription session reported an error.",
					);
					// A rejected Stop commit (e.g. an empty buffer) has nothing to wait for.
					awaitingCommitRef.current = false;
					finishStopIfDrained();
					break;
				}
				default:
			}
		},
		[
			finishStopIfDrained,
			sendEvent,
			startMeterLoop,
			updateStatus,
			upsertSegment,
		],
	);

	const runStart = useCallback(
		async (context: AudioContext, sessionId: number) => {
			const isStale = () => sessionIdRef.current !== sessionId;
			const currentModel = model;
			if (!currentModel) {
				fail("Select a transcription model first.");
				return;
			}
			modelRef.current = currentModel;

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
					fail(
						"Microphone access was denied. Allow microphone access to start transcribing.",
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
					body: JSON.stringify({ model: currentModel, type: "transcription" }),
				});
				if (!response.ok) {
					const data = (await response.json().catch(() => null)) as {
						error?: string;
					} | null;
					throw new Error(
						data?.error ??
							`Failed to start transcribing (HTTP ${response.status})`,
					);
				}
				mint = (await response.json()) as MintResponse;
			} catch (error) {
				if (!isStale()) {
					fail(
						error instanceof Error
							? error.message
							: "Failed to start transcribing.",
					);
				}
				return;
			}
			if (isStale()) {
				return;
			}
			if (!mint.client_secret || !mint.ws_url) {
				fail("The session setup response was invalid.");
				return;
			}

			updateStatus("connecting");
			// The secret travels only in the official credential subprotocol —
			// never in the URL, where it would leak into logs and proxies.
			const wsUrl = `${mint.ws_url}?intent=transcription&model=${encodeURIComponent(currentModel)}`;
			let ws: WebSocket;
			try {
				ws = new WebSocket(wsUrl, [
					"realtime",
					`openai-insecure-api-key.${mint.client_secret}`,
				]);
			} catch {
				fail("Could not open the realtime connection.");
				return;
			}
			wsRef.current = ws;

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
				const event = asObject(parsed);
				if (event) {
					handleServerEvent(event);
				}
			};
			ws.onclose = () => {
				if (isStale()) {
					return;
				}
				if (statusRef.current === "ending") {
					// The gateway closed first: nothing more can arrive for Stop.
					cleanup();
					return;
				}
				if (statusRef.current === "idle") {
					return;
				}
				fail(
					opened
						? "The transcription session ended unexpectedly."
						: "Could not connect to the realtime service. Check your credits and try again.",
				);
			};
			ws.onerror = () => {
				// onclose fires next and carries the user-facing handling.
			};

			// Chunks are dropped until the session is live or while muted, and
			// under network backpressure rather than building an unbounded queue.
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
						if (turnDetectionRef.current === "manual") {
							uncommittedAudioRef.current = true;
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
					fail("Could not initialize microphone processing.");
				}
			}
		},
		[cleanup, fail, handleServerEvent, model, updateStatus],
	);

	/** Clear the finished session from view. No-op while one is in progress. */
	const reset = useCallback(() => {
		if (statusRef.current !== "idle") {
			return;
		}
		setSegments([]);
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
		void runStart(context, sessionIdRef.current);
	}, [model, reset, runStart, updateStatus]);

	/**
	 * Stop capturing, finalize the open turn and keep the socket up until its
	 * transcription lands, so the last segment and its usage are not lost.
	 * A second Stop while ending tears the session down immediately.
	 */
	const stop = useCallback(() => {
		const current = statusRef.current;
		if (current === "idle") {
			return;
		}
		const ws = wsRef.current;
		if (current !== "live" || !ws || ws.readyState !== WebSocket.OPEN) {
			updateStatus("ending");
			cleanup();
			return;
		}
		updateStatus("ending");
		releaseMicrophone();
		if (uncommittedAudioRef.current) {
			awaitingCommitRef.current = true;
			sendEvent({ type: "input_audio_buffer.commit" });
		}
		if (!awaitingCommitRef.current && pendingItemsRef.current.size === 0) {
			cleanup();
			return;
		}
		stopTimerRef.current = setTimeout(cleanup, STOP_DRAIN_TIMEOUT_MS);
	}, [cleanup, releaseMicrophone, sendEvent, updateStatus]);

	/** Manual turns only: finalize the audio streamed since the last commit. */
	const commit = useCallback(() => {
		if (statusRef.current !== "live") {
			return;
		}
		sendEvent({ type: "input_audio_buffer.commit" });
	}, [sendEvent]);

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
		segments,
		usage,
		userSpeaking,
		inputLevel,
		start,
		stop,
		commit,
		reset,
	};
}
