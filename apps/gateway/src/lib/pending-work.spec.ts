import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import {
	drainPendingWork,
	pendingWorkCount,
	streamSSE,
	trackPendingWork,
	waitForPendingWork,
} from "./pending-work.js";

import type { Server } from "node:http";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("pending-work registry", () => {
	test("tracks work until it resolves", async () => {
		const work = deferred();
		const tracked = trackPendingWork(work.promise);
		expect(pendingWorkCount()).toBe(1);

		work.resolve();
		await tracked;
		expect(await waitForPendingWork(1000)).toBe(0);
		expect(pendingWorkCount()).toBe(0);
	});

	test("removes rejected work and preserves the rejection for the caller", async () => {
		const tracked = trackPendingWork(Promise.reject(new Error("boom")));
		await expect(tracked).rejects.toThrow("boom");
		expect(await waitForPendingWork(1000)).toBe(0);
	});

	test("waitForPendingWork times out and reports remaining work", async () => {
		const work = deferred();
		void trackPendingWork(work.promise);

		expect(await waitForPendingWork(150)).toBe(1);

		work.resolve();
		expect(await waitForPendingWork(1000)).toBe(0);
	});

	test("drainPendingWork keeps dependencies alive after the warning threshold", async () => {
		const work = deferred();
		const delayed = deferred();
		void trackPendingWork(work.promise);

		let reportedRemaining = 0;
		let drained = false;
		const drain = drainPendingWork(0, (remaining) => {
			reportedRemaining = remaining;
			delayed.resolve();
		}).then(() => {
			drained = true;
		});

		await delayed.promise;
		expect(reportedRemaining).toBe(1);
		expect(drained).toBe(false);

		work.resolve();
		await drain;
		expect(drained).toBe(true);
	});

	test("streamSSE tail work stays tracked after the response is fully consumed", async () => {
		// Regression: a streaming handler's billing/logging tail runs after the
		// client received [DONE] and the connection closed. Shutdown must be able
		// to see that tail as pending, or it closes the DB pool underneath it.
		const tail = deferred();
		const tailStarted = deferred();

		const app = new Hono();
		app.get("/stream", (c) =>
			streamSSE(c, async (stream) => {
				await stream.writeSSE({ data: "[DONE]" });
				tailStarted.resolve();
				await tail.promise;
			}),
		);

		const server = serve({ fetch: app.fetch, port: 0 });
		await new Promise<void>((resolve) => {
			(server as Server).once("listening", () => resolve());
		});
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		try {
			// Read the first chunk and hang up, like a client that stops reading
			// once it has seen [DONE] — the stream callback keeps running.
			const response = await fetch(`http://localhost:${port}/stream`);
			const reader = response.body!.getReader();
			const first = await reader.read();
			expect(new TextDecoder().decode(first.value)).toContain("[DONE]");
			await reader.cancel();

			await tailStarted.promise;
			expect(pendingWorkCount()).toBe(1);
			expect(await waitForPendingWork(150)).toBe(1);

			tail.resolve();
			expect(await waitForPendingWork(1000)).toBe(0);
		} finally {
			tail.resolve();
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		}
	});
});
