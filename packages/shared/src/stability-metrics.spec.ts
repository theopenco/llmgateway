import { describe, expect, it } from "vitest";

import { deriveStabilityMetrics } from "./stability-metrics.js";

describe("deriveStabilityMetrics", () => {
	it("excludes client errors from errors and requests", () => {
		expect(
			deriveStabilityMetrics({
				logsCount: 100,
				clientErrorsCount: 10,
				gatewayErrorsCount: 4,
				upstreamErrorsCount: 6,
			}),
		).toEqual({
			requestCount: 90,
			errorsCount: 10,
			errorRate: 100 / 9,
			uptime: 800 / 9,
		});
	});

	it("counts upstream errors the hasError column never flagged", () => {
		// A 200 response whose stream ends with an upstream-error finish reason.
		expect(
			deriveStabilityMetrics({
				logsCount: 200,
				clientErrorsCount: 0,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 20,
			}),
		).toEqual({
			requestCount: 200,
			errorsCount: 20,
			errorRate: 10,
			uptime: 90,
		});
	});

	it("returns no rate when all requests are client errors", () => {
		expect(
			deriveStabilityMetrics({
				logsCount: 4,
				clientErrorsCount: 4,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
			}),
		).toEqual({
			requestCount: 0,
			errorsCount: 0,
			errorRate: null,
			uptime: null,
		});
	});

	it("clamps inconsistent aggregate counts", () => {
		expect(
			deriveStabilityMetrics({
				logsCount: 2,
				clientErrorsCount: 1,
				gatewayErrorsCount: 3,
				upstreamErrorsCount: 5,
			}),
		).toEqual({
			requestCount: 1,
			errorsCount: 1,
			errorRate: 100,
			uptime: 0,
		});
	});
});
