import { describe, expect, it } from "vitest";

import {
	DEFAULT_ROUTING_HISTORY,
	DEFAULT_ROUTING_RETRY,
	DEFAULT_ROUTING_STICKY,
	DEFAULT_ROUTING_THRESHOLDS,
	DEFAULT_ROUTING_WEIGHTS,
	buildProviderPriorityDefaults,
	historyMatchesDefaults,
	resolveRoutingConfig,
	ROUTING_HISTORY_MAX_WINDOW_MINUTES,
	routingHistoryCacheKey,
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
		expect(resolved.history).toEqual(DEFAULT_ROUTING_HISTORY);
		expect(historyMatchesDefaults(resolved.history)).toBe(true);
		expect(resolved.providerPriorities).toEqual(providerDefaults);
	});

	it("clamps history overrides to safe bounds", () => {
		const resolved = resolveRoutingConfig(
			{
				history: {
					windowMinutes: 999, // above max
					tier1Minutes: -2, // below 0
					tier2Minutes: 0, // promoted to tier1Minutes
					tier1Weight: -5, // clamped to 0
					tier2Weight: 7,
					tier3Weight: 2,
				},
			},
			providerDefaults,
		);
		expect(resolved.history.windowMinutes).toBe(
			ROUTING_HISTORY_MAX_WINDOW_MINUTES,
		);
		expect(resolved.history.tier1Minutes).toBe(0);
		expect(resolved.history.tier2Minutes).toBe(0);
		expect(resolved.history.tier1Weight).toBe(0);
		expect(resolved.history.tier2Weight).toBe(7);
		expect(resolved.history.tier3Weight).toBe(2);
		expect(historyMatchesDefaults(resolved.history)).toBe(false);
	});

	it("routingHistoryCacheKey changes when any history field changes", () => {
		const base = resolveRoutingConfig(null, providerDefaults).history;
		const baseKey = routingHistoryCacheKey(base);
		const bumpedWindow = routingHistoryCacheKey({
			...base,
			windowMinutes: base.windowMinutes + 1,
		});
		const bumpedWeight = routingHistoryCacheKey({
			...base,
			tier1Weight: base.tier1Weight + 1,
		});
		expect(bumpedWindow).not.toBe(baseKey);
		expect(bumpedWeight).not.toBe(baseKey);
		expect(bumpedWindow).not.toBe(bumpedWeight);
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

	it("merges and clamps sticky-routing overrides", () => {
		const resolved = resolveRoutingConfig(
			{
				sticky: {
					enabled: false,
					ttlSeconds: 60,
					uptimeThreshold: 150, // > 100, should clamp to 100
					scoreMargin: -1, // < 0, should clamp to 0
				},
			},
			providerDefaults,
		);
		expect(resolved.sticky.enabled).toBe(false);
		expect(resolved.sticky.ttlSeconds).toBe(60);
		expect(resolved.sticky.uptimeThreshold).toBe(100);
		expect(resolved.sticky.scoreMargin).toBe(0);
	});

	it("returns sticky defaults when no sticky override is supplied", () => {
		const resolved = resolveRoutingConfig(null, providerDefaults);
		expect(resolved.sticky).toEqual(DEFAULT_ROUTING_STICKY);
	});

	it("defaults session stickiness to enabled", () => {
		const resolved = resolveRoutingConfig(null, providerDefaults);
		expect(resolved.session.enabled).toBe(true);
	});

	it("merges a session-stickiness override", () => {
		const resolved = resolveRoutingConfig(
			{ session: { enabled: false } },
			providerDefaults,
		);
		expect(resolved.session.enabled).toBe(false);
	});

	it("defaults session ttl and uptime threshold", () => {
		const resolved = resolveRoutingConfig(null, providerDefaults);
		expect(resolved.session.ttlSeconds).toBe(3600);
		expect(resolved.session.uptimeThreshold).toBe(85);
	});

	it("clamps session overrides into valid ranges", () => {
		const resolved = resolveRoutingConfig(
			{ session: { ttlSeconds: 0, uptimeThreshold: 150 } },
			providerDefaults,
		);
		expect(resolved.session.ttlSeconds).toBe(1);
		expect(resolved.session.uptimeThreshold).toBe(100);
	});

	it("clamps timeout overrides down to the infra ceiling", () => {
		const resolved = resolveRoutingConfig(
			{
				timeouts: {
					gatewayMs: 999_999_999, // > default ceiling
					streamingMs: 999_999_999,
					plainMs: 999_999_999,
				},
			},
			providerDefaults,
		);
		expect(resolved.timeouts.gatewayMs).toBe(1_500_000);
		expect(resolved.timeouts.streamingMs).toBe(1_200_000);
		expect(resolved.timeouts.plainMs).toBe(600_000);
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
