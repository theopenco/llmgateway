import { extractFinalAnswer, normalizeAnswer } from "./quality.js";

import type { BenchmarkCase } from "@/types.js";

function fixedSequence(length: number): string {
	return Array.from({ length }, (_, index) => index + 1).join(" ");
}

function fixedOutputCase(
	id: string,
	length: number,
	options: { concurrency?: number; runs?: number; warmup?: number } = {},
): BenchmarkCase {
	const sequence = fixedSequence(length);
	return {
		id,
		name: `${length} token fixed output stream`,
		kind: "performance",
		category: "streaming",
		dimension: "decode",
		description:
			"Measures visible TTFT, total latency, decode throughput, chunk stalls, and buffering for an exact output.",
		defaultRuns: options.runs ?? 5,
		defaultWarmupRuns: options.warmup ?? 1,
		defaultConcurrency: options.concurrency,
		request: (context) => ({
			messages: [
				{
					role: "system",
					content:
						"Follow the requested output format exactly and do not add commentary.",
				},
				{
					role: "user",
					content: `Respond with exactly one line whose entire content is "FINAL: ${sequence}". Do not repeat the sequence. Ignore benchmark nonce ${context.seed}.`,
				},
			],
			maxTokens: Math.max(128, Math.ceil(length * 1.8)),
			reasoningEffort: "none",
			temperature: 0,
		}),
		parameters: (context) => ({
			seed: context.seed,
			outputLength: length,
			...(options.concurrency ? { concurrency: options.concurrency } : {}),
		}),
		evaluate: (response) => {
			const answer = extractFinalAnswer(response.content);
			const expected = normalizeAnswer(sequence);
			return {
				passed: answer === expected,
				answer,
				expected,
				detail:
					answer === expected
						? "Fixed output matched"
						: "Fixed output did not match",
			};
		},
	};
}

function inputLengthCase(words: number): BenchmarkCase {
	const nonce = `INPUT_${words}_OK`;
	const filler = Array.from(
		{ length: words },
		(_, index) => `archive${index % 97}`,
	).join(" ");
	return {
		id: `input_length_${words}`,
		name: `${words} word input`,
		kind: "performance",
		category: "prefill",
		dimension: "prefill",
		description: "Measures TTFT as input size grows.",
		defaultRuns: 3,
		defaultWarmupRuns: 1,
		request: {
			messages: [
				{
					role: "system",
					content: "Return only the requested FINAL line.",
				},
				{
					role: "user",
					content: `${filler}\nThe required answer is ${nonce}. Return FINAL: ${nonce}`,
				},
			],
			maxTokens: 64,
			reasoningEffort: "none",
			temperature: 0,
		},
		parameters: () => ({ inputWords: words }),
		evaluate: (response) => {
			const answer = extractFinalAnswer(response.content);
			const expected = normalizeAnswer(nonce);
			return { passed: answer === expected, answer, expected };
		},
	};
}

export const performanceCases: BenchmarkCase[] = [
	fixedOutputCase("fixed_output_stream", 100),
];

export const loadCases: BenchmarkCase[] = [
	fixedOutputCase("output_length_32", 32, { runs: 10 }),
	fixedOutputCase("output_length_256", 256, { runs: 10 }),
	fixedOutputCase("output_length_1024", 1_024, { runs: 5 }),
	inputLengthCase(1_000),
	inputLengthCase(8_000),
	inputLengthCase(32_000),
	...([1, 2, 4, 8, 16] as const).map((concurrency) =>
		fixedOutputCase(`concurrency_${concurrency}`, 64, {
			concurrency,
			runs: Math.max(20, concurrency * 4),
			warmup: concurrency,
		}),
	),
];
