import { expect, test } from "vitest";

import { models } from "./models.js";

import type { ProviderModelMapping } from "./models.js";

test.each(["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"])(
	"declares only supported Runpod parameters for %s",
	(model) => {
		const mapping: ProviderModelMapping | undefined = models
			.find((entry) => entry.id === model)
			?.providers.find((provider) => provider.providerId === "runpod");
		expect(mapping?.supportedParameters).toEqual([
			"max_tokens",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		]);
	},
);

test("allows adaptive Runpod GLM reasoning to omit its trace", () => {
	const mapping: ProviderModelMapping | undefined = models
		.find((model) => model.id === "glm-5.3")
		?.providers.find((provider) => provider.providerId === "runpod");
	expect(mapping).toMatchObject({ reasoning: true, reasoningOutput: "omit" });
});
