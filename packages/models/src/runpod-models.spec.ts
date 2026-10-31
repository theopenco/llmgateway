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
