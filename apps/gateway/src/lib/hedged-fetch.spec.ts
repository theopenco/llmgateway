import { createServer } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getUpstreamHedgeDelayMs, hedgedFetch } from "./hedged-fetch.js";

import type { Server } from "node:http";

interface ScriptStep {
	delayMs?: number;
	body?: string;
	destroy?: boolean;
	destroyAfterMs?: number;
}

describe("hedgedFetch", () => {
	let server: Server;
	let baseUrl: string;
	let script: ScriptStep[] = [];
	let requestCount = 0;

	beforeAll(async () => {
		server = createServer((req, res) => {
			const step = script[requestCount] ?? {};
			requestCount++;
			if (step.destroy) {
				req.socket.destroy();
				return;
			}
			if (step.destroyAfterMs !== undefined) {
				setTimeout(() => req.socket.destroy(), step.destroyAfterMs);
				return;
			}
			const timer = setTimeout(() => {
				if (res.socket?.destroyed) {
					return;
				}
				res.writeHead(200, { "content-type": "text/plain" });
				res.end(step.body ?? "ok");
			}, step.delayMs ?? 0);
			timer.unref();
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (typeof address === "string" || !address) {
			throw new Error("expected a TCP address");
		}
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(() => {
		script = [];
		requestCount = 0;
		delete process.env.UPSTREAM_HEDGE_DELAY_MS;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	});

	it("returns the primary without hedging when it responds in time", async () => {
		script = [{ body: "primary" }];
		let hedged = false;
		const res = await hedgedFetch(
			baseUrl,
			{ method: "POST", body: "{}" },
			{
				signal: AbortSignal.timeout(5_000),
				delayMs: 500,
				onHedge: () => {
					hedged = true;
				},
			},
		);
		expect(await res.text()).toBe("primary");
		expect(requestCount).toBe(1);
		expect(hedged).toBe(false);
	});

	it("serves the hedge when the primary stalls before headers", async () => {
		script = [{ delayMs: 600, body: "primary" }, { body: "hedge" }];
		let hedged = false;
		let winner: string | undefined;
		const res = await hedgedFetch(
			baseUrl,
			{ method: "POST", body: "{}" },
			{
				signal: AbortSignal.timeout(5_000),
				delayMs: 50,
				onHedge: () => {
					hedged = true;
				},
				onWinner: (w) => {
					winner = w;
				},
			},
		);
		expect(await res.text()).toBe("hedge");
		expect(requestCount).toBe(2);
		expect(hedged).toBe(true);
		expect(winner).toBe("hedge");
	});

	it("still serves the primary when it beats an issued hedge", async () => {
		script = [
			{ delayMs: 150, body: "primary" },
			{ delayMs: 600, body: "hedge" },
		];
		let winner: string | undefined;
		const res = await hedgedFetch(
			baseUrl,
			{ method: "POST", body: "{}" },
			{
				signal: AbortSignal.timeout(5_000),
				delayMs: 50,
				onWinner: (w) => {
					winner = w;
				},
			},
		);
		expect(await res.text()).toBe("primary");
		expect(requestCount).toBe(2);
		expect(winner).toBe("primary");
	});

	it("behaves as a plain fetch when the delay is zero", async () => {
		script = [{ delayMs: 150, body: "only" }];
		let hedged = false;
		const res = await hedgedFetch(
			baseUrl,
			{ method: "POST", body: "{}" },
			{
				signal: AbortSignal.timeout(5_000),
				delayMs: 0,
				onHedge: () => {
					hedged = true;
				},
			},
		);
		expect(await res.text()).toBe("only");
		expect(requestCount).toBe(1);
		expect(hedged).toBe(false);
	});

	it("propagates a primary failure that happens before the hedge fires", async () => {
		script = [{ destroy: true }];
		await expect(
			hedgedFetch(
				baseUrl,
				{ method: "POST", body: "{}" },
				{ signal: AbortSignal.timeout(5_000), delayMs: 500 },
			),
		).rejects.toThrow();
		expect(requestCount).toBe(1);
	});

	it("serves the hedge when the primary fails after the hedge was issued", async () => {
		script = [{ destroyAfterMs: 100 }, { body: "hedge" }];
		const res = await hedgedFetch(
			baseUrl,
			{ method: "POST", body: "{}" },
			{ signal: AbortSignal.timeout(5_000), delayMs: 30 },
		);
		expect(await res.text()).toBe("hedge");
		expect(requestCount).toBe(2);
	});

	it("rejects when both branches fail", async () => {
		script = [{ destroyAfterMs: 100 }, { destroy: true }];
		await expect(
			hedgedFetch(
				baseUrl,
				{ method: "POST", body: "{}" },
				{ signal: AbortSignal.timeout(5_000), delayMs: 30 },
			),
		).rejects.toThrow();
		expect(requestCount).toBe(2);
	});

	it("aborts both branches when the outer signal fires", async () => {
		script = [
			{ delayMs: 2_000, body: "primary" },
			{ delayMs: 2_000, body: "hedge" },
		];
		await expect(
			hedgedFetch(
				baseUrl,
				{ method: "POST", body: "{}" },
				{ signal: AbortSignal.timeout(150), delayMs: 30 },
			),
		).rejects.toMatchObject({ name: "TimeoutError" });
		expect(requestCount).toBe(2);
	});
});

describe("getUpstreamHedgeDelayMs", () => {
	afterEach(() => {
		delete process.env.UPSTREAM_HEDGE_DELAY_MS;
	});

	it("defaults to 0 (disabled) so hedging is a deployment opt-in", () => {
		expect(getUpstreamHedgeDelayMs()).toBe(0);
	});

	it("honors an env override, including 0 to disable", () => {
		process.env.UPSTREAM_HEDGE_DELAY_MS = "800";
		expect(getUpstreamHedgeDelayMs()).toBe(800);
		process.env.UPSTREAM_HEDGE_DELAY_MS = "0";
		expect(getUpstreamHedgeDelayMs()).toBe(0);
	});

	it("falls back to disabled on invalid values", () => {
		process.env.UPSTREAM_HEDGE_DELAY_MS = "not-a-number";
		expect(getUpstreamHedgeDelayMs()).toBe(0);
		process.env.UPSTREAM_HEDGE_DELAY_MS = "-5";
		expect(getUpstreamHedgeDelayMs()).toBe(0);
	});
});
