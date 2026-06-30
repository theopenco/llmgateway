import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_SSE_KEEPALIVE_INTERVAL_MS,
	getSseKeepaliveIntervalMs,
	startSseKeepalive,
} from "./sse-keepalive.js";

function mockStream() {
	const writes: string[] = [];
	return {
		writes,
		write: vi.fn((input: string) => {
			writes.push(input);
			return Promise.resolve();
		}),
	};
}

describe("getSseKeepaliveIntervalMs", () => {
	const original = process.env.SSE_KEEPALIVE_INTERVAL_MS;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.SSE_KEEPALIVE_INTERVAL_MS;
		} else {
			process.env.SSE_KEEPALIVE_INTERVAL_MS = original;
		}
	});

	it("defaults to 15s when unset", () => {
		delete process.env.SSE_KEEPALIVE_INTERVAL_MS;
		expect(getSseKeepaliveIntervalMs()).toBe(DEFAULT_SSE_KEEPALIVE_INTERVAL_MS);
	});

	it("honors a positive override", () => {
		process.env.SSE_KEEPALIVE_INTERVAL_MS = "5000";
		expect(getSseKeepaliveIntervalMs()).toBe(5000);
	});

	it("ignores non-positive or non-numeric overrides", () => {
		process.env.SSE_KEEPALIVE_INTERVAL_MS = "0";
		expect(getSseKeepaliveIntervalMs()).toBe(DEFAULT_SSE_KEEPALIVE_INTERVAL_MS);
		process.env.SSE_KEEPALIVE_INTERVAL_MS = "-1";
		expect(getSseKeepaliveIntervalMs()).toBe(DEFAULT_SSE_KEEPALIVE_INTERVAL_MS);
		process.env.SSE_KEEPALIVE_INTERVAL_MS = "abc";
		expect(getSseKeepaliveIntervalMs()).toBe(DEFAULT_SSE_KEEPALIVE_INTERVAL_MS);
	});
});

describe("startSseKeepalive", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pings immediately so a slow first token doesn't leave the stream silent", () => {
		const stream = mockStream();
		const stop = startSseKeepalive(stream, 15000);

		expect(stream.writes).toEqual([": ping\n"]);

		stop();
	});

	it("pings on every interval until stopped", () => {
		const stream = mockStream();
		const stop = startSseKeepalive(stream, 15000);

		vi.advanceTimersByTime(45000);
		expect(stream.write).toHaveBeenCalledTimes(4); // immediate + 3 intervals

		stop();
		vi.advanceTimersByTime(60000);
		expect(stream.write).toHaveBeenCalledTimes(4);
	});

	it("swallows write rejections so a closed stream doesn't crash the timer", async () => {
		const stream = {
			write: vi.fn(() => Promise.reject(new Error("stream closed"))),
		};

		const stop = startSseKeepalive(stream, 15000);
		await Promise.resolve();

		expect(() => vi.advanceTimersByTime(15000)).not.toThrow();
		stop();
	});
});
