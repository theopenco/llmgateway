import {
	floatToPcm16Base64,
	pcm16Base64ToFloat,
	resampleLinear,
} from "@llmgateway/shared/realtime-pcm";

import { CallAudioArchive, emptyCallUsage } from "./call-transcript";

import type { VoiceSelection } from "@/api/realtime";
import type { CallEntry, CallUsage } from "@/lib/call-transcript";
import type { Microphone } from "@/lib/microphone";
import type { VoicePlayback } from "@/lib/realtime-playback";
import type {
	RealtimeSocket,
	TranscriptionStatus,
} from "@/lib/transcription-session";

export interface VoiceState {
	status: TranscriptionStatus;
	selection: VoiceSelection | null;
	transcript: CallEntry[];
	usage: CallUsage;
	muted: boolean;
	inputLevel: number;
	outputLevel: number;
	userSpeaking: boolean;
	assistantSpeaking: boolean;
	elapsed: number;
	error: string | null;
	audioLimited: boolean;
}
interface VoiceDependencies {
	microphone: (sampleRate: number) => Microphone;
	playback: () => VoicePlayback;
	mint: (
		selection: VoiceSelection,
		signal: AbortSignal,
	) => Promise<{ secret: string; model: string; url: string }>;
	connect: (url: string, protocols: string[]) => RealtimeSocket;
	onEnded: (state: VoiceState) => void;
}
function initialState(): VoiceState {
	return {
		status: "idle",
		selection: null,
		transcript: [],
		usage: emptyCallUsage(),
		muted: false,
		inputLevel: 0,
		outputLevel: 0,
		userSpeaking: false,
		assistantSpeaking: false,
		elapsed: 0,
		error: null,
		audioLimited: false,
	};
}
function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function count(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: 0;
}
function text(value: unknown) {
	return typeof value === "string" ? value : "";
}
function audioTokens(value: unknown) {
	return Array.isArray(value)
		? value.reduce<number>((sum, entry: unknown) => {
				const detail = object(entry);
				return (
					sum + (detail?.modality === "AUDIO" ? count(detail.tokenCount) : 0)
				);
			}, 0)
		: 0;
}

export class VoiceSession {
	private state = initialState();
	private listeners = new Set<() => void>();
	private abort?: AbortController;
	private microphone?: Microphone;
	private playback?: VoicePlayback;
	private socket?: RealtimeSocket;
	private closing?: Promise<void>;
	private deadline?: ReturnType<typeof setTimeout>;
	private ticker?: ReturnType<typeof setInterval>;
	private startedAt = 0;
	private lastAudioAt = 0;
	private inputLevel = 0;
	private speakerUntil = 0;
	private quietSince = 0;
	private archive = new CallAudioArchive();
	private completedResponses = new Set<string>();
	private suppressed = new Set<string>();
	private activeAssistant?: string;
	private responseActive = false;
	private turn = 0;
	private userTurn?: string;
	private assistantTurn?: string;
	private turnClosed = true;
	private generationOpen = false;
	private suppressGeminiAudio = false;
	private geminiUsage?: Record<string, unknown>;
	public constructor(private readonly dependencies: VoiceDependencies) {}
	public getSnapshot = () => this.state;
	public subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private update(patch: Partial<VoiceState>) {
		this.state = { ...this.state, ...patch };
		this.listeners.forEach((listener) => listener());
	}
	public async start(selection: VoiceSelection, seed: CallEntry[] = []) {
		if (this.state.status !== "idle") {
			return;
		}
		if (selection.protocol === "gemini" && seed.length) {
			this.update({
				error:
					"This model cannot continue a saved call. Start a new call instead.",
			});
			return;
		}
		this.closing = undefined;
		this.startedAt = 0;
		this.inputLevel = 0;
		this.speakerUntil = 0;
		this.quietSince = 0;
		this.turn = 0;
		this.userTurn = undefined;
		this.assistantTurn = undefined;
		this.turnClosed = true;
		this.generationOpen = false;
		this.suppressGeminiAudio = false;
		this.geminiUsage = undefined;
		this.activeAssistant = undefined;
		this.responseActive = false;
		this.completedResponses.clear();
		this.suppressed.clear();
		this.archive = new CallAudioArchive(seed);
		this.abort = new AbortController();
		const signal = this.abort.signal;
		this.update({
			...initialState(),
			selection,
			transcript: seed.map((entry, index) => ({
				...entry,
				id: `seed-${index}`,
			})),
			status: "microphone",
			audioLimited: this.archive.limited,
		});
		try {
			this.microphone = this.dependencies.microphone(
				selection.protocol === "gemini" ? 16000 : 24000,
			);
			await this.microphone.start(
				(audio, level) => {
					try {
						this.audio(audio, level);
					} catch (error) {
						this.fail(
							error instanceof Error
								? error.message
								: "Could not process microphone audio.",
						);
					}
				},
				(error) => this.fail(error.message),
			);
			signal.throwIfAborted();
			this.playback = this.dependencies.playback();
			await this.playback.resume();
			signal.throwIfAborted();
			this.update({ status: "minting" });
			const minted = await this.dependencies.mint(selection, signal);
			signal.throwIfAborted();
			this.update({
				selection: { ...selection, model: minted.model },
				status: "connecting",
			});
			const socket = this.dependencies.connect(minted.url, [
				"realtime",
				`openai-insecure-api-key.${minted.secret}`,
			]);
			this.socket = socket;
			socket.onopen = () => {
				this.update({ status: "configuring" });
				if (selection.protocol === "gemini") {
					this.configureGemini();
				}
			};
			socket.onmessage = ({ data }) => {
				try {
					if (typeof data !== "string") {
						throw new Error("The voice server sent a non-text event.");
					}
					const event = object(JSON.parse(data));
					if (!event) {
						throw new Error("The voice server sent an invalid event.");
					}
					if (selection.protocol === "gemini") {
						this.gemini(event);
					} else {
						this.openai(event);
					}
				} catch (error) {
					this.fail(
						error instanceof Error
							? error.message
							: "Could not process voice audio.",
					);
				}
			};
			socket.onerror = () =>
				this.fail(
					"The voice connection failed. Start a new call to try again.",
				);
			socket.onclose = () => {
				if (this.state.status !== "ending") {
					this.update({
						error: this.state.error ?? "The voice connection closed.",
					});
				}
				void this.end();
			};
			this.deadline = setTimeout(
				() => this.fail("The voice connection timed out."),
				20_000,
			);
		} catch (error) {
			if (!signal.aborted) {
				this.fail(
					error instanceof Error
						? error.message
						: "Could not start the voice call.",
				);
			}
		}
	}
	private send(event: Record<string, unknown>) {
		if (this.socket?.readyState !== 1) {
			return;
		}
		try {
			this.socket.send(JSON.stringify(event));
		} catch {
			this.fail("Could not send audio to the voice call.");
		}
	}
	private live() {
		if (
			this.state.status !== "configuring" &&
			this.state.status !== "connecting"
		) {
			return;
		}
		clearTimeout(this.deadline);
		if (this.state.selection?.protocol === "openai") {
			for (const entry of this.state.transcript) {
				if (entry.status === "partial" || !entry.text.trim()) {
					continue;
				}
				this.send({
					type: "conversation.item.create",
					item: {
						type: "message",
						role: entry.role,
						content: [
							{
								type: entry.role === "user" ? "input_text" : "output_text",
								text: entry.text,
							},
						],
					},
				});
			}
		}
		if (this.abort?.signal.aborted) {
			return;
		}
		this.startedAt = Date.now();
		this.lastAudioAt = Date.now();
		this.update({ status: "live" });
		this.ticker = setInterval(() => {
			if (Date.now() - this.lastAudioAt > 5000) {
				this.fail(
					"The microphone stopped delivering audio. Start a new call to try again.",
				);
				return;
			}
			const outputLevel = this.playback?.getLevel() ?? 0;
			if (this.playback?.isPlaying) {
				this.speakerUntil = Date.now() + 300;
			}
			const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
			const assistantSpeaking = Date.now() < this.speakerUntil;
			if (
				Math.abs(this.inputLevel - this.state.inputLevel) >= 0.02 ||
				Math.abs(outputLevel - this.state.outputLevel) >= 0.02 ||
				elapsed !== this.state.elapsed ||
				assistantSpeaking !== this.state.assistantSpeaking ||
				(this.inputLevel === 0 && this.state.inputLevel !== 0)
			) {
				this.update({
					inputLevel: this.inputLevel,
					outputLevel,
					elapsed,
					assistantSpeaking,
				});
			}
		}, 80);
	}
	private audio = (audio: string, level: number) => {
		this.lastAudioAt = Date.now();
		if (this.state.status !== "live" || this.state.muted) {
			return;
		}
		this.inputLevel = level;
		if (this.state.selection?.protocol === "gemini") {
			if (!this.state.userSpeaking && level >= 0.2) {
				this.update({ userSpeaking: true });
				this.interrupt();
				this.quietSince = 0;
			} else if (this.state.userSpeaking) {
				if (level >= 0.12) {
					this.quietSince = 0;
				} else {
					this.quietSince ||= Date.now();
					if (Date.now() - this.quietSince >= 500) {
						this.update({ userSpeaking: false });
					}
				}
			}
			this.send({
				realtimeInput: {
					audio: { data: audio, mimeType: "audio/pcm;rate=16000" },
				},
			});
		} else {
			this.send({ type: "input_audio_buffer.append", audio });
		}
	};
	private entry(
		id: string,
		role: CallEntry["role"],
		value: string,
		status: CallEntry["status"],
		append = false,
	) {
		const previous = this.state.transcript.find((entry) => entry.id === id);
		const entry: CallEntry = {
			id,
			role,
			text: append ? (previous?.text ?? "") + value : value,
			status:
				previous && previous.status !== "partial" ? previous.status : status,
			timestamp: previous?.timestamp ?? Date.now(),
			...(previous?.audio ? { audio: previous.audio } : {}),
		};
		this.update({
			transcript: previous
				? this.state.transcript.map((item) => (item.id === id ? entry : item))
				: [...this.state.transcript, entry],
		});
	}
	private interrupt() {
		if (
			!this.playback?.isPlaying &&
			!this.responseActive &&
			!this.generationOpen
		) {
			return;
		}
		const wasPlaying = this.playback?.isPlaying;
		const cuts = (this.playback?.flush() ?? []).filter(
			(cut) => wasPlaying || cut.itemId === this.activeAssistant,
		);
		const ids = new Set(cuts.map((cut) => cut.itemId));
		if (this.activeAssistant) {
			ids.add(this.activeAssistant);
		}
		if (this.state.selection?.protocol === "openai") {
			for (const id of ids) {
				this.suppressed.add(id);
			}
		}
		this.suppressGeminiAudio = true;
		this.speakerUntil = 0;
		this.update({
			transcript: this.state.transcript.map((entry) =>
				ids.has(entry.id) ? { ...entry, status: "interrupted" } : entry,
			),
			assistantSpeaking: false,
			outputLevel: 0,
		});
		if (this.state.selection?.protocol === "openai") {
			for (const cut of cuts) {
				this.send({
					type: "conversation.item.truncate",
					item_id: cut.itemId,
					content_index: cut.contentIndex,
					audio_end_ms: cut.playedMs,
				});
			}
		}
	}
	private receiveAudio(
		id: string,
		contentIndex: number,
		data: string,
		rate = 24000,
	) {
		if (this.suppressed.has(id)) {
			return;
		}
		this.activeAssistant = id;
		if (!this.state.transcript.some((entry) => entry.id === id)) {
			this.entry(id, "assistant", "", "partial");
		}
		this.playback?.enqueue(id, contentIndex, data, rate);
		this.archive.add(
			id,
			rate === 24000
				? data
				: floatToPcm16Base64(resampleLinear(pcm16Base64ToFloat(data), rate)),
		);
		if (this.archive.limited !== this.state.audioLimited) {
			this.update({ audioLimited: this.archive.limited });
		}
	}
	private finalizeAudio() {
		this.update({ transcript: this.archive.finalize(this.state.transcript) });
	}
	private addUsage(usage: CallUsage) {
		const previous = this.state.usage;
		this.update({
			usage: {
				responses: previous.responses + usage.responses,
				inputTokens: previous.inputTokens + usage.inputTokens,
				outputTokens: previous.outputTokens + usage.outputTokens,
				totalTokens: previous.totalTokens + usage.totalTokens,
				audioInputTokens: previous.audioInputTokens + usage.audioInputTokens,
				audioOutputTokens: previous.audioOutputTokens + usage.audioOutputTokens,
			},
		});
	}
	private openai(event: Record<string, unknown>) {
		const id = text(event.item_id);
		switch (event.type) {
			case "session.created":
				this.send({
					type: "session.update",
					session: {
						type: "realtime",
						output_modalities: ["audio"],
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24000 },
								...(this.state.selection?.transcriptionModel
									? {
											transcription: {
												model: this.state.selection.transcriptionModel,
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
								...(this.state.selection?.voice
									? { voice: this.state.selection.voice }
									: {}),
							},
						},
					},
				});
				break;
			case "session.updated":
				this.live();
				break;
			case "response.created":
				this.responseActive = true;
				this.activeAssistant = undefined;
				break;
			case "response.output_audio.delta":
				if (id && typeof event.delta === "string") {
					this.receiveAudio(id, count(event.content_index), event.delta);
				}
				break;
			case "response.output_audio_transcript.delta":
				if (id) {
					this.entry(id, "assistant", text(event.delta), "partial", true);
				}
				break;
			case "response.output_audio_transcript.done":
				if (id) {
					this.entry(id, "assistant", text(event.transcript), "final");
				}
				break;
			case "conversation.item.input_audio_transcription.delta":
				if (id) {
					this.entry(id, "user", text(event.delta), "partial", true);
				}
				break;
			case "conversation.item.input_audio_transcription.completed":
				if (id) {
					this.entry(id, "user", text(event.transcript), "final");
				}
				break;
			case "conversation.item.input_audio_transcription.failed":
				this.update({
					error:
						text(object(event.error)?.message) ||
						"A spoken turn could not be transcribed.",
				});
				break;
			case "input_audio_buffer.speech_started":
				this.update({ userSpeaking: true });
				this.interrupt();
				break;
			case "input_audio_buffer.speech_stopped":
				this.update({ userSpeaking: false });
				break;
			case "input_audio_buffer.committed":
				this.update({ userSpeaking: false });
				if (id && !this.state.transcript.some((entry) => entry.id === id)) {
					this.entry(id, "user", "", "partial");
				}
				break;
			case "response.done": {
				this.responseActive = false;
				this.finalizeAudio();
				const response = object(event.response);
				const responseId = text(response?.id);
				if (responseId && this.completedResponses.has(responseId)) {
					break;
				}
				if (responseId) {
					this.completedResponses.add(responseId);
				}
				const usage = object(response?.usage);
				if (usage) {
					this.addUsage({
						responses: 1,
						inputTokens: count(usage.input_tokens),
						outputTokens: count(usage.output_tokens),
						totalTokens: count(usage.total_tokens),
						audioInputTokens: count(
							object(usage.input_token_details)?.audio_tokens,
						),
						audioOutputTokens: count(
							object(usage.output_token_details)?.audio_tokens,
						),
					});
				}
				if (response?.status === "failed") {
					this.update({
						error:
							text(object(object(response.status_details)?.error)?.message) ||
							"The spoken response failed.",
					});
				}
				break;
			}
			case "error":
				this.update({
					error:
						text(object(event.error)?.message) ||
						"The voice server reported an error.",
				});
				break;
		}
	}
	private configureGemini() {
		const selection = this.state.selection;
		this.send({
			setup: {
				model: selection?.model,
				generationConfig: {
					responseModalities: ["AUDIO"],
					...(selection?.voice
						? {
								speechConfig: {
									voiceConfig: {
										prebuiltVoiceConfig: { voiceName: selection.voice },
									},
								},
							}
						: {}),
				},
				inputAudioTranscription: {},
				outputAudioTranscription: {},
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
	}
	private geminiId(role: "user" | "assistant") {
		if (role === "user") {
			if (this.turnClosed || !this.userTurn) {
				this.turn++;
				this.userTurn = `user-${this.turn}`;
				this.assistantTurn = undefined;
				this.turnClosed = false;
			}
			return this.userTurn;
		}
		if (!this.assistantTurn) {
			if (!this.userTurn) {
				this.turn++;
			}
			this.assistantTurn = `assistant-${this.turn}`;
		}
		return this.assistantTurn;
	}
	private commitGeminiUsage() {
		const usage = this.geminiUsage;
		this.geminiUsage = undefined;
		if (!usage) {
			return;
		}
		const inputTokens =
			count(usage.promptTokenCount) + count(usage.toolUsePromptTokenCount);
		const outputTokens =
			count(usage.responseTokenCount) + count(usage.thoughtsTokenCount);
		if (!inputTokens && !outputTokens) {
			return;
		}
		this.addUsage({
			responses: 1,
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
			audioInputTokens:
				audioTokens(usage.promptTokensDetails) +
				audioTokens(usage.toolUsePromptTokensDetails),
			audioOutputTokens: audioTokens(usage.responseTokensDetails),
		});
	}
	private gemini(event: Record<string, unknown>) {
		const error = object(event.llmgatewayError) ?? object(event.error);
		if (error) {
			this.update({
				error: text(error.message) || "The voice server reported an error.",
			});
			return;
		}
		if (event.usageMetadata !== undefined) {
			this.geminiUsage = object(event.usageMetadata);
		}
		if (event.setupComplete !== undefined) {
			this.live();
			return;
		}
		if (event.goAway !== undefined) {
			void this.end();
			return;
		}
		if (event.toolCall !== undefined) {
			this.commitGeminiUsage();
		}
		const content = object(event.serverContent);
		if (!content) {
			return;
		}
		if (content.interrupted === true) {
			this.interrupt();
			this.generationOpen = false;
		}
		const input = object(content.inputTranscription);
		const output = object(content.outputTranscription);
		if (typeof input?.text === "string") {
			this.entry(this.geminiId("user"), "user", input.text, "partial", true);
		}
		if (typeof output?.text === "string") {
			this.entry(
				this.geminiId("assistant"),
				"assistant",
				output.text,
				"partial",
				true,
			);
		}
		const turn = object(content.modelTurn);
		if (Array.isArray(turn?.parts)) {
			const id = this.geminiId("assistant");
			if (!this.generationOpen) {
				this.generationOpen = true;
				this.suppressGeminiAudio = false;
			}
			if (!this.suppressGeminiAudio) {
				for (const raw of turn.parts) {
					const audio = object(object(raw)?.inlineData);
					if (typeof audio?.data !== "string") {
						continue;
					}
					const mime = text(audio.mimeType);
					if (mime && !mime.startsWith("audio/pcm")) {
						throw new Error(
							"The voice server returned an unsupported audio format.",
						);
					}
					const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
					if (rate < 8000 || rate > 96000) {
						throw new Error(
							"The voice server returned an unsupported sample rate.",
						);
					}
					this.receiveAudio(id, 0, audio.data, rate);
				}
			}
		}
		if (content.turnComplete === true) {
			this.commitGeminiUsage();
			this.finalizeAudio();
			this.update({
				transcript: this.state.transcript.map((entry) =>
					(entry.id === `user-${this.turn}` ||
						entry.id === `assistant-${this.turn}`) &&
					entry.status === "partial"
						? { ...entry, status: "final" }
						: entry,
				),
			});
			this.turnClosed = true;
			this.generationOpen = false;
		}
	}
	public setMuted(muted: boolean) {
		if (this.state.status !== "live") {
			return;
		}
		this.inputLevel = 0;
		this.update({ muted, inputLevel: 0, userSpeaking: false });
	}
	private fail(message: string) {
		this.update({ error: message });
		void this.end();
	}
	public reset() {
		if (this.state.status === "idle") {
			this.update(initialState());
		}
	}
	public end = (): Promise<void> => {
		if (this.closing) {
			return this.closing;
		}
		if (this.state.status === "idle") {
			return Promise.resolve();
		}
		this.abort?.abort();
		clearTimeout(this.deadline);
		clearInterval(this.ticker);
		this.commitGeminiUsage();
		this.update({
			status: "ending",
			elapsed: this.startedAt
				? Math.floor((Date.now() - this.startedAt) / 1000)
				: 0,
			inputLevel: 0,
			outputLevel: 0,
			userSpeaking: false,
			assistantSpeaking: false,
		});
		const socket = this.socket;
		this.socket = undefined;
		if (socket) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			try {
				socket.close();
			} catch {
				this.update({ error: "Could not close the voice connection." });
			}
		}
		this.finalizeAudio();
		this.closing = (async () => {
			const results = await Promise.allSettled([
				this.microphone?.stop(),
				this.playback?.close(),
			]);
			for (const result of results) {
				if (result.status === "rejected") {
					// eslint-disable-next-line no-console -- Cleanup can finish after navigation.
					console.error(
						"Could not release voice call resources",
						result.reason,
					);
					this.update({ error: "Could not release voice call resources." });
				}
			}
			this.microphone = undefined;
			this.playback = undefined;
			this.update({ status: "idle" });
			this.dependencies.onEnded(this.state);
		})();
		return this.closing;
	};
}
