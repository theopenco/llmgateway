import { describe, expect, it } from "vitest";

import { clampTemperature } from "./clamp-temperature.js";

describe("clampTemperature", () => {
	it("returns undefined when no temperature is set", () => {
		expect(clampTemperature(undefined, "zai")).toBeUndefined();
	});

	it("leaves the temperature untouched for providers without a ceiling", () => {
		expect(clampTemperature(1.8, "openai")).toBe(1.8);
	});

	it("clamps values above the provider ceiling", () => {
		expect(clampTemperature(1.5, "zai")).toBe(1);
		expect(clampTemperature(2, "zai")).toBe(1);
	});

	it("clamps values above the mapping ceiling", () => {
		expect(clampTemperature(1.9, "runware", 1)).toBe(1);
	});

	it("uses the tighter provider or mapping ceiling", () => {
		expect(clampTemperature(1.5, "zai", 0.8)).toBe(0.8);
	});

	it("keeps values within the provider ceiling", () => {
		expect(clampTemperature(1, "zai")).toBe(1);
		expect(clampTemperature(0.7, "zai")).toBe(0.7);
		expect(clampTemperature(0, "zai")).toBe(0);
	});
});
