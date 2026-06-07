import { describe, expect, it } from "vitest";

import { getSupportedServiceTiers, supportsServiceTier } from "./helpers.js";
import { formatServiceTierMultiplier, getServiceTier } from "./providers.js";

describe("getServiceTier", () => {
	it("returns the configured Vertex Flex / Priority tiers", () => {
		expect(getServiceTier("google-vertex", "flex")?.multiplier).toBe(0.5);
		expect(getServiceTier("google-vertex", "priority")?.multiplier).toBe(1.8);
	});

	it("returns the configured OpenAI Flex / Priority tiers", () => {
		expect(getServiceTier("openai", "flex")?.multiplier).toBe(0.5);
		expect(getServiceTier("openai", "priority")?.multiplier).toBe(2.5);
	});

	it("returns undefined for unknown tiers or providers without tiers", () => {
		expect(getServiceTier("google-vertex", "nope")).toBeUndefined();
		expect(getServiceTier("anthropic", "priority")).toBeUndefined();
	});
});

describe("formatServiceTierMultiplier", () => {
	it("formats a premium multiplier", () => {
		expect(formatServiceTierMultiplier(1.8)).toBe("1.8× (+80%)");
	});

	it("formats a discount multiplier", () => {
		expect(formatServiceTierMultiplier(0.5)).toBe("0.5× (−50%)");
	});

	it("returns an empty string for the standard multiplier", () => {
		expect(formatServiceTierMultiplier(1)).toBe("");
	});
});

describe("model service tier support", () => {
	it("returns explicit OpenAI tiers for supported models", () => {
		expect(
			getSupportedServiceTiers("gpt-5.5", "openai").map((tier) => tier.id),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers("gpt-5.5-pro", "openai").map((tier) => tier.id),
		).toEqual(["flex"]);
		expect(
			getSupportedServiceTiers("gpt-5.3-codex", "openai").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
	});

	it("returns explicit Google Vertex tiers for supported models", () => {
		expect(
			getSupportedServiceTiers("gemini-2.5-pro", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
		expect(
			getSupportedServiceTiers("gemini-2.5-flash", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["priority"]);
		expect(
			getSupportedServiceTiers("gemini-3.5-flash", "google-vertex").map(
				(tier) => tier.id,
			),
		).toEqual(["flex", "priority"]);
		expect(
			getSupportedServiceTiers(
				"gemini-3-pro-image-preview",
				"google-vertex",
			).map((tier) => tier.id),
		).toEqual(["flex"]);
	});

	it("limits Google Vertex service tiers to the global endpoint", () => {
		expect(
			supportsServiceTier(
				"gemini-3.5-flash",
				"google-vertex",
				"priority",
				"global",
			),
		).toBe(true);
		expect(
			supportsServiceTier(
				"gemini-3.5-flash",
				"google-vertex",
				"priority",
				"us-central1",
			),
		).toBe(false);
		expect(
			getSupportedServiceTiers(
				"gemini-3.5-flash",
				"google-vertex",
				"us-central1",
			),
		).toEqual([]);
	});

	it("does not infer support from provider-level tiers", () => {
		expect(supportsServiceTier("gpt-4o", "openai", "priority")).toBe(false);
		expect(getSupportedServiceTiers("gpt-4o", "openai")).toEqual([]);
		expect(
			supportsServiceTier("gemini-3-pro-preview", "google-vertex", "priority"),
		).toBe(false);
	});
});
