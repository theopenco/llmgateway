import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	DbCircuitOpenError,
	getDbCircuitState,
	isDbUnavailableError,
	resetDbCircuit,
} from "./db-circuit-breaker.js";
import { redisClient } from "./redis.js";
import { swrWrap, waitForSwrMirrorWrites } from "./swr.js";

function poolTimeout(): Error {
	return new Error("timeout exceeded when trying to connect");
}

describe("database circuit breaker", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
		resetDbCircuit();
		process.env.DB_CIRCUIT_FAILURE_THRESHOLD = "3";
		process.env.DB_CIRCUIT_OPEN_MS = "200";
	});

	afterEach(async () => {
		delete process.env.DB_CIRCUIT_FAILURE_THRESHOLD;
		delete process.env.DB_CIRCUIT_OPEN_MS;
		resetDbCircuit();
		await redisClient.flushdb();
	});

	it("classifies only infrastructure errors as unavailability", () => {
		expect(isDbUnavailableError(poolTimeout())).toBe(true);
		expect(
			isDbUnavailableError(Object.assign(new Error("x"), { code: "53300" })),
		).toBe(true);
		expect(
			isDbUnavailableError(Object.assign(new Error("x"), { code: "08006" })),
		).toBe(true);
		// Drizzle wraps the driver error in `cause`.
		expect(
			isDbUnavailableError(
				new Error("Failed query", {
					cause: Object.assign(
						new Error("canceling statement due to lock timeout"),
						{ code: "55P03" },
					),
				}),
			),
		).toBe(true);
		expect(
			isDbUnavailableError(Object.assign(new Error("dup"), { code: "23505" })),
		).toBe(false);
		expect(isDbUnavailableError(new Error("column does not exist"))).toBe(
			false,
		);
	});

	it("opens after repeated outages and serves mirrors without touching the database", async () => {
		await swrWrap("cb:primed", ["t"], () => Promise.resolve({ v: 1 }));
		await waitForSwrMirrorWrites();

		for (let i = 0; i < 3; i++) {
			await expect(
				swrWrap(`cb:cold:${i}`, ["t"], () => Promise.reject(poolTimeout())),
			).rejects.toThrow("timeout exceeded");
		}
		expect(getDbCircuitState()).toBe("open");

		const fetcher = vi.fn(() => Promise.resolve({ v: 2 }));
		expect(await swrWrap("cb:primed", ["t"], fetcher)).toEqual({ v: 1 });
		const startedAt = Date.now();
		await expect(swrWrap("cb:unprimed", ["t"], fetcher)).rejects.toBeInstanceOf(
			DbCircuitOpenError,
		);
		expect(Date.now() - startedAt).toBeLessThan(100);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("never mirrors a failed fetch", async () => {
		await expect(
			swrWrap("cb:fail", ["t"], () => Promise.reject(poolTimeout())),
		).rejects.toThrow();
		await waitForSwrMirrorWrites();
		expect(await redisClient.keys("swr:*cb:fail*")).toEqual([]);
	});

	it("ignores query errors", async () => {
		for (let i = 0; i < 5; i++) {
			await expect(
				swrWrap(`cb:bug:${i}`, ["t"], () =>
					Promise.reject(Object.assign(new Error("syntax"), { code: "42601" })),
				),
			).rejects.toThrow("syntax");
		}
		expect(getDbCircuitState()).toBe("closed");
	});

	it("lets one probe through after the open interval and closes on success", async () => {
		for (let i = 0; i < 3; i++) {
			await swrWrap(`cb:x:${i}`, ["t"], () =>
				Promise.reject(poolTimeout()),
			).catch(() => undefined);
		}
		expect(getDbCircuitState()).toBe("open");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(getDbCircuitState()).toBe("half-open");

		expect(await swrWrap("cb:probe", ["t"], () => Promise.resolve(42))).toBe(
			42,
		);
		expect(getDbCircuitState()).toBe("closed");
	});

	it("re-opens when the probe fails", async () => {
		for (let i = 0; i < 3; i++) {
			await swrWrap(`cb:y:${i}`, ["t"], () =>
				Promise.reject(poolTimeout()),
			).catch(() => undefined);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
		await expect(
			swrWrap("cb:probe-fail", ["t"], () => Promise.reject(poolTimeout())),
		).rejects.toThrow();
		expect(getDbCircuitState()).toBe("open");
	});
});
