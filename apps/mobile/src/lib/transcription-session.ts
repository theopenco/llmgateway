import { z } from "zod";

import type { Microphone } from "@/lib/microphone";

export type TranscriptionStatus =
	| "idle"
	| "microphone"
	| "minting"
	| "connecting"
	| "configuring"
	| "live"
	| "ending";
export interface TranscriptSegment {
	id: string;
	text: string;
	status: "partial" | "complete" | "failed";
	error?: string;
}
export interface TranscriptionState {
	status: TranscriptionStatus;
	segments: TranscriptSegment[];
	muted: boolean;
	level: number;
	speaking: boolean;
	uncommitted: boolean;
	elapsed: number;
	error: string | null;
	usage: {
		segments: number;
		seconds: number;
		inputTokens: number;
		outputTokens: number;
	};
}
export interface RealtimeSocket {
	readyState: number;
	bufferedAmount?: number;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: (() => void) | null;
	onclose: (() => void) | null;
	send: (data: string) => void;
	close: () => void;
}
interface SessionDependencies {
	microphone: () => Microphone;
	mint: (
		model: string,
		signal: AbortSignal,
	) => Promise<{ secret: string; url: string; model: string }>;
	connect: (url: string, protocols: string[]) => RealtimeSocket;
}
const eventSchema = z.object({
	type: z.string(),
	item_id: z.string().optional(),
	delta: z.string().optional(),
	transcript: z.string().optional(),
	error: z.object({ message: z.string().optional() }).optional(),
	usage: z
		.object({
			seconds: z.number().optional(),
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
		})
		.optional(),
});
function initialState(): TranscriptionState {
	return {
		status: "idle",
		segments: [],
		muted: false,
		level: 0,
		speaking: false,
		uncommitted: false,
		elapsed: 0,
		error: null,
		usage: { segments: 0, seconds: 0, inputTokens: 0, outputTokens: 0 },
	};
}

export class TranscriptionSession {
	private state = initialState();
	private listeners = new Set<() => void>();
	private abort?: AbortController;
	private microphone?: Microphone;
	private socket?: RealtimeSocket;
	private release?: Promise<void>;
	private finishing?: Promise<void>;
	private timeout?: ReturnType<typeof setTimeout>;
	private ticker?: ReturnType<typeof setInterval>;
	private pending = new Set<string>();
	private awaitingCommit = false;
	private manual = false;
	private model = "";
	private lastMeterAt = 0;
	private startedAt = 0;
	private congestedAt: number | null = null;
	public constructor(private readonly dependencies: SessionDependencies) {}
	public getSnapshot = () => this.state;
	public subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private update(patch: Partial<TranscriptionState>) {
		this.state = { ...this.state, ...patch };
		this.listeners.forEach((listener) => listener());
	}
	public async start(model: string, manual: boolean) {
		if (this.state.status !== "idle") {
			return;
		}
		this.finishing = undefined;
		this.release = undefined;
		this.pending.clear();
		this.awaitingCommit = false;
		this.manual = manual;
		this.model = model;
		this.congestedAt = null;
		this.abort = new AbortController();
		const signal = this.abort.signal;
		this.microphone = this.dependencies.microphone();
		this.update({ ...initialState(), status: "microphone" });
		try {
			await this.microphone.start(this.audio, (error) =>
				this.fail(error.message),
			);
			signal.throwIfAborted();
			this.update({ status: "minting" });
			const session = await this.dependencies.mint(model, signal);
			signal.throwIfAborted();
			this.model = session.model;
			this.update({ status: "connecting" });
			this.socket = this.dependencies.connect(session.url, [
				"realtime",
				`openai-insecure-api-key.${session.secret}`,
			]);
			this.socket.onopen = () => this.update({ status: "configuring" });
			this.socket.onmessage = ({ data }) => this.message(data);
			this.socket.onerror = () =>
				this.fail("The transcription connection failed. Try again.");
			this.socket.onclose = () => {
				if (this.state.status !== "ending") {
					this.update({ error: "The transcription connection closed." });
				} else if (this.pending.size || this.awaitingCommit) {
					this.update({
						error: "The connection closed before the final transcript arrived.",
					});
				}
				void this.finish();
			};
			this.timeout = setTimeout(
				() => this.fail("The transcription connection timed out."),
				20_000,
			);
		} catch (error) {
			if (!signal.aborted) {
				this.fail(
					error instanceof Error
						? error.message
						: "Could not start transcription.",
				);
			}
		}
	}
	private send(event: Record<string, unknown>) {
		if (this.socket?.readyState !== 1) {
			return false;
		}
		try {
			this.socket.send(JSON.stringify(event));
			return true;
		} catch {
			this.fail("Could not send audio to the transcription session.");
			return false;
		}
	}
	private audio = (audio: string, level: number) => {
		if (this.state.status !== "live" || this.state.muted) {
			return;
		}
		if ((this.socket?.bufferedAmount ?? 0) > 1024 * 1024) {
			this.congestedAt ??= Date.now();
			if (Date.now() - this.congestedAt > 3000) {
				this.fail(
					"The connection is too slow for live audio. Try again on a stronger connection.",
				);
			}
			return;
		}
		this.congestedAt = null;
		if (!this.send({ type: "input_audio_buffer.append", audio })) {
			return;
		}
		if (this.manual && !this.state.uncommitted) {
			this.update({ uncommitted: true });
		}
		if (Date.now() - this.lastMeterAt >= 80) {
			this.lastMeterAt = Date.now();
			this.update({ level, ...(this.manual ? { speaking: level > 0.2 } : {}) });
		}
	};
	private message(data: unknown) {
		let raw: unknown;
		try {
			if (typeof data !== "string") {
				throw new Error("Expected a text event.");
			}
			raw = JSON.parse(data);
		} catch {
			this.fail("The transcription server sent an unreadable event.");
			return;
		}
		const parsed = eventSchema.safeParse(raw);
		if (!parsed.success) {
			this.fail("The transcription server sent an invalid event.");
			return;
		}
		const event = parsed.data;
		switch (event.type) {
			case "session.created":
				this.send({
					type: "session.update",
					session: {
						type: "transcription",
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24000 },
								transcription: { model: this.model },
								turn_detection: this.manual ? null : { type: "server_vad" },
							},
						},
					},
				});
				break;
			case "session.updated":
				if (
					this.state.status !== "configuring" &&
					this.state.status !== "connecting"
				) {
					break;
				}
				clearTimeout(this.timeout);
				this.startedAt = Date.now();
				this.update({ status: "live" });
				this.ticker = setInterval(
					() =>
						this.update({
							elapsed: Math.floor((Date.now() - this.startedAt) / 1000),
						}),
					1000,
				);
				break;
			case "input_audio_buffer.speech_started":
				this.update({ speaking: true, uncommitted: true });
				break;
			case "input_audio_buffer.speech_stopped":
				this.awaitingCommit = true;
				this.update({ speaking: false, uncommitted: false });
				break;
			case "input_audio_buffer.committed":
				this.awaitingCommit = false;
				if (event.item_id) {
					this.pending.add(event.item_id);
					if (
						!this.state.segments.some((segment) => segment.id === event.item_id)
					) {
						this.update({
							segments: [
								...this.state.segments,
								{ id: event.item_id, text: "", status: "partial" },
							],
						});
					}
				}
				this.update({ uncommitted: this.manual && this.state.uncommitted });
				break;
			case "conversation.item.input_audio_transcription.delta":
			case "conversation.item.input_audio_transcription.completed":
			case "conversation.item.input_audio_transcription.failed": {
				if (!event.item_id) {
					this.fail("A transcript event is missing its segment identifier.");
					return;
				}
				const id = event.item_id;
				const existing = this.state.segments.find(
					(segment) => segment.id === id,
				);
				// Providers may redeliver terminal events after a reconnect upstream.
				if (existing && existing.status !== "partial") {
					break;
				}
				const complete = event.type.endsWith(".completed");
				const failed = event.type.endsWith(".failed");
				if (complete || failed) {
					this.pending.delete(id);
				} else {
					this.pending.add(id);
				}
				const segment: TranscriptSegment = {
					id,
					text: complete
						? (event.transcript ?? existing?.text ?? "")
						: (existing?.text ?? "") + (event.delta ?? ""),
					status: complete ? "complete" : failed ? "failed" : "partial",
					...(failed
						? {
								error:
									event.error?.message ??
									"This segment could not be transcribed.",
							}
						: {}),
				};
				this.update({
					segments: existing
						? this.state.segments.map((entry) =>
								entry.id === id ? segment : entry,
							)
						: [...this.state.segments, segment],
					...(complete
						? {
								usage: {
									segments: this.state.usage.segments + 1,
									seconds:
										this.state.usage.seconds + (event.usage?.seconds ?? 0),
									inputTokens:
										this.state.usage.inputTokens +
										(event.usage?.input_tokens ?? 0),
									outputTokens:
										this.state.usage.outputTokens +
										(event.usage?.output_tokens ?? 0),
								},
							}
						: {}),
				});
				break;
			}
			case "error":
				this.update({
					error:
						event.error?.message ??
						"The transcription server reported an error.",
				});
				this.awaitingCommit = false;
				break;
		}
		if (
			this.state.status === "ending" &&
			this.state.uncommitted &&
			!this.awaitingCommit
		) {
			this.awaitingCommit = true;
			this.update({ uncommitted: false });
			this.send({ type: "input_audio_buffer.commit" });
		}
		if (
			this.state.status === "ending" &&
			!this.awaitingCommit &&
			!this.pending.size
		) {
			void this.finish();
		}
	}
	public setMuted(muted: boolean) {
		if (this.state.status === "live") {
			this.update({ muted, level: 0, speaking: false });
		}
	}
	public commit() {
		if (
			this.state.status !== "live" ||
			!this.state.uncommitted ||
			this.awaitingCommit
		) {
			return;
		}
		this.awaitingCommit = true;
		this.update({ uncommitted: false });
		this.send({ type: "input_audio_buffer.commit" });
	}
	public stop() {
		if (this.state.status === "idle" || this.state.status === "ending") {
			return;
		}
		if (this.state.status !== "live") {
			void this.finish();
			return;
		}
		clearInterval(this.ticker);
		this.update({ status: "ending", level: 0, speaking: false });
		void this.releaseMicrophone();
		if (this.state.uncommitted && !this.awaitingCommit) {
			this.awaitingCommit = true;
			this.update({ uncommitted: false });
			this.send({ type: "input_audio_buffer.commit" });
		}
		if (!this.awaitingCommit && !this.pending.size) {
			void this.finish();
			return;
		}
		this.timeout = setTimeout(() => {
			this.update({
				error:
					"Stopped waiting for the final transcript. Partial text has been kept.",
			});
			void this.finish();
		}, 5000);
	}
	public reset() {
		if (this.state.status === "idle") {
			this.update(initialState());
		}
	}
	private fail(message: string) {
		this.update({ error: message });
		void this.finish();
	}
	private releaseMicrophone() {
		this.release ??= (this.microphone?.stop() ?? Promise.resolve()).catch(
			(error: unknown) => {
				// eslint-disable-next-line no-console -- Cleanup can finish after the screen unmounts.
				console.error("Could not release the microphone", error);
				this.update({
					error:
						error instanceof Error
							? error.message
							: "Could not release the microphone.",
				});
			},
		);
		return this.release;
	}
	public finish = (): Promise<void> => {
		if (this.finishing) {
			return this.finishing;
		}
		this.abort?.abort();
		clearTimeout(this.timeout);
		clearInterval(this.ticker);
		if (this.socket) {
			this.socket.onopen = null;
			this.socket.onmessage = null;
			this.socket.onerror = null;
			this.socket.onclose = null;
			this.socket.close();
			this.socket = undefined;
		}
		this.update({ status: "ending", level: 0, speaking: false });
		this.finishing = this.releaseMicrophone().then(() =>
			this.update({ status: "idle", uncommitted: false }),
		);
		return this.finishing;
	};
}
