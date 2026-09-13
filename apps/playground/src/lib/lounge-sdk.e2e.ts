import {
	dynamicTool,
	generateText,
	isStepCount,
	jsonSchema,
	streamText,
} from "ai";
import { describe, expect, it } from "vitest";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const gatewayUrl = process.env.LOUNGE_E2E_GATEWAY_URL;

describe.skipIf(!gatewayUrl)("Lounge SDK against a live gateway", () => {
	const provider = createLLMGateway({
		apiKey: "test-token",
		baseURL: `${gatewayUrl}/v1`,
		headers: { "x-no-fallback": "true" },
	});
	const model = provider.chat(
		process.env.LOUNGE_E2E_MODEL ?? "openai/gpt-4o-mini",
		{ usage: { include: true } },
	);

	it("streams text and usage with the upgraded provider", async () => {
		const result = streamText({
			model,
			instructions: "Reply with the single word READY.",
			prompt: `SDK streaming check ${Date.now()}`,
			maxOutputTokens: 100,
		});
		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toContain("READY");
		expect((await result.usage).totalTokens).toBeGreaterThan(0);
	});

	it("runs a dynamic tool and returns its result to the model", async () => {
		const inputs: unknown[] = [];
		const result = await generateText({
			model,
			prompt: `Use lookup to look up the code for "lounge", then report the code. Check ${Date.now()}`,
			tools: {
				lookup: dynamicTool({
					description: "Look up a project code",
					inputSchema: jsonSchema<{ query: string }>({
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
						additionalProperties: false,
					}),
					execute: async (input) => {
						inputs.push(input);
						return { code: "LOUNGE-42" };
					},
				}),
			},
			prepareStep: ({ stepNumber }) => ({
				toolChoice:
					stepNumber === 0 ? { type: "tool", toolName: "lookup" } : "none",
			}),
			stopWhen: isStepCount(2),
			maxOutputTokens: 200,
		});
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toEqual({ query: "lounge" });
		expect(result.text).toContain("LOUNGE-42");
		expect(result.steps).toHaveLength(2);
	});
});
