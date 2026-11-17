import { vi } from "vitest";

import * as routingConfigLoader from "@/lib/routing-config-loader.js";

import type { ProviderPriorityOverrides } from "@llmgateway/db";

// The catalogue has no built-in provider priorities, so tests that need a
// deterministic natural winner among equal-priced providers set one here.
export function overrideProviderPriorities(
	priorities: ProviderPriorityOverrides,
) {
	const original = routingConfigLoader.getResolvedRoutingConfig;
	return vi
		.spyOn(routingConfigLoader, "getResolvedRoutingConfig")
		.mockImplementation(async (...args) => {
			const cfg = await original(...args);
			return {
				...cfg,
				providerPriorities: { ...cfg.providerPriorities, ...priorities },
			};
		});
}
