import { describe, expect, it } from "vitest";

import { anthropicModels } from "./models/anthropic.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition } from "./models.js";

describe("Anthropic Claude API retirements", () => {
	const model = (anthropicModels as readonly ModelDefinition[]).find(
		(entry) => entry.id === "claude-opus-4-5-20251101",
	);
	const mapping = (providerId: string) =>
		model?.providers.find((entry) => entry.providerId === providerId);

	it("retires anthropic/claude-opus-4-5-20251101 on January 22, 2027 at 12PM PT", () => {
		const anthropic = mapping("anthropic");
		const deactivatedAt = new Date("2027-01-22T20:00:00Z");

		expect(anthropic?.deprecatedAt).toEqual(new Date("2026-11-23"));
		expect(anthropic?.deactivatedAt).toEqual(deactivatedAt);
		expect(isLiveMapping(anthropic!, new Date("2026-11-22"))).toBe(true);
		expect(isLiveMapping(anthropic!, deactivatedAt)).toBe(false);
	});

	it("retires aws-bedrock/claude-opus-4-5-20251101 on May 23, 2027", () => {
		const bedrock = mapping("aws-bedrock");
		const deactivatedAt = new Date("2027-05-23T08:00:00Z");

		expect(bedrock?.deprecatedAt).toEqual(new Date("2026-11-23"));
		expect(bedrock?.deactivatedAt).toEqual(deactivatedAt);
		expect(isLiveMapping(bedrock!, new Date("2026-11-22"))).toBe(true);
		expect(isLiveMapping(bedrock!, deactivatedAt)).toBe(false);
	});

	it("keeps vertex-anthropic/claude-opus-4-5-20251101 active", () => {
		const entry = mapping("vertex-anthropic");

		expect(entry).toBeDefined();
		expect(entry?.deprecatedAt).toBeUndefined();
		expect(entry?.deactivatedAt).toBeUndefined();
	});
});
