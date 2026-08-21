import { describe, expect, test } from "vitest";

import { raceClientAbort } from "./client-abort.js";

describe("raceClientAbort", () => {
	test("resolves with the body value when the client stays connected", async () => {
		const client = new AbortController();
		const upstream = new AbortController();

		await expect(
			raceClientAbort(Promise.resolve("body"), client.signal, upstream),
		).resolves.toBe("body");
		expect(upstream.signal.aborted).toBe(false);
	});

	test("passes body read failures through unchanged", async () => {
		const client = new AbortController();
		const upstream = new AbortController();
		const failure = new TypeError("terminated");

		await expect(
			raceClientAbort(Promise.reject(failure), client.signal, upstream),
		).rejects.toBe(failure);
	});

	test("rejects with AbortError when the client aborts mid-read and aborts the upstream controller", async () => {
		const client = new AbortController();
		const upstream = new AbortController();
		const hangingBody = new Promise<string>(() => {});

		const race = raceClientAbort(hangingBody, client.signal, upstream);
		client.abort();

		await expect(race).rejects.toMatchObject({ name: "AbortError" });
		expect(upstream.signal.aborted).toBe(true);
	});

	test("rejects immediately when the client signal is already aborted", async () => {
		const client = new AbortController();
		client.abort();
		const upstream = new AbortController();
		const hangingBody = new Promise<string>(() => {});

		await expect(
			raceClientAbort(hangingBody, client.signal, upstream),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(upstream.signal.aborted).toBe(true);
	});

	test("returns the body read unchanged when cancellation is not supported", async () => {
		const client = new AbortController();
		client.abort();

		// No upstream controller: a disconnect must not interrupt the read, the
		// gateway finishes consuming the upstream response for logging/billing.
		await expect(
			raceClientAbort(Promise.resolve("body"), client.signal, undefined),
		).resolves.toBe("body");
	});

	test("consumes the body promise's late rejection after the abort already won", async () => {
		let rejectBody!: (error: Error) => void;
		const body = new Promise<string>((_, reject) => {
			rejectBody = reject;
		});
		const client = new AbortController();
		const upstream = new AbortController();

		const race = raceClientAbort(body, client.signal, upstream);
		client.abort();
		await expect(race).rejects.toMatchObject({ name: "AbortError" });

		// The upstream teardown rejects the losing body read afterwards; vitest
		// fails the run if this surfaces as an unhandled rejection.
		rejectBody(new Error("late upstream teardown"));
		await new Promise((resolve) => setTimeout(resolve, 10));
	});

	test("resolves when the body settles before a later client abort", async () => {
		const client = new AbortController();
		const upstream = new AbortController();

		const value = await raceClientAbort(
			Promise.resolve("body"),
			client.signal,
			upstream,
		);
		client.abort();

		// The abort listener was removed when the body settled, so a later
		// disconnect no longer tears down the upstream controller.
		expect(value).toBe("body");
		expect(upstream.signal.aborted).toBe(false);
	});
});
