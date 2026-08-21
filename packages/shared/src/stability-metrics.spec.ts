import { describe, expect, it } from "vitest";

import { deriveStabilityMetrics } from "./stability-metrics.js";

describe("deriveStabilityMetrics", () => {
	it("excludes client errors from errors and requests", () => {
		expect(deriveStabilityMetrics(100, 20, 10)).toEqual({
			requestCount: 90,
			errorsCount: 10,
			errorRate: 100 / 9,
			uptime: 800 / 9,
		});
	});

	it("returns no rate when all requests are client errors", () => {
		expect(deriveStabilityMetrics(4, 4, 4)).toEqual({
			requestCount: 0,
			errorsCount: 0,
			errorRate: null,
			uptime: null,
		});
	});

	it("clamps inconsistent aggregate counts", () => {
		expect(deriveStabilityMetrics(2, 8, 1)).toEqual({
			requestCount: 1,
			errorsCount: 1,
			errorRate: 100,
			uptime: 0,
		});
	});
});
