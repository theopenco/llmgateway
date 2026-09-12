import { Hono } from "hono";

import { app } from "@/app.js";
import { internalApiOriginHeaders } from "@/lib/api-origin.js";
import { findApiKeyByToken } from "@/lib/cached-queries.js";
import { streamSSE } from "@/lib/pending-work.js";

import { logger } from "@llmgateway/logger";

import {
	asStatusCode,
	buildGatewayErrorBody,
	extractInnerErrorMessage,
} from "./errors.js";
import { languageModelCallOptionsSchema } from "./schemas.js";
import { parseSpecVersion } from "./spec.js";
import { buildChatRequest } from "./tools/build-chat-request.js";
import { buildConfigModels } from "./tools/build-config-models.js";
import { convertChatToGenerateResult } from "./tools/convert-chat-to-generate.js";
import {
	createStreamingPartsState,
	finalizeStream,
	processChatChunk,
} from "./tools/convert-streaming-to-parts.js";

import type { ChatCompletionResponse } from "./tools/convert-chat-to-generate.js";
import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

/**
 * AI SDK Gateway protocol surface.
 *
 * `@ai-sdk/gateway` — the provider the AI SDK resolves a bare `"provider/model"`
 * string through — speaks its own wire format rather than OpenAI's:
 * `LanguageModelV*CallOptions` in, `LanguageModelV*` content/stream parts out.
 * Implementing it means an app written against the Vercel AI Gateway runs here
 * with only its base URL repointed, no code change:
 *
 * ```ts
 * globalThis.AI_SDK_DEFAULT_PROVIDER = createGateway({
 *   baseURL: "https://api.llmgateway.io/v4/ai",
 *   apiKey: process.env.LLM_GATEWAY_API_KEY,
 * })
 * ```
 *
 * Everything routes through the internal `/v1/chat/completions` hop, so
 * routing, fallback, caching, billing and logging behave exactly as they do for
 * every other surface.
 */
export const aisdk = new Hono<ServerTypes>();

function bearerToken(authorization: string | undefined): string | undefined {
	const [scheme, token] = (authorization ?? "").split(" ");
	return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

/**
 * Headers forwarded onto the internal chat completions call. Mirrors the
 * `/v1/messages` and `/v1/responses` hops: presence-sensitive opt-outs are only
 * set when the caller actually sent them.
 */
function forwardedHeaders(c: Context<ServerTypes>): Record<string, string> {
	const passthrough = ["x-request-id", "x-source", "x-debug", "x-session-id"];
	const optional = ["x-no-fallback", "x-no-cache"];

	return {
		"Content-Type": "application/json",
		Authorization: c.req.header("Authorization") ?? "",
		"User-Agent": c.req.header("User-Agent") ?? "",
		"HTTP-Referer": c.req.header("HTTP-Referer") ?? "",
		...internalApiOriginHeaders("ai-sdk"),
		...Object.fromEntries(
			passthrough
				.map((name) => [name, c.req.header(name)])
				.filter((entry): entry is [string, string] => Boolean(entry[1])),
		),
		...Object.fromEntries(
			optional
				.map((name) => [name, c.req.header(name)])
				.filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
	};
}

aisdk.post("/language-model", async (c) => {
	const specVersion = parseSpecVersion(
		c.req.header("ai-language-model-specification-version"),
	);
	const modelId = c.req.header("ai-language-model-id")?.trim();
	const stream = c.req.header("ai-language-model-streaming") === "true";

	if (!modelId) {
		return c.json(
			buildGatewayErrorBody({
				status: 400,
				message:
					"Missing ai-language-model-id header: the model to call is carried in the header, not the body.",
			}),
			400,
		);
	}

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			buildGatewayErrorBody({
				status: 400,
				message: "Request body is not valid JSON",
			}),
			400,
		);
	}

	const parsed = languageModelCallOptionsSchema.safeParse(rawBody);
	if (!parsed.success) {
		return c.json(
			buildGatewayErrorBody({
				status: 400,
				message: `Invalid call options: ${parsed.error.issues
					.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
					.join("; ")}`,
			}),
			400,
		);
	}

	const { body, warnings, webSearchToolName } = buildChatRequest({
		options: parsed.data,
		modelId,
		stream,
		specVersion,
	});

	const response = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: forwardedHeaders(c),
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		const message = extractInnerErrorMessage(text, response.statusText);
		logger.warn("AI SDK -> chat completions request failed", {
			status: response.status,
			modelId,
		});
		return c.json(
			buildGatewayErrorBody({ status: response.status, message, modelId }),
			asStatusCode(response.status),
		);
	}

	if (!stream) {
		const completion = (await response.json()) as ChatCompletionResponse;
		return c.json(
			convertChatToGenerateResult({
				response: completion,
				specVersion,
				warnings,
				webSearchToolName,
			}),
		);
	}

	const innerCacheStatus = response.headers.get("x-llmgateway-cache");
	if (innerCacheStatus) {
		c.header("x-llmgateway-cache", innerCacheStatus);
	}

	return streamSSE(c, async (sseStream) => {
		const state = createStreamingPartsState({
			specVersion,
			webSearchToolName,
			includeRawChunks: parsed.data.includeRawChunks,
		});

		const write = async (part: object) => {
			await sseStream.writeSSE({ data: JSON.stringify(part) });
		};

		await write({ type: "stream-start", warnings });

		if (!response.body) {
			await write({
				type: "error",
				error: { message: "Upstream returned no response body" },
			});
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				// The final element is whatever came after the last newline; it may
				// be a partial line, so it stays buffered for the next read.
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) {
						continue;
					}
					const data = trimmed.slice(5).trim();
					if (!data || data === "[DONE]") {
						continue;
					}

					let chunk: Record<string, unknown>;
					try {
						chunk = JSON.parse(data);
					} catch {
						continue;
					}

					// The inner endpoint surfaces mid-stream failures as an error
					// envelope rather than an OpenAI chunk.
					if (chunk.error) {
						await write({ type: "error", error: chunk.error });
						continue;
					}

					for (const part of processChatChunk(state, chunk)) {
						await write(part);
					}
				}
			}

			for (const part of finalizeStream(state)) {
				await write(part);
			}
		} catch (error) {
			logger.error(
				"AI SDK stream translation failed",
				error instanceof Error ? error : new Error(String(error)),
			);
			await write({
				type: "error",
				error: {
					message:
						error instanceof Error
							? error.message
							: "Stream translation failed",
				},
			});
			// Still terminate the stream properly: without a `finish` part the AI
			// SDK consumer hangs waiting for one.
			for (const part of finalizeStream(state)) {
				await write(part);
			}
		} finally {
			reader.releaseLock();
		}
	});
});

aisdk.get("/config", async (c) => {
	const token = bearerToken(c.req.header("Authorization"));

	if (!token) {
		return c.json(
			buildGatewayErrorBody({ status: 401, message: "No API key provided" }),
			401,
		);
	}

	const apiKey = await findApiKeyByToken(token);
	if (!apiKey || apiKey.status !== "active") {
		return c.json(
			buildGatewayErrorBody({
				status: 401,
				message: "API key not found or inactive",
			}),
			401,
		);
	}

	return c.json({ models: buildConfigModels() });
});
