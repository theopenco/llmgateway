import { describe, expect, it } from "vitest";

import { getMetrics, registerDbPoolMetrics } from "./metrics.js";

describe("registerDbPoolMetrics", () => {
	it("exports pool occupancy at scrape time", async () => {
		let stats = { total: 4, idle: 1, waiting: 0, max: 8 };
		registerDbPoolMetrics(() => stats);
		// Idempotent: a second registration must not throw on duplicate names.
		registerDbPoolMetrics(() => stats);

		let text = await getMetrics();
		expect(text).toContain(
			'db_pool_connections{state="active",service="llmgateway-gateway"} 3',
		);
		expect(text).toContain(
			'db_pool_utilization_ratio{service="llmgateway-gateway"} 0.375',
		);

		stats = { total: 8, idle: 0, waiting: 5, max: 8 };
		text = await getMetrics();
		expect(text).toContain(
			'db_pool_waiting_clients{service="llmgateway-gateway"} 5',
		);
		expect(text).toContain(
			'db_pool_utilization_ratio{service="llmgateway-gateway"} 1',
		);
	});
});
