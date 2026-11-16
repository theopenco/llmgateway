import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition } from "./models.js";

describe("Cloudflare Workers AI November 2026 retirements", () => {
	const deactivatedAt = new Date("2026-11-20");
	const beforeDeactivation = new Date(deactivatedAt.getTime() - 1);
	const mappings = (externalId: string) =>
		(models as readonly ModelDefinition[])
			.flatMap((model) => model.providers)
			.filter(
				(provider) =>
					provider.providerId === "cloudflare" &&
					provider.externalId === externalId,
			);

	it.each([
		"@cf/zai-org/glm-5.3-flash",
		"@cf/deepseek-ai/deepseek-v4-pro-0813",
		"@cf/deepseek-ai/deepseek-v4-flash-0731",
	])("retires %s by the announced date", (externalId) => {
		const found = mappings(externalId);

		expect(found.length).toBeGreaterThan(0);
		for (const mapping of found) {
			expect(isLiveMapping(mapping, deactivatedAt)).toBe(false);
		}
		expect(
			found.some((mapping) => isLiveMapping(mapping, beforeDeactivation)),
		).toBe(true);
	});

	it.each(["@cf/zai-org/glm-5.3", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"])(
		"keeps the recommended replacement %s live",
		(externalId) => {
			const found = mappings(externalId);

			expect(found.length).toBeGreaterThan(0);
			expect(
				found.every((mapping) => isLiveMapping(mapping, deactivatedAt)),
			).toBe(true);
		},
	);
});
