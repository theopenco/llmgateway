import { describe, expect, it, vi } from "vitest";

import { HealthChecker } from "./health-check.js";

function checker(overrides: {
	ping?: () => Promise<string>;
	findFirst?: (config?: object) => Promise<unknown>;
}) {
	const findFirst = vi.fn(overrides.findFirst ?? (async () => ({ id: "u" })));
	const healthChecker = new HealthChecker({
		redisClient: { ping: overrides.ping ?? (async () => "PONG") },
		db: { query: { user: { findFirst } } },
		logger: { error: vi.fn() },
	});
	return { healthChecker, findFirst };
}

describe("HealthChecker", () => {
	it("reads one user column so it does not depend on the row shape", async () => {
		const { healthChecker, findFirst } = checker({});
		const health = await healthChecker.performHealthChecks();
		expect(health).toEqual({
			status: "ok",
			redis: { connected: true, error: undefined },
			database: { connected: true, error: undefined },
		});
		expect(findFirst).toHaveBeenCalledWith({ columns: { id: true } });
	});

	it("reports each failed dependency with a 503", async () => {
		const { healthChecker } = checker({
			ping: async () => {
				throw new Error("ECONNREFUSED");
			},
			findFirst: () => new Promise(() => {}),
		});
		const health = await healthChecker.performHealthChecks({ timeoutMs: 10 });
		expect(health).toMatchObject({
			status: "error",
			redis: { connected: false, error: "Redis connection failed" },
			database: { connected: false, error: "Database check timed out" },
		});
		const { response, statusCode } = healthChecker.createHealthResponse(health);
		expect(statusCode).toBe(503);
		expect(response.message).toBe(
			"Service Unavailable - Redis, Database are unavailable",
		);
	});
});
