import type { paths } from "@/lib/api/v1";
import type { VideoJob } from "@llmgateway/shared/video-generation-config";
import type { Client } from "openapi-fetch";

export * from "@llmgateway/shared/video-generation-config";

export function downloadVideo(url: string, filename?: string) {
	const name = filename ?? `video-${Date.now()}.mp4`;
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
	"expired",
]);

export const POLL_TIMEOUT_ERROR_CODE = "poll_timeout";

export class VideoPollError extends Error {
	public constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "VideoPollError";
	}
}

export function videoContentUrl(jobId: string): string {
	return `/api/video/${jobId}/content`;
}

// A saved model result whose job was created but has neither finished nor
// failed; the page resumes polling it.
export function isPendingVideoModel(model: {
	jobId?: string | null;
	videoUrl: string | null;
	error?: string;
}): boolean {
	return !!model.jobId && model.videoUrl === null && !model.error;
}

// Matches the worker's job timeout, so a live page keeps polling for as long
// as the gateway can still complete the job.
const MAX_POLL_DURATION_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 10;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function pollDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

export async function* pollVideoJob(
	videoId: string,
	fetchClient: Client<paths>,
	signal?: AbortSignal,
): AsyncGenerator<VideoJob> {
	const startTime = Date.now();
	let consecutiveErrors = 0;

	while (true) {
		if (signal?.aborted) {
			return;
		}

		const elapsed = Date.now() - startTime;
		if (elapsed > MAX_POLL_DURATION_MS) {
			yield {
				id: videoId,
				object: "video",
				model: "",
				status: "failed",
				progress: null,
				created_at: Math.floor(startTime / 1000),
				completed_at: null,
				expires_at: null,
				error: {
					code: POLL_TIMEOUT_ERROR_CODE,
					message:
						"Video generation is taking longer than expected. It will show up in your history once it finishes.",
				},
			};
			return;
		}

		let result: Awaited<ReturnType<Client<paths>["GET"]>>;
		try {
			result = await fetchClient.GET("/video/{videoId}", {
				params: { path: { videoId } },
				signal,
				cache: "no-store",
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				return;
			}
			consecutiveErrors++;
			if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				throw new VideoPollError(
					`Poll failed after ${consecutiveErrors} consecutive network errors`,
				);
			}
			await pollDelay(Math.min(consecutiveErrors * 2_000, 10_000), signal);
			continue;
		}

		if (!result.response.ok) {
			if (TRANSIENT_STATUS_CODES.has(result.response.status)) {
				consecutiveErrors++;
				if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
					throw new VideoPollError(
						`Poll failed: ${result.response.status} (after ${consecutiveErrors} retries)`,
						result.response.status,
					);
				}
				await pollDelay(Math.min(consecutiveErrors * 2_000, 10_000), signal);
				continue;
			}
			throw new VideoPollError(
				`Poll failed: ${result.response.status}`,
				result.response.status,
			);
		}

		consecutiveErrors = 0;

		const job = result.data as VideoJob;
		yield job;

		if (TERMINAL_STATUSES.has(job.status)) {
			return;
		}

		// If content URL is already available even though status isn't terminal,
		// treat it as completed
		if (job.content?.[0]?.url) {
			yield { ...job, status: "completed" };
			return;
		}

		const delay =
			elapsed < 30_000
				? 2_000
				: elapsed < 60_000
					? 3_000
					: elapsed < 120_000
						? 5_000
						: 10_000;

		await pollDelay(delay, signal);
	}
}
