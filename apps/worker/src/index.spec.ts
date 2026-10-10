import { beforeEach, describe, expect, it, vi } from "vitest";

import { stopWorkerAndFlush } from "./index.js";

const shutdown = vi.hoisted(() =>
	vi.fn<(timeoutMs?: number) => Promise<void>>(),
);
vi.mock("./posthog.js", () => ({ posthog: { shutdown } }));
const stopWorker = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("./worker.js", () => ({
	processLogQueue: vi.fn(),
	startWorker: vi.fn(),
	stopWorker,
}));

describe("stopWorkerAndFlush", () => {
	beforeEach(() => {
		stopWorker.mockReset();
		shutdown.mockReset().mockResolvedValue(undefined);
	});

	it("flushes PostHog before exiting on SIGTERM", async () => {
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as typeof process.exit);
		stopWorker.mockResolvedValue(true);
		process.emit("SIGTERM", "SIGTERM");
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
		expect(shutdown).toHaveBeenCalledOnce();
		expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(
			exit.mock.invocationCallOrder[0],
		);
		exit.mockRestore();
	});

	it.each([
		["stop", true],
		["time out", false],
	])(
		"flushes PostHog with a bounded timeout once the worker loops %s",
		async (_, stopped) => {
			let finishStop: (stopped: boolean) => void = () => {};
			stopWorker.mockReturnValue(
				new Promise((resolve) => {
					finishStop = resolve;
				}),
			);
			const stopping = stopWorkerAndFlush();
			await new Promise((resolve) => setImmediate(resolve));
			expect(
				shutdown,
				"flushed before the loops finished",
			).not.toHaveBeenCalled();

			finishStop(stopped);
			await stopping;
			expect(shutdown).toHaveBeenCalledExactlyOnceWith(expect.any(Number));
		},
	);

	it("flushes PostHog and rethrows when stopping the worker fails", async () => {
		const error = new Error("stop failed");
		stopWorker.mockRejectedValue(error);
		await expect(stopWorkerAndFlush()).rejects.toBe(error);
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("completes shutdown when the PostHog flush times out", async () => {
		stopWorker.mockResolvedValue(true);
		shutdown.mockRejectedValue(
			"Timeout while shutting down PostHog. Some events may not have been sent.",
		);
		await expect(stopWorkerAndFlush()).resolves.toBeUndefined();
	});
});
