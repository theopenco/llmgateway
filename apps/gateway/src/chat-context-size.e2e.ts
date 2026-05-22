import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	logMode,
	testModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";

import type { ProviderModelMapping } from "@llmgateway/models";

const contextSizeTest = process.env.CONTEXT_SIZE_TEST === "true";

const describeContextSize = contextSizeTest ? describe : describe.skip;

// Approximate characters per token for the natural-English filler below.
// Empirically the Anthropic tokenizer hits ~2 chars/token on dense content
// (alphabet/digit listings) and ~4 chars/token on plain prose. Using a
// conservative 3 keeps the resulting prompt under the advertised window
// across the providers we test even when their tokenizer is denser than
// the OpenAI/Anthropic BPE average.
const CHARS_PER_TOKEN = 3;

// Fraction of the advertised context window to fill with input.
const CONTEXT_FILL_RATIO = 0.7;

function getProviderContextSize(
	provider: ProviderModelMapping,
): number | undefined {
	return provider.contextSize;
}

const contextSizeModels = testModels
	.map((m) => {
		const provider = m.providers[0];
		const contextSize = getProviderContextSize(provider);
		return { ...m, contextSize };
	})
	.filter(
		(m): m is typeof m & { contextSize: number } =>
			typeof m.contextSize === "number" && m.contextSize > 0,
	);

function buildFillerContent(targetTokens: number): string {
	const targetChars = targetTokens * CHARS_PER_TOKEN;
	// Use a varied sentence so providers don't trivially compress repeated tokens.
	const sentence =
		"The quick brown fox jumps over the lazy dog near the riverbank, while curious sparrows watched from the old oak tree branches above. ";
	const repeats = Math.ceil(targetChars / sentence.length);
	return sentence.repeat(repeats).slice(0, targetChars);
}

describeContextSize("e2e context size", () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(contextSizeModels)(
		"context size $model ($contextSize tokens)",
		{ timeout: 900000, retry: 1 },
		async ({ model, contextSize }) => {
			const targetInputTokens = Math.floor(contextSize * CONTEXT_FILL_RATIO);
			const filler = buildFillerContent(targetInputTokens);

			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant. After reading the provided text, reply with exactly the word 'OK' and nothing else.",
						},
						{
							role: "user",
							content: `Here is a long passage of text:\n\n${filler}\n\nNow reply with 'OK'.`,
						},
					],
					max_tokens: 32,
				}),
			});

			const json = await res.json();
			if (logMode || res.status !== 200) {
				console.log(
					`context-size response (status ${res.status}):`,
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			validateResponse(json);

			const content = json.choices?.[0]?.message?.content;
			expect(typeof content).toBe("string");
			expect(content.length).toBeGreaterThan(0);

			expect(json).toHaveProperty("usage.prompt_tokens");
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
			// The provider should have actually processed a large input; verify it
			// is at least within a reasonable fraction of our target. Tokenizers
			// vary, so allow a wide lower bound (50% of target).
			expect(json.usage.prompt_tokens).toBeGreaterThan(
				Math.floor(targetInputTokens * 0.5),
			);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);
		},
	);
});
