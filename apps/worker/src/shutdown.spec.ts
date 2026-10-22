import { getEventListeners } from "node:events";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	getStopSignal,
	interruptibleSleep,
	isStopRequested,
	requestStop,
	resetShutdown,
} from "./shutdown.js";

describe("shutdown", () => {
	beforeEach(() => {
		resetShutdown();
	});

	afterEach(() => {
		resetShutdown();
	});

	test("isStopRequested is false initially", () => {
		expect(isStopRequested()).toBe(false);
	});

	test("requestStop flips isStopRequested and aborts the signal", () => {
		const signal = getStopSignal();
		expect(signal.aborted).toBe(false);

		requestStop();

		expect(isStopRequested()).toBe(true);
		expect(signal.aborted).toBe(true);
	});

	test("interruptibleSleep resolves promptly after requestStop", async () => {
		const start = Date.now();
		const sleepPromise = interruptibleSleep(60_000);

		setTimeout(() => requestStop(), 20);

		await sleepPromise;
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(500);
	});

	test("interruptibleSleep returns immediately when stop already requested", async () => {
		requestStop();
		const start = Date.now();
		await interruptibleSleep(10_000);
		expect(Date.now() - start).toBeLessThan(50);
	});

	test("interruptibleSleep waits for the requested duration when no stop", async () => {
		const start = Date.now();
		await interruptibleSleep(120);
		expect(Date.now() - start).toBeGreaterThanOrEqual(100);
	});

	test("resetShutdown re-enables sleeping and provides a fresh non-aborted signal", async () => {
		const firstSignal = getStopSignal();
		requestStop();
		expect(firstSignal.aborted).toBe(true);
		expect(isStopRequested()).toBe(true);

		resetShutdown();

		const freshSignal = getStopSignal();
		expect(freshSignal).not.toBe(firstSignal);
		expect(freshSignal.aborted).toBe(false);
		expect(isStopRequested()).toBe(false);

		const start = Date.now();
		await interruptibleSleep(60);
		expect(Date.now() - start).toBeGreaterThanOrEqual(50);
	});

	test("requestStop is idempotent", () => {
		requestStop();
		const signal = getStopSignal();
		expect(signal.aborted).toBe(true);
		// second call should not throw nor swap the controller
		requestStop();
		expect(getStopSignal()).toBe(signal);
	});

	test("interruptibleSleep clears its timer when stop wakes it", async () => {
		const sleepPromise = interruptibleSleep(60_000);
		setTimeout(() => requestStop(), 5);
		await sleepPromise;
		// If the timer was not cleared, vitest would hang waiting for it after the test.
		// Reaching this point confirms the timer was cleared.
		expect(isStopRequested()).toBe(true);
	});

	test("a finished sleep removes its abort listener", async () => {
		const signal = getStopSignal();
		await interruptibleSleep(1);
		expect(getEventListeners(signal, "abort")).toHaveLength(0);
	});

	test("repeated sleeps do not accumulate abort listeners", async () => {
		const signal = getStopSignal();
		for (let i = 0; i < 50; i++) {
			await interruptibleSleep(1);
		}
		expect(getEventListeners(signal, "abort")).toHaveLength(0);
	});

	test("interruptibleSleep does not race a never-settled promise", async () => {
		const originalRace = Promise.race;
		let calls = 0;
		Promise.race = ((...args: Parameters<typeof Promise.race>) => {
			calls++;
			return originalRace.apply(Promise, args);
		}) as typeof Promise.race;
		try {
			await interruptibleSleep(10);
		} finally {
			Promise.race = originalRace;
		}
		expect(calls).toBe(0);
	});
});
