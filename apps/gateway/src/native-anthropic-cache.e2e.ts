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
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

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

// This suite tests hardcoded anthropic/bedrock model IDs, so it's not relevant
// when the run is scoped via TEST_MODELS to unrelated providers.
const describeCache = process.env.TEST_MODELS ? describe.skip : describe;

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

describeCache(
	"e2e native /v1/messages cache",
	getConcurrentTestOptions(),
	() => {
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

		// 1h cache TTL via /v1/messages: opts into Anthropic's 1h cache write rate
		// (2x base) and asserts the gateway round-trips both the request opt-in
		// and the response breakdown (usage.cache_creation.ephemeral_1h_input_tokens)
		// per Anthropic's spec, so SDK clients can attribute spend across rates.
		(hasAnthropicKey ? test : test.skip)(
			"native messages forwards 1h ttl and surfaces cache_creation breakdown",
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
							cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
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
							"native /v1/messages 1h",
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
				// On the priming call Anthropic should write to the 1h cache.
				// If the schema strips ttl, this falls back to 5m and the breakdown
				// either omits ephemeral_1h_input_tokens or reports 0.
				const firstBreakdown = first.json.usage?.cache_creation;
				if (first.json.usage?.cache_creation_input_tokens > 0) {
					expect(firstBreakdown).toBeDefined();
					expect(firstBreakdown.ephemeral_1h_input_tokens).toBeGreaterThan(0);
					expect(firstBreakdown.ephemeral_5m_input_tokens).toBe(0);
					expect(
						firstBreakdown.ephemeral_5m_input_tokens +
							firstBreakdown.ephemeral_1h_input_tokens,
					).toBe(first.json.usage.cache_creation_input_tokens);
				}
			},
		);

		// Regression: a caller-supplied ttl:"1h" marker in the *messages* (e.g.
		// RisuAI's rolling "Automatic Cache Point") must suppress the gateway's
		// heuristic 5m markers (long-system + turn-boundary). Anthropic requires
		// longer TTLs before shorter ones, so an injected 5m marker ahead of the
		// caller's 1h marker used to fail the whole request with "a ttl='1h'
		// cache_control block must not come after a ttl='5m' cache_control block".
		(hasAnthropicKey ? test : test.skip)(
			"native messages defers to caller 1h ttl markers in multi-turn conversations",
			getTestOptions(),
			async () => {
				const longText = buildLongSystemPrompt();
				const body = {
					model: "anthropic/claude-haiku-4-5",
					max_tokens: 50,
					system: longText,
					messages: [
						{ role: "user" as const, content: "Hello, who are you?" },
						{
							role: "assistant" as const,
							content: "I'm an assistant. How can I help?",
						},
						{
							role: "user" as const,
							content: [
								{
									type: "text" as const,
									text: "Just reply OK.",
									cache_control: {
										type: "ephemeral" as const,
										ttl: "1h" as const,
									},
								},
							],
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
							"native /v1/messages multi-turn 1h",
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
				// With auto-injection deferred, the only breakpoint is the caller's
				// 1h marker, so any cache write must be attributed entirely to the
				// 1h tier.
				const firstBreakdown = first.json.usage?.cache_creation;
				if (first.json.usage?.cache_creation_input_tokens > 0) {
					expect(firstBreakdown).toBeDefined();
					expect(firstBreakdown.ephemeral_1h_input_tokens).toBeGreaterThan(0);
					expect(firstBreakdown.ephemeral_5m_input_tokens).toBe(0);
				}
			},
		);

		// 1h cache TTL via Bedrock /v1/chat/completions: opts into Bedrock's 1h
		// cache write rate (2x base) on a model that supports it (Haiku 4.5) and
		// asserts the gateway forwards ttl:"1h" to the Converse API cachePoint and
		// surfaces the response breakdown
		// (prompt_tokens_details.cache_creation.ephemeral_1h_input_tokens) so SDK
		// clients can attribute spend across rates.
		(hasBedrockKey ? test : test.skip)(
			"openai-compat /v1/chat/completions forwards 1h ttl and surfaces cache_creation breakdown for bedrock",
			getTestOptions(),
			async () => {
				const longText = buildLongSystemPrompt();
				const body = {
					model: "aws-bedrock/claude-sonnet-4-6",
					messages: [
						{
							role: "system",
							content: [
								{
									type: "text" as const,
									text: longText,
									cache_control: {
										type: "ephemeral" as const,
										ttl: "1h" as const,
									},
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
							"openai-compat bedrock 1h",
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
				// On the priming call Bedrock should write to the 1h cache. If
				// prepare-request-body strips ttl, the write falls back to 5m and
				// ephemeral_1h_input_tokens will be 0 / absent.
				const cacheWriteTokens =
					first.json.usage?.prompt_tokens_details?.cache_creation_tokens ??
					first.json.usage?.prompt_tokens_details?.cache_write_tokens ??
					0;
				if (cacheWriteTokens > 0) {
					const breakdown =
						first.json.usage?.prompt_tokens_details?.cache_creation;
					expect(breakdown).toBeDefined();
					expect(breakdown.ephemeral_1h_input_tokens).toBeGreaterThan(0);
					expect(breakdown.ephemeral_5m_input_tokens).toBe(0);
					expect(
						breakdown.ephemeral_5m_input_tokens +
							breakdown.ephemeral_1h_input_tokens,
					).toBe(cacheWriteTokens);
				}
			},
		);

		// Streaming /v1/messages must surface non-zero usage tokens in the final
		// message_delta event. The upstream /v1/chat/completions endpoint emits
		// `finish_reason` and the `usage` payload in *separate* chunks (the usage
		// chunk has finish_reason: null). Before the fix, the Anthropic translator
		// only read usage when it saw finish_reason, so message_delta carried
		// zeros for input_tokens/output_tokens. Run for each provider since the
		// chunk ordering depends on the upstream.
		const streamingUsageBody = (model: string) => ({
			model,
			max_tokens: 50,
			stream: true,
			messages: [{ role: "user" as const, content: "What is 2+2?" }],
		});

		const assertStreamingUsage = async (model: string, label: string) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"anthropic-version": "2023-06-01",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify(streamingUsageBody(model)),
			});
			expect(res.status).toBe(200);

			const chunks = await readSseChunks(res.body);
			const messageDelta = chunks.find((c) => c?.type === "message_delta");
			const messageStop = chunks.find((c) => c?.type === "message_stop");
			const messageDeltaCount = chunks.filter(
				(c) => c?.type === "message_delta",
			).length;

			if (logMode) {
				console.log(
					label,
					requestId,
					"message_delta usage",
					JSON.stringify(messageDelta?.usage),
					"count",
					messageDeltaCount,
				);
			}

			expect(messageDelta, "missing message_delta event").toBeDefined();
			expect(messageStop, "missing message_stop event").toBeDefined();
			expect(messageDeltaCount).toBe(1);
			expect(messageDelta.usage.input_tokens).toBeGreaterThan(0);
			expect(messageDelta.usage.output_tokens).toBeGreaterThan(0);
		};

		(hasAnthropicKey ? test : test.skip)(
			"streaming /v1/messages surfaces non-zero usage tokens for anthropic",
			getTestOptions(),
			async () => {
				await assertStreamingUsage(
					"anthropic/claude-haiku-4-5",
					"streaming /v1/messages anthropic usage",
				);
			},
		);

		(hasBedrockKey ? test : test.skip)(
			"streaming /v1/messages surfaces non-zero usage tokens for bedrock",
			getTestOptions(),
			async () => {
				await assertStreamingUsage(
					"aws-bedrock/claude-haiku-4-5",
					"streaming /v1/messages bedrock usage",
				);
			},
		);

		// Log persistence of the per-TTL cache write breakdown. The response has
		// always carried usage.cache_creation, but the log record previously only
		// stored the total cacheWriteTokens, so the dashboard couldn't attribute
		// spend across the 1.25x (5m) and 2x (1h) write rates after the fact.
		// A unique run tag guarantees a cache WRITE (not a read) on every run.
		const logBreakdownRunTag = `log-breakdown-${Date.now()}`;

		function buildUniqueLongSystemPrompt(tag: string): string {
			return (
				`You are a helpful AI assistant. Run tag: ${tag}. ` +
				"This is detailed context information that should be cached for optimal efficiency. ".repeat(
					400,
				) +
				"Please analyze carefully."
			);
		}

		(hasAnthropicKey ? test : test.skip)(
			"non-streaming /v1/messages 1h write persists cacheWrite1hTokens in the log",
			getTestOptions(),
			async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: "anthropic/claude-haiku-4-5",
						max_tokens: 50,
						system: [
							{
								type: "text" as const,
								text: buildUniqueLongSystemPrompt(`${logBreakdownRunTag}-1h`),
								cache_control: {
									type: "ephemeral" as const,
									ttl: "1h" as const,
								},
							},
						],
						messages: [{ role: "user" as const, content: "Just reply OK." }],
					}),
				});
				const json = await res.json();
				expect(res.status).toBe(200);
				expect(json.usage.cache_creation_input_tokens).toBeGreaterThan(0);

				const logRow = await waitForLogByRequestId(requestId);
				if (logMode) {
					console.log("1h breakdown log row", {
						cacheWriteTokens: logRow.cacheWriteTokens,
						cacheWrite5mTokens: logRow.cacheWrite5mTokens,
						cacheWrite1hTokens: logRow.cacheWrite1hTokens,
					});
				}
				expect(Number(logRow.cacheWriteTokens)).toBeGreaterThan(0);
				expect(Number(logRow.cacheWrite1hTokens)).toBe(
					Number(logRow.cacheWriteTokens),
				);
				expect(Number(logRow.cacheWrite5mTokens ?? 0)).toBe(0);
			},
		);

		(hasAnthropicKey ? test : test.skip)(
			"streaming /v1/chat/completions 5m write persists cacheWrite5mTokens in the log",
			getTestOptions(),
			async () => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: "anthropic/claude-haiku-4-5",
						stream: true,
						messages: [
							{
								role: "system",
								content: buildUniqueLongSystemPrompt(
									`${logBreakdownRunTag}-5m`,
								),
							},
							{ role: "user", content: "Just reply OK." },
						],
					}),
				});
				expect(res.status).toBe(200);
				await readSseChunks(res.body);

				const logRow = await waitForLogByRequestId(requestId);
				if (logMode) {
					console.log("5m streaming breakdown log row", {
						cacheWriteTokens: logRow.cacheWriteTokens,
						cacheWrite5mTokens: logRow.cacheWrite5mTokens,
						cacheWrite1hTokens: logRow.cacheWrite1hTokens,
					});
				}
				expect(Number(logRow.cacheWriteTokens)).toBeGreaterThan(0);
				expect(Number(logRow.cacheWrite5mTokens)).toBe(
					Number(logRow.cacheWriteTokens),
				);
				expect(Number(logRow.cacheWrite1hTokens ?? 0)).toBe(0);
			},
		);
	},
);
