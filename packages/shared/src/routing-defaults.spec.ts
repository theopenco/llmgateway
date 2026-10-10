import { describe, expect, it } from "vitest";

import {
	calculateUptimePenalty,
	DEFAULT_ROUTING_THRESHOLDS,
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

	it("can skip digit grouping for config-style code", () => {
		expect(
			interpolateRoutingDefaults("%routing.timeouts.gatewayMs%", {
				grouping: false,
			}),
		).toBe(String(DEFAULT_ROUTING_TIMEOUTS.gatewayMs));
	});

	it("exposes rounded uptime penalty examples", () => {
		expect(interpolateRoutingDefaults("%routing.uptimePenaltyAt.80%")).toBe(
			String(Math.round(calculateUptimePenalty(80) * 100) / 100),
		);
		expect(() =>
			interpolateRoutingDefaults("%routing.uptimePenaltyAt.85%"),
		).toThrow();
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

describe("calculateUptimePenalty", () => {
	it("is zero at or above the default threshold", () => {
		expect(
			calculateUptimePenalty(DEFAULT_ROUTING_THRESHOLDS.uptimePenalty),
		).toBe(0);
		expect(calculateUptimePenalty(100)).toBe(0);
	});

	it("grows quadratically below the threshold", () => {
		expect(calculateUptimePenalty(90, 95)).toBeCloseTo(0.069, 3);
		expect(calculateUptimePenalty(80, 95)).toBeCloseTo(0.623, 3);
		expect(calculateUptimePenalty(80, 95)).toBeGreaterThan(
			calculateUptimePenalty(90, 95),
		);
	});
});
