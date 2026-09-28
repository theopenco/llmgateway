import { isInternalApiOrigin } from "@/lib/api-origin.js";
import { logGatewayClientError } from "@/lib/client-error-log.js";
import { requestLogContext } from "@/lib/request-log-context.js";

import { logger, toError } from "@llmgateway/logger";
import { resolvePathRateLimit } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";
import type { ApiOrigin } from "@llmgateway/db";
import type { MiddlewareHandler } from "hono";

const origins: Record<string, ApiOrigin> = {
	chat_completions: "chat-completions",
	messages: "messages",
	responses: "responses",
	embeddings: "embeddings",
	moderations: "moderations",
	rerank: "rerank",
	ocr: "ocr",
	images: "images",
	audio_speech: "speech",
	audio_transcriptions: "transcriptions",
	videos: "videos",
	ai_sdk: "ai-sdk",
};

export const rejectionLogMiddleware: MiddlewareHandler<ServerTypes> = async (
	c,
	next,
) => {
	const config = resolvePathRateLimit(c.req.path);
	const apiOrigin = config && origins[config.key];
	if (
		c.req.method !== "POST" ||
		!apiOrigin ||
		(isInternalApiOrigin(c) && requestLogContext.getStore())
	) {
		return await next();
	}

	await requestLogContext.run({ logged: false }, async () => {
		await next();
		if (
			requestLogContext.getStore()?.logged ||
			c.res.status < 400 ||
			c.res.status >= 500
		) {
			return;
		}

		try {
			const body: unknown = await c.res.clone().json();
			if (typeof body !== "object" || body === null || !("error" in body)) {
				return;
			}
			const error = body.error;
			if (
				typeof error !== "object" ||
				error === null ||
				!("message" in error) ||
				typeof error.message !== "string"
			) {
				return;
			}
			// Early rate limits must not read an unconsumed request body.
			let rawBody: unknown;
			try {
				rawBody = await c.req.bodyCache.json;
			} catch {
				logger.debug("Rejected request body could not be parsed");
				rawBody = undefined;
			}
			await logGatewayClientError(c, {
				apiOrigin,
				rawBody,
				message: error.message,
				cause:
					"code" in error && typeof error.code === "string"
						? error.code
						: "gateway_rejection",
				statusCode: c.res.status,
				errorCategory:
					c.res.status === 429 &&
					c.res.headers.get("RateLimit-Policy")?.includes("concurrency")
						? "concurrency_limit"
						: undefined,
			});
		} catch (error) {
			logger.warn("Failed to log gateway rejection", { err: toError(error) });
		}
	});
};
