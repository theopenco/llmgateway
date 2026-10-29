import { HTTPException } from "hono/http-exception";

import { processImageUrl } from "@llmgateway/actions";

/**
 * Decodes a data URL or downloads an image URL through the SSRF guard. The
 * download stops when `signal` aborts: the client disconnected or the image
 * deadline passed.
 */
export async function loadDecisionImage(
	url: string,
	maxSizeMB: number,
	signal: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
	try {
		return await processImageUrl(
			url,
			process.env.NODE_ENV === "production",
			maxSizeMB,
			null,
			signal,
		);
	} catch (error) {
		if (signal.aborted) {
			if (
				signal.reason instanceof DOMException &&
				signal.reason.name === "TimeoutError"
			) {
				throw new HTTPException(400, {
					message: "Invalid image input: downloading the images timed out",
				});
			}
			throw error;
		}
		throw new HTTPException(400, {
			message:
				error instanceof Error
					? `Invalid image input: ${error.message}`
					: "Invalid image input",
		});
	}
}
