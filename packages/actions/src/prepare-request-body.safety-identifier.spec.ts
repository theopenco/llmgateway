import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	AnthropicRequestBody,
	OpenAIRequestBody,
	OpenAIResponsesRequestBody,
	ProviderId,
} from "@llmgateway/models";

const SAFETY_IDENTIFIER = "org_2f1c9d4a6b7e4f1080a3c5d9e7b21f34";

async function prepare(options: {
	provider: ProviderId;
	model: string;
	useResponsesApi?: boolean;
	safetyIdentifier?: string;
}) {
	return (await prepareRequestBody(
		options.provider,
		options.model,
		null,
		options.model,
		[{ role: "user", content: "Hello!" }],
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		false,
		false,
		20,
		null,
		undefined,
		undefined,
		undefined,
		false,
		undefined,
		undefined,
		options.useResponsesApi ?? false,
		undefined,
		undefined,
		true,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		options.safetyIdentifier,
	)) as OpenAIRequestBody & OpenAIResponsesRequestBody & AnthropicRequestBody;
}

describe("prepareRequestBody - safety identifier", () => {
	test("forwards safety_identifier to OpenAI chat completions", async () => {
		const body = await prepare({
			provider: "openai",
			model: "gpt-5.5",
			safetyIdentifier: SAFETY_IDENTIFIER,
		});

		expect(body.safety_identifier).toBe(SAFETY_IDENTIFIER);
	});

	test("forwards safety_identifier to the OpenAI Responses API", async () => {
		const body = await prepare({
			provider: "openai",
			model: "gpt-5.5",
			useResponsesApi: true,
			safetyIdentifier: SAFETY_IDENTIFIER,
		});

		expect(body.safety_identifier).toBe(SAFETY_IDENTIFIER);
	});

	test("omits safety_identifier when the organization has none", async () => {
		const body = await prepare({ provider: "openai", model: "gpt-5.5" });

		expect(body.safety_identifier).toBeUndefined();
	});

	test("forwards safety_identifier to Azure only on the Responses path", async () => {
		const responsesBody = await prepare({
			provider: "azure",
			model: "gpt-5.5",
			useResponsesApi: true,
			safetyIdentifier: SAFETY_IDENTIFIER,
		});
		const chatBody = await prepare({
			provider: "azure",
			model: "gpt-5.5",
			safetyIdentifier: SAFETY_IDENTIFIER,
		});

		expect(responsesBody.safety_identifier).toBe(SAFETY_IDENTIFIER);
		expect(chatBody.safety_identifier).toBeUndefined();
	});

	test.each([["anthropic"], ["vertex-anthropic"]] as const)(
		"maps the identifier onto metadata.user_id for %s",
		async (provider) => {
			const body = await prepare({
				provider,
				model: "claude-sonnet-4-5",
				safetyIdentifier: SAFETY_IDENTIFIER,
			});

			expect(body.metadata).toEqual({ user_id: SAFETY_IDENTIFIER });
		},
	);

	test("omits metadata for Anthropic when the organization has none", async () => {
		const body = await prepare({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
		});

		expect(body.metadata).toBeUndefined();
	});

	test.each([["aws-bedrock"], ["google-ai-studio"]] as const)(
		"sends no identifier to %s, which has no equivalent field",
		async (provider) => {
			const body = await prepare({
				provider,
				model:
					provider === "aws-bedrock" ? "claude-sonnet-4-5" : "gemini-2.5-flash",
				safetyIdentifier: SAFETY_IDENTIFIER,
			});

			expect(JSON.stringify(body)).not.toContain(SAFETY_IDENTIFIER);
		},
	);
});
