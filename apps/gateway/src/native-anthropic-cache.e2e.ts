import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

// Generate a system prompt long enough to cross Anthropic's minimum cacheable
// threshold for Haiku 4.5 (>= ~2k tokens). 500 repeats produces ~6.5k tokens.
function buildLongSystemPrompt(): string {
	return (
		"You are a helpful AI assistant. " +
		"This is detailed context information that should be cached for optimal efficiency. ".repeat(
			500,
		) +
		"Please analyze carefully."
	);
}

// Anthropic's prompt cache writes are eventually consistent — back-to-back
// requests sometimes miss the cache the first time. Retry with a short backoff.
async function sendUntilCacheRead(
	send: () => Promise<{ status: number; json: any }>,
	maxAttempts = 4,
): Promise<{ status: number; json: any; attempts: number }> {
	let last: { status: number; json: any } = { status: 0, json: null };
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		last = await send();
		if (last.status !== 200) {
			return { ...last, attempts: attempt };
		}
		const usage = last.json?.usage;
		const cacheRead =
			usage?.cache_read_input_tokens ??
			usage?.prompt_tokens_details?.cached_tokens ??
			0;
		if (cacheRead > 0) {
			return { ...last, attempts: attempt };
		}
		if (attempt < maxAttempts) {
			await new Promise((r) => setTimeout(r, 500 * attempt));
		}
	}
	return { ...last, attempts: maxAttempts };
}

const hasAnthropicKey = !!process.env.LLM_ANTHROPIC_API_KEY;
const hasBedrockKey = !!process.env.LLM_AWS_BEDROCK_API_KEY;

function assertCacheBilled(usage: any) {
	const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
	const promptCost = usage?.cost_details?.upstream_inference_prompt_cost;
	if (cachedTokens === 0) {
		return;
	}
	expect(typeof promptCost).toBe("number");
	expect(promptCost).toBeGreaterThan(0);

	const promptTokens = usage?.prompt_tokens ?? 0;
	const nonCachedTokens = Math.max(0, promptTokens - cachedTokens);
	const inputCost = usage?.cost_details?.input_cost;
	const cachedInputCost = usage?.cost_details?.cached_input_cost;
	expect(typeof inputCost).toBe("number");
	expect(typeof cachedInputCost).toBe("number");
	expect(cachedInputCost).toBeGreaterThan(0);
	if (nonCachedTokens > 0) {
		const perTokenInput = inputCost / nonCachedTokens;
		const perTokenCached = cachedInputCost / cachedTokens;
		expect(perTokenCached).toBeLessThan(perTokenInput);
	}
}

async function readSseChunks(stream: ReadableStream<Uint8Array> | null) {
	if (!stream) {
		return [] as any[];
	}
	const reader = stream.getReader();
	const chunks: any[] = [];
	let buffer = "";
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("data: ")) {
				continue;
			}
			const payload = line.slice(6).trim();
			if (!payload || payload === "[DONE]") {
				continue;
			}
			try {
				chunks.push(JSON.parse(payload));
			} catch {
				// ignore non-JSON keepalives
			}
		}
	}
	return chunks;
}

describe("e2e native /v1/messages cache", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	(hasAnthropicKey ? test : test.skip)(
		"native messages forwards explicit cache_control and surfaces cache token usage",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "anthropic/claude-haiku-4-5",
				max_tokens: 50,
				system: [
					{
						type: "text" as const,
						text: longText,
						cache_control: { type: "ephemeral" as const },
					},
				],
				messages: [
					{
						role: "user" as const,
						content: "Just reply OK.",
					},
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				const json = await res.json();
				if (logMode) {
					console.log(
						"native /v1/messages",
						requestId,
						"status",
						res.status,
						"usage",
						JSON.stringify(json.usage),
					);
				}
				return { status: res.status, json };
			};

			// Prime the cache (first call may write, second should read).
			const first = await send();
			expect(first.status).toBe(200);
			expect(first.json.usage).toBeDefined();
			expect(typeof first.json.usage.input_tokens).toBe("number");
			expect(typeof first.json.usage.output_tokens).toBe("number");

			// Retry the second call until Anthropic reports a cache read, to
			// avoid flakiness from cache-write propagation latency.
			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(
				second.json.usage.cache_read_input_tokens,
				`expected cache_read_input_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);

			// Sanity: input_tokens should be the *non-cached* input tokens, not
			// the total. The cached portion lives in cache_read_input_tokens.
			expect(second.json.usage.input_tokens).toBeLessThan(
				second.json.usage.cache_read_input_tokens,
			);

			assertCacheBilled(second.json.usage);
		},
	);

	(hasAnthropicKey ? test : test.skip)(
		"openai-compat /v1/chat/completions surfaces cached tokens for anthropic",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "anthropic/claude-haiku-4-5",
				messages: [
					{ role: "system", content: longText },
					{ role: "user", content: "Just reply OK." },
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				const json = await res.json();
				if (logMode) {
					console.log(
						"openai-compat",
						requestId,
						"status",
						res.status,
						"usage",
						JSON.stringify(json.usage),
					);
				}
				return { status: res.status, json };
			};

			const first = await send();
			expect(first.status).toBe(200);

			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(second.json.usage.prompt_tokens_details).toBeDefined();
			expect(
				second.json.usage.prompt_tokens_details.cached_tokens,
				`expected cached_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);

			assertCacheBilled(second.json.usage);
		},
	);

	// Bedrock pass-through: same surface as the openai-compat anthropic test
	// above, but routed through AWS Bedrock so we exercise the cachePoint path
	// in prepare-request-body and the bedrock streaming usage extraction.
	(hasBedrockKey ? test : test.skip)(
		"openai-compat /v1/chat/completions surfaces cached tokens for bedrock",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "aws-bedrock/claude-haiku-4-5",
				messages: [
					{ role: "system", content: longText },
					{ role: "user", content: "Just reply OK." },
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				const json = await res.json();
				if (logMode) {
					console.log(
						"openai-compat bedrock",
						requestId,
						"status",
						res.status,
						"usage",
						JSON.stringify(json.usage),
					);
				}
				return { status: res.status, json };
			};

			const first = await send();
			expect(first.status).toBe(200);

			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(second.json.usage.prompt_tokens_details).toBeDefined();
			expect(
				second.json.usage.prompt_tokens_details.cached_tokens,
				`expected cached_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);

			assertCacheBilled(second.json.usage);
		},
	);

	// Streaming Anthropic: verifies normalizeAnthropicUsage in
	// transform-streaming-to-openai surfaces cache token usage in streamed
	// chunks. Without this, billing/observability for streaming clients is
	// silently broken on Anthropic prompt cache reads.
	(hasAnthropicKey ? test : test.skip)(
		"streaming /v1/chat/completions surfaces cached tokens for anthropic",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "anthropic/claude-haiku-4-5",
				stream: true,
				messages: [
					{ role: "system", content: longText },
					{ role: "user", content: "Just reply OK." },
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				if (res.status !== 200) {
					return { status: res.status, json: await res.json() };
				}
				const chunks = await readSseChunks(res.body);
				let cachedTokens = 0;
				let usageChunk: any = null;
				for (const chunk of chunks) {
					const cached =
						chunk?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
					if (cached > cachedTokens) {
						cachedTokens = cached;
					}
					if (chunk?.usage) {
						usageChunk = chunk;
					}
				}
				if (logMode) {
					console.log(
						"streaming anthropic cache",
						requestId,
						"final usage",
						JSON.stringify(usageChunk?.usage),
					);
				}
				// Synthesize a json shape with .usage so the retry helper sees it.
				return {
					status: res.status,
					json: {
						usage: {
							prompt_tokens_details: { cached_tokens: cachedTokens },
							...usageChunk?.usage,
						},
					},
				};
			};

			const first = await send();
			expect(first.status).toBe(200);

			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(
				second.json.usage.prompt_tokens_details.cached_tokens,
				`expected streaming cached_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);
		},
	);

	// Streaming Bedrock: same as above but routed through Bedrock to exercise
	// extract-token-usage's bedrock branch that surfaces cacheWriteTokens /
	// cacheReadTokens through the streaming pipeline.
	(hasBedrockKey ? test : test.skip)(
		"streaming /v1/chat/completions surfaces cached tokens for bedrock",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "aws-bedrock/claude-haiku-4-5",
				stream: true,
				messages: [
					{ role: "system", content: longText },
					{ role: "user", content: "Just reply OK." },
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				if (res.status !== 200) {
					return { status: res.status, json: await res.json() };
				}
				const chunks = await readSseChunks(res.body);
				let cachedTokens = 0;
				let usageChunk: any = null;
				for (const chunk of chunks) {
					const cached =
						chunk?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
					if (cached > cachedTokens) {
						cachedTokens = cached;
					}
					if (chunk?.usage) {
						usageChunk = chunk;
					}
				}
				if (logMode) {
					console.log(
						"streaming bedrock cache",
						requestId,
						"final usage",
						JSON.stringify(usageChunk?.usage),
					);
				}
				return {
					status: res.status,
					json: {
						usage: {
							prompt_tokens_details: { cached_tokens: cachedTokens },
							...usageChunk?.usage,
						},
					},
				};
			};

			const first = await send();
			expect(first.status).toBe(200);

			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(
				second.json.usage.prompt_tokens_details.cached_tokens,
				`expected streaming cached_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);
		},
	);

	// Explicit cache_control on /v1/chat/completions: exercises the new
	// completions schema field that lets clients pass per-text-block
	// cache_control markers (Anthropic-style) through the OpenAI-compat
	// endpoint. Without this path, callers can't opt into caching from a
	// shorter-than-heuristic prompt or override the heuristic for placement.
	(hasAnthropicKey ? test : test.skip)(
		"openai-compat /v1/chat/completions honors explicit cache_control",
		getTestOptions(),
		async () => {
			const longText = buildLongSystemPrompt();
			const body = {
				model: "anthropic/claude-haiku-4-5",
				messages: [
					{
						role: "system",
						content: [
							{
								type: "text" as const,
								text: longText,
								cache_control: { type: "ephemeral" as const },
							},
						],
					},
					{ role: "user", content: "Just reply OK." },
				],
			};

			const send = async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify(body),
				});
				const json = await res.json();
				if (logMode) {
					console.log(
						"explicit cache_control",
						requestId,
						"status",
						res.status,
						"usage",
						JSON.stringify(json.usage),
					);
				}
				return { status: res.status, json };
			};

			const first = await send();
			expect(first.status).toBe(200);
			expect(first.json.usage.prompt_tokens_details).toBeDefined();

			const second = await sendUntilCacheRead(send);
			expect(second.status).toBe(200);
			expect(
				second.json.usage.prompt_tokens_details.cached_tokens,
				`expected cached_tokens > 0 after ${second.attempts} attempts`,
			).toBeGreaterThan(0);
		},
	);
});
