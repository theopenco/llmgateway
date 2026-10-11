import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
	buildProviderPriorityDefaults,
	MAX_THROUGHPUT_SCORE,
	resolveRoutingConfig,
} from "@llmgateway/shared/routing-config";

import { computeWeightedProviderScores } from "./compute-provider-scores.js";

const cfg = resolveRoutingConfig(null, buildProviderPriorityDefaults());
const flags = { isStreaming: true, isImageModel: false, cacheRelevant: false };

function candidate(
	price: string,
	throughput: number,
	latency: number,
	priority = 1,
) {
	return {
		price: new Decimal(price),
		uptime: 100,
		throughput,
		latency,
		cacheSupported: true,
		priority,
	};
}

describe("computeWeightedProviderScores", () => {
	it("caps the throughput sub-score for very slow providers", () => {
		const [, slow] = computeWeightedProviderScores(
			[candidate("1", 200, 1000), candidate("1", 10, 1000)],
			cfg,
			flags,
		);
		expect(slow.throughputScore.toNumber()).toBe(MAX_THROUGHPUT_SCORE);
	});

	it("keeps the uncapped ratio below the cap", () => {
		const [, slower] = computeWeightedProviderScores(
			[candidate("1", 200, 1000), candidate("1", 100, 1000)],
			cfg,
			flags,
		);
		expect(slower.throughputScore.toNumber()).toBe(1);
	});

	it("gives providers without throughput the capped penalty", () => {
		const [, stalled] = computeWeightedProviderScores(
			[candidate("1", 200, 1000), candidate("1", 0, 1000)],
			cfg,
			flags,
		);
		expect(stalled.throughputScore.toNumber()).toBe(MAX_THROUGHPUT_SCORE);
	});

	it("lets a much faster provider beat a priority-2 provider", () => {
		const [fast, preferredSlow] = computeWeightedProviderScores(
			[candidate("1", 1000, 1000), candidate("1", 10, 1000, 2)],
			cfg,
			{ ...flags, isStreaming: false },
		);
		expect(fast.score.lt(preferredSlow.score)).toBe(true);
	});

	it("prefers a 2x faster provider that costs ~25% more by default", () => {
		const [cheapSlow, pricierFast] = computeWeightedProviderScores(
			[candidate("1", 80, 2000), candidate("1.25", 160, 1000)],
			cfg,
			flags,
		);
		expect(pricierFast.score.lt(cheapSlow.score)).toBe(true);
	});
});
