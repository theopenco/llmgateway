import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthChecker } from "./health-check.js";

function checker(overrides: {
	ping?: () => Promise<string>;
	findFirst?: (config?: object) => Promise<unknown>;
}) {
	const findFirst = vi.fn(overrides.findFirst ?? (async () => ({ id: "u" })));
	const ping = vi.fn(overrides.ping ?? (async () => "PONG"));
	const healthChecker = new HealthChecker({
		redisClient: { ping },
		db: { query: { user: { findFirst } } },
		logger: { info: vi.fn(), error: vi.fn() },
	});
	return { healthChecker, findFirst, ping };
}

afterEach(() => {
	vi.useRealTimers();
});

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

	it("shares a call that outlives its timeout until it settles", async () => {
		let release = () => {};
		const { healthChecker, findFirst } = checker({
			findFirst: vi
				.fn<() => Promise<unknown>>()
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							release = () => resolve({ id: "u" });
						}),
				)
				.mockResolvedValue({ id: "u" }),
		});
		const concurrent = await Promise.all([
			healthChecker.performHealthChecks({ timeoutMs: 10 }),
			healthChecker.performHealthChecks({ timeoutMs: 10 }),
		]);
		const afterTimeout = await healthChecker.performHealthChecks({
			timeoutMs: 10,
		});
		for (const health of [...concurrent, afterTimeout]) {
			expect(health.database.error).toBe("Database check timed out");
		}
		expect(findFirst).toHaveBeenCalledTimes(1);

		release();
		await healthChecker.performHealthChecks({ timeoutMs: 10 });
		const settled = await healthChecker.performHealthChecks({ timeoutMs: 10 });
		expect(settled.status).toBe("ok");
		expect(findFirst).toHaveBeenCalledTimes(2);
	});

	it("abandons a call that never settles so a recovered dependency reads healthy", async () => {
		vi.useFakeTimers();
		const { healthChecker, findFirst } = checker({
			findFirst: vi
				.fn<() => Promise<unknown>>()
				.mockImplementationOnce(() => new Promise(() => {}))
				.mockResolvedValue({ id: "u" }),
		});

		const stalled = healthChecker.performHealthChecks({ timeoutMs: 10 });
		await vi.advanceTimersByTimeAsync(10);
		expect((await stalled).status).toBe("error");

		await vi.advanceTimersByTimeAsync(30_000);
		expect((await healthChecker.performHealthChecks()).status).toBe("ok");
		expect(findFirst).toHaveBeenCalledTimes(2);
	});

	it("holds readiness closed until the first passing check, then keeps it open", async () => {
		vi.useFakeTimers();
		let reachable = false;
		const { healthChecker, findFirst } = checker({
			findFirst: async () => {
				if (!reachable) {
					throw new Error("ECONNREFUSED");
				}
				return { id: "u" };
			},
		});
		expect(healthChecker.isReady()).toBe(true);

		healthChecker.gateReadiness({ retryMs: 100 });
		expect(healthChecker.isReady()).toBe(false);
		await vi.advanceTimersByTimeAsync(100);
		expect(healthChecker.isReady()).toBe(false);

		reachable = true;
		await vi.advanceTimersByTimeAsync(100);
		expect(healthChecker.isReady()).toBe(true);

		// A later outage must not close readiness again, and the gate stops
		// checking once it has opened.
		reachable = false;
		const callsWhenOpened = findFirst.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(healthChecker.isReady()).toBe(true);
		expect(findFirst).toHaveBeenCalledTimes(callsWhenOpened);
	});

	it("stops retrying once the gate is stopped", async () => {
		vi.useFakeTimers();
		const { healthChecker, ping } = checker({
			ping: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const stop = healthChecker.gateReadiness({ retryMs: 100 });
		await vi.advanceTimersByTimeAsync(100);
		stop();
		const callsWhenStopped = ping.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(ping).toHaveBeenCalledTimes(callsWhenStopped);
		expect(healthChecker.isReady()).toBe(false);
	});
});
