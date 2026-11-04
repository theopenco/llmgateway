/**
 * Tracks a duration-billed realtime session (xAI Grok Voice) against the
 * provider's own meter. xAI reports `billable_audio_seconds` on each
 * response.done as the conversation's running total: session time from the
 * first audio or response, silences included, and running ahead of wall time
 * when audio is sent faster than real time. Each report is billed as its
 * increase over the last billed total.
 *
 * Time accrued after the last report is never reported, so the session bills
 * it on close from the gateway's own clock and the input audio it forwarded.
 */
export class RealtimeDurationMeter {
	private billedSeconds = 0;
	private startedAt: number | null = null;
	private lastReportAt: number | null = null;
	private unreportedAudioSeconds = 0;
	// Bytes per second of the session's input audio format; null when it
	// cannot be derived from the byte count (opus).
	private inputBytesPerSecond: number | null = 24_000 * 2;

	public start(now: number): void {
		this.startedAt ??= now;
	}

	/**
	 * Apply an `audio.input.format` (GA) or `input_audio_format` (legacy)
	 * value from a forwarded session.update.
	 */
	public setInputFormat(format: unknown): void {
		if (typeof format === "string") {
			this.inputBytesPerSecond =
				format === "pcm16"
					? 24_000 * 2
					: format === "g711_ulaw" || format === "g711_alaw"
						? 8_000
						: null;
			return;
		}
		if (!format || typeof format !== "object") {
			return;
		}
		const { type, rate } = format as Record<string, unknown>;
		if (type === "audio/pcm") {
			this.inputBytesPerSecond =
				(typeof rate === "number" && rate > 0 ? rate : 24_000) * 2;
		} else if (type === "audio/pcmu" || type === "audio/pcma") {
			this.inputBytesPerSecond = 8_000;
		} else if (type !== undefined) {
			this.inputBytesPerSecond = null;
		}
	}

	public addInputAudio(base64: string, now: number): void {
		this.start(now);
		if (this.inputBytesPerSecond === null) {
			return;
		}
		const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
		const bytes = Math.max(Math.floor((base64.length * 3) / 4) - padding, 0);
		this.unreportedAudioSeconds += bytes / this.inputBytesPerSecond;
	}

	/**
	 * Seconds a reported running total adds over what is already billed. A
	 * total below the billed one is not new usage.
	 */
	public increase(total: number): number {
		return Math.max(total - this.billedSeconds, 0);
	}

	/** Record a reported total as billed, once its usage row is persisted. */
	public commit(total: number, now: number): void {
		this.billedSeconds = Math.max(this.billedSeconds, total);
		this.lastReportAt = now;
		this.unreportedAudioSeconds = 0;
	}

	/**
	 * Whole seconds accrued since the last report (or since the meter started):
	 * the larger of the elapsed time and the input audio forwarded since.
	 */
	public unreportedSeconds(now: number): number {
		const since = this.lastReportAt ?? this.startedAt;
		if (since === null) {
			return 0;
		}
		return Math.max(
			Math.floor((now - since) / 1000),
			Math.floor(this.unreportedAudioSeconds),
		);
	}
}
