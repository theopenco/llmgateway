import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	flushPendingQueueMessages,
	pendingQueueMessageCount,
	publishToQueue,
	redisClient,
} from "./redis.js";

const TEST_QUEUE = "test_pending_retry_queue";

// Note: other spec files (e.g. swr.spec.ts) run flushdb() against the shared
// Redis instance concurrently, so these tests never assert on real Redis
// state — lpush is always mocked.
describe("publishToQueue retry buffer", () => {
	async function drainPendingBuffer(): Promise<void> {
		const spy = vi.spyOn(redisClient, "lpush").mockResolvedValue(0);
		await flushPendingQueueMessages();
		spy.mockRestore();
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await drainPendingBuffer();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await drainPendingBuffer();
	});

	it("publishes directly when Redis is available", async () => {
		const spy = vi.spyOn(redisClient, "lpush").mockResolvedValue(1);

		await publishToQueue(TEST_QUEUE, { requestId: "direct" });

		expect(pendingQueueMessageCount()).toBe(0);
		expect(spy).toHaveBeenCalledWith(
			TEST_QUEUE,
			JSON.stringify({ requestId: "direct" }),
		);
	});

	it("buffers messages on connection errors instead of throwing, then flushes on recovery", async () => {
		const spy = vi
			.spyOn(redisClient, "lpush")
			.mockRejectedValue(new Error("Connection is closed."));

		await expect(
			publishToQueue(TEST_QUEUE, { requestId: "r1" }),
		).resolves.toBeUndefined();
		await expect(
			publishToQueue(TEST_QUEUE, { requestId: "r2" }),
		).resolves.toBeUndefined();
		expect(pendingQueueMessageCount()).toBe(2);

		spy.mockResolvedValue(1);

		const flushed = await flushPendingQueueMessages();
		expect(flushed).toBe(2);
		expect(pendingQueueMessageCount()).toBe(0);
		expect(spy).toHaveBeenCalledWith(
			TEST_QUEUE,
			JSON.stringify({ requestId: "r1" }),
		);
		expect(spy).toHaveBeenCalledWith(
			TEST_QUEUE,
			JSON.stringify({ requestId: "r2" }),
		);
	});

	it("buffers messages on ECONNREFUSED-style errors", async () => {
		const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");
		(error as NodeJS.ErrnoException).code = "ECONNREFUSED";
		vi.spyOn(redisClient, "lpush").mockRejectedValue(error);

		await expect(
			publishToQueue(TEST_QUEUE, { requestId: "r3" }),
		).resolves.toBeUndefined();
		expect(pendingQueueMessageCount()).toBe(1);
	});

	it("rethrows non-connection errors without buffering", async () => {
		vi.spyOn(redisClient, "lpush").mockRejectedValue(
			new Error(
				"WRONGTYPE Operation against a key holding the wrong kind of value",
			),
		);

		await expect(
			publishToQueue(TEST_QUEUE, { requestId: "r4" }),
		).rejects.toThrow("WRONGTYPE");
		expect(pendingQueueMessageCount()).toBe(0);
	});

	it("keeps buffered messages when the flush attempt fails", async () => {
		vi.spyOn(redisClient, "lpush").mockRejectedValue(
			new Error("Connection is closed."),
		);

		await publishToQueue(TEST_QUEUE, { requestId: "r5" });
		expect(pendingQueueMessageCount()).toBe(1);

		const flushed = await flushPendingQueueMessages();
		expect(flushed).toBe(0);
		expect(pendingQueueMessageCount()).toBe(1);
	});
});
