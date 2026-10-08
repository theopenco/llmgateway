import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestStop, resetShutdown } from "@/shutdown.js";

import { startHistoryAfterRecovery } from "./history-startup.js";
import { initializeMinuteRecovery } from "./stats-calculator.js";

vi.mock("./stats-calculator.js", () => ({ initializeMinuteRecovery: vi.fn() }));

const initialize = vi.mocked(initializeMinuteRecovery);

beforeEach(() => {
	resetShutdown();
	vi.useFakeTimers();
	initialize.mockReset();
	initialize.mockResolvedValue(new Date());
});

afterEach(() => {
	requestStop();
	vi.useRealTimers();
	resetShutdown();
});

describe("history startup", () => {
	it("retries failures before starting history exactly once", async () => {
		initialize.mockRejectedValueOnce(new Error("temporary database failure"));
		const start = vi.fn();
		const startup = startHistoryAfterRecovery(start);
		await vi.advanceTimersByTimeAsync(4999);
		expect(start).not.toHaveBeenCalled();
		expect(initialize).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await startup;
		expect(initialize).toHaveBeenCalledTimes(2);
		expect(start).toHaveBeenCalledTimes(1);
	});

	it("interrupts the retry delay on shutdown without launching history", async () => {
		initialize.mockRejectedValue(new Error("temporary database failure"));
		const start = vi.fn();
		const startup = startHistoryAfterRecovery(start);
		await vi.advanceTimersByTimeAsync(0);
		requestStop();
		await startup;
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(start).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not launch history if shutdown arrives during initialization", async () => {
		let resolveInitialization!: (date: Date) => void;
		initialize.mockReturnValue(
			new Promise<Date>((resolve) => {
				resolveInitialization = resolve;
			}),
		);
		const start = vi.fn();
		const startup = startHistoryAfterRecovery(start);
		requestStop();
		resolveInitialization(new Date());
		await startup;
		expect(start).not.toHaveBeenCalled();
	});
});
