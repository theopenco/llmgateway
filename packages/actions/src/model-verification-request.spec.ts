import { describe, expect, it, vi } from "vitest";

import { models } from "@llmgateway/models";

import { buildVerificationTarget } from "./model-verification-target.js";
import { prepareProviderModelVerificationRequest } from "./model-verification.js";

vi.mock("@llmgateway/shared/url-safety-node", () => ({
	assertSafeProviderUrl: vi.fn(),
}));

describe("exact native verification requests", () => {
	it.each([
		{
			providerId: "snapshot-carrier",
			apiFormat: "provider-native",
			path: "/chat/completions",
		},
		{
			providerId: "openai",
			apiFormat: "openai-chat-completions",
			path: "/chat/completions",
		},
		{ providerId: "openai", apiFormat: "openai-responses", path: "/responses" },
		{
			providerId: "anthropic",
			apiFormat: "provider-native",
			path: "/messages",
		},
		{
			providerId: "google-vertex",
			apiFormat: "google-vertex",
			path: "streamGenerateContent",
		},
	] as const)(
		"preserves the declared model on $providerId/$apiFormat",
		async ({ providerId, apiFormat, path }) => {
			const known = models.find((model) =>
				model.providers.some((mapping) => mapping.providerId === providerId),
			);
			const target = buildVerificationTarget({
				providerId,
				modelName: known?.id ?? "snapshot-model",
				externalId: "snapshot-upstream-model",
				apiFormat,
				reasoning: false,
				streaming: true,
			});
			const native = await prepareProviderModelVerificationRequest(
				{
					model: target.modelName,
					messages: [{ role: "user", content: "Hello" }],
					stream: true,
					max_tokens: 16,
				},
				{
					target,
					token: "test-provider-key",
					baseUrl: "https://example.com/v1",
					skipEnvVars: true,
				},
			);
			expect(native.endpoint).toContain(path);
			expect(native.payload instanceof FormData).toBe(false);
			const payload = native.payload as unknown as Record<string, unknown>;
			expect(
				payload.model === target.externalId ||
					native.endpoint.includes(target.externalId),
			).toBe(true);
			if (apiFormat === "openai-responses") {
				expect(payload.reasoning).toBeUndefined();
				expect(payload.include).toBeUndefined();
			}
		},
	);
});
