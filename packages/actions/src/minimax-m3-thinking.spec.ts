import { expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { OpenAIRequestBody } from "@llmgateway/models";

test.each(["novita", "together-ai"] as const)(
	"%s M3 disables thinking with the declared binary switch",
	async (provider) => {
		const body = (await prepareRequestBody(
			provider,
			"minimax-m3",
			null,
			provider === "novita" ? "minimax/minimax-m3" : "MiniMaxAI/MiniMax-M3",
			[{ role: "user", content: "Hello" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"none",
			true,
		)) as OpenAIRequestBody & { thinking?: { type: string } };
		expect(body.thinking).toEqual({ type: "disabled" });
		expect(body.reasoning_effort).toBeUndefined();
	},
);

test.each(["novita", "together-ai"] as const)(
	"%s M3 preserves default and non-none reasoning",
	async (provider) => {
		for (const effort of [undefined, "high"] as const) {
			const body = (await prepareRequestBody(
				provider,
				"minimax-m3",
				null,
				provider === "novita" ? "minimax/minimax-m3" : "MiniMaxAI/MiniMax-M3",
				[{ role: "user", content: "Hello" }],
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				effort,
				true,
			)) as OpenAIRequestBody & { thinking?: { type: string } };
			expect(body.thinking).toBeUndefined();
			expect(body.reasoning_effort).toBe(effort);
		}
	},
);
