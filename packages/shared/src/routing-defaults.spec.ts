import { describe, expect, it } from "vitest";

import {
	DEFAULT_ROUTING_TIMEOUTS,
	DEFAULT_ROUTING_WEIGHTS,
	interpolateRoutingDefaults,
	MAX_THROUGHPUT_SCORE,
} from "./routing-defaults.js";

describe("interpolateRoutingDefaults", () => {
	it("replaces tokens with the live defaults", () => {
		expect(
			interpolateRoutingDefaults(
				"throughput `%routing.weights.throughput%`, cap %routing.maxThroughputScore%",
			),
		).toBe(
			`throughput \`${DEFAULT_ROUTING_WEIGHTS.throughput}\`, cap ${MAX_THROUGHPUT_SCORE}`,
		);
	});

	it("formats large numbers and booleans", () => {
		expect(interpolateRoutingDefaults("%routing.timeouts.gatewayMs%")).toBe(
			DEFAULT_ROUTING_TIMEOUTS.gatewayMs.toLocaleString("en-US"),
		);
		expect(interpolateRoutingDefaults("%routing.sticky.enabled%")).toBe("true");
		expect(
			interpolateRoutingDefaults("%routing.cachePricing.devpass.cacheHitRate%"),
		).toBe("0.9");
	});

	it("leaves unrelated percent signs alone", () => {
		expect(interpolateRoutingDefaults("a 5% fee and 20% margin")).toBe(
			"a 5% fee and 20% margin",
		);
	});

	it("throws on unknown or non-scalar paths", () => {
		expect(() => interpolateRoutingDefaults("%routing.weights.speed%")).toThrow(
			"%routing.weights.speed%",
		);
		expect(() => interpolateRoutingDefaults("%routing.weights%")).toThrow();
		expect(() =>
			interpolateRoutingDefaults("%routing.weights.constructor%"),
		).toThrow();
	});
});
