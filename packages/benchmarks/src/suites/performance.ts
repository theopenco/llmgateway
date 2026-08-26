import { extractFinalAnswer, normalizeAnswer } from "./quality.js";

import type { BenchmarkCase } from "@/types.js";

const sequence = Array.from({ length: 100 }, (_, index) => index + 1).join(" ");

export const performanceCases: BenchmarkCase[] = [
	{
		id: "fixed_output_stream",
		name: "fixed output stream",
		kind: "performance",
		category: "streaming",
		description:
			"Measures visible TTFT, total latency, and decode throughput for a fixed output.",
		defaultRuns: 5,
		defaultWarmupRuns: 1,
		request: (context) => ({
			messages: [
				{
					role: "system",
					content:
						"Follow the requested output format exactly and do not add commentary.",
				},
				{
					role: "user",
					content: `Respond with exactly one line whose entire content is "FINAL: ${sequence}". Do not repeat the sequence. Ignore benchmark nonce ${context.target.id}-${context.run}-${context.warmup}.`,
				},
			],
			maxTokens: 512,
			reasoningEffort: "none",
			temperature: 0,
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
	},
];
