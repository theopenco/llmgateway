import { describe, expect, it } from "vitest";

import {
	DEFAULT_ROUTING_RETRY,
	DEFAULT_ROUTING_THRESHOLDS,
	DEFAULT_ROUTING_WEIGHTS,
	buildProviderPriorityDefaults,
	resolveRoutingConfig,
} from "./routing-config.js";

describe("resolveRoutingConfig", () => {
	const providerDefaults = buildProviderPriorityDefaults();

	it("returns defaults when overrides are null", () => {
		const resolved = resolveRoutingConfig(null, providerDefaults);
		expect(resolved.weights).toEqual(DEFAULT_ROUTING_WEIGHTS);
		expect(resolved.thresholds).toEqual(DEFAULT_ROUTING_THRESHOLDS);
		expect(resolved.retry).toEqual(DEFAULT_ROUTING_RETRY);
		// Timeouts intentionally stay empty so that the per-call helpers can
		// fall back through env vars and DEFAULT_ROUTING_TIMEOUTS.
		expect(resolved.timeouts).toEqual({});
		expect(resolved.providerPriorities).toEqual(providerDefaults);
	});

	it("only carries timeout overrides for positive numeric values", () => {
		const resolved = resolveRoutingConfig(
			{
				timeouts: {
					gatewayMs: 250_000,
					streamingMs: 0,
					plainMs: undefined,
				},
			},
			providerDefaults,
		);
		expect(resolved.timeouts.gatewayMs).toBe(250_000);
		expect(resolved.timeouts.streamingMs).toBeUndefined();
		expect(resolved.timeouts.plainMs).toBeUndefined();
	});

	it("shallow-merges weights override over defaults", () => {
		const resolved = resolveRoutingConfig(
			{ weights: { price: 0.9, uptime: 0.1 } },
			providerDefaults,
		);
		expect(resolved.weights.price).toBe(0.9);
		expect(resolved.weights.uptime).toBe(0.1);
		expect(resolved.weights.cache).toBe(DEFAULT_ROUTING_WEIGHTS.cache);
		expect(resolved.weights.latency).toBe(DEFAULT_ROUTING_WEIGHTS.latency);
	});

	it("ignores null and undefined override values inside groups", () => {
		const resolved = resolveRoutingConfig(
			{
				retry: {
					maxRetries: undefined,
					lowUptimeFallbackThreshold: 80,
				},
			},
			providerDefaults,
		);
		expect(resolved.retry.maxRetries).toBe(DEFAULT_ROUTING_RETRY.maxRetries);
		expect(resolved.retry.lowUptimeFallbackThreshold).toBe(80);
	});

	it("merges provider priorities, preserving 0 to disable a provider", () => {
		const resolved = resolveRoutingConfig(
			{ providerPriorities: { openai: 0, anthropic: 0.4 } },
			providerDefaults,
		);
		expect(resolved.providerPriorities.openai).toBe(0);
		expect(resolved.providerPriorities.anthropic).toBe(0.4);
		expect(resolved.providerPriorities.llmgateway).toBe(
			providerDefaults.llmgateway,
		);
	});

	it("treats enabled=false as a full passthrough to defaults", () => {
		const resolved = resolveRoutingConfig(
			{
				enabled: false,
				weights: { price: 0.01 },
				providerPriorities: { openai: 0 },
			},
			providerDefaults,
		);
		expect(resolved.weights.price).toBe(DEFAULT_ROUTING_WEIGHTS.price);
		expect(resolved.providerPriorities.openai).toBe(providerDefaults.openai);
	});

	it("falls through non-numeric provider priority values", () => {
		const resolved = resolveRoutingConfig(
			{
				providerPriorities: {
					openai: Number.NaN,
					anthropic: 0.7,
				},
			},
			providerDefaults,
		);
		expect(resolved.providerPriorities.openai).toBe(providerDefaults.openai);
		expect(resolved.providerPriorities.anthropic).toBe(0.7);
	});
});

describe("buildProviderPriorityDefaults", () => {
	it("includes every known provider id with a numeric priority", () => {
		const defaults = buildProviderPriorityDefaults();
		const entries = Object.entries(defaults);
		expect(entries.length).toBeGreaterThan(0);
		for (const [, priority] of entries) {
			expect(typeof priority).toBe("number");
			expect(Number.isFinite(priority)).toBe(true);
		}
	});
});
