import { afterEach, expect, test, vi } from "vitest";

import * as cache from "@llmgateway/cache";
import * as database from "@llmgateway/db";

import * as history from "./services/stats-calculator.js";
import * as sync from "./services/sync-models.js";
import { requestStop } from "./shutdown.js";
import { startWorker, stopWorker } from "./worker.js";

afterEach(() => {
	vi.restoreAllMocks();
});

test("shutdown waits for startup history before closing shared clients", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(sync, "syncProvidersAndModels").mockImplementation(async () => {
		requestStop();
	});
	vi.spyOn(history, "backfillHistoryIfNeeded").mockImplementation(async () => {
		await gate;
	});
	vi.spyOn(history, "backfillHourlyHistoryIfNeeded").mockResolvedValue();
	const closeDatabase = vi.spyOn(database, "closeDatabase").mockResolvedValue();
	const closeRedis = vi.spyOn(cache, "closeRedisClient").mockResolvedValue();
	const closeStorage = vi
		.spyOn(cache, "closeStorageRedisClient")
		.mockResolvedValue();
	await startWorker();
	const stopping = stopWorker();
	try {
		const state = await Promise.race([
			stopping.then(() => "closed"),
			new Promise<string>((resolve) =>
				setTimeout(() => resolve("waiting"), 1000),
			),
		]);
		expect(state).toBe("waiting");
		expect(closeDatabase).not.toHaveBeenCalled();
		expect(closeRedis).not.toHaveBeenCalled();
		expect(closeStorage).not.toHaveBeenCalled();
	} finally {
		release();
		expect(await stopping).toBe(true);
	}
	expect(closeDatabase).toHaveBeenCalledOnce();
});
