import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition } from "./models.js";

describe("BytePlus November 2026 retirements", () => {
	const deactivatedAt = new Date("2026-11-11T09:00:00.000Z");
	const beforeDeactivation = new Date(deactivatedAt.getTime() - 1);

	it.each([
		"seed-1-6-250615",
		"seed-1-6-250915",
		"seed-1-6-flash-250715",
		"seed-1-8-251228",
		"deepseek-v3-2-251201",
		"gpt-oss-120b-250805",
		"glm-4-7-251222",
		"seedance-1-5-pro-251215",
	])("retires %s at 17:00 UTC+8", (externalId) => {
		const mapping = (models as readonly ModelDefinition[])
			.flatMap((model) => model.providers)
			.find(
				(provider) =>
					provider.providerId === "bytedance" &&
					provider.externalId === externalId,
			);

		expect(mapping).toBeDefined();
		expect(mapping?.deactivatedAt).toEqual(deactivatedAt);
		expect(isLiveMapping(mapping!, beforeDeactivation)).toBe(true);
		expect(isLiveMapping(mapping!, deactivatedAt)).toBe(false);
	});
});
