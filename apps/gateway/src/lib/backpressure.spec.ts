import { EventEmitter } from "node:events";

import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("backpressure middleware", () => {
	afterEach(() => {
		delete process.env.GATEWAY_MAX_INFLIGHT_REQUESTS;
		vi.resetModules();
	});

	test("sheds excess load with 529 and frees slots on response close", async () => {
		vi.resetModules();
		process.env.GATEWAY_MAX_INFLIGHT_REQUESTS = "2";
		const { backpressureMiddleware } = await import("./backpressure.js");

		const app = new Hono();
		app.use("*", backpressureMiddleware);

		const gates: Array<() => void> = [];
		app.get("/slow", async (c) => {
			await new Promise<void>((resolve) => gates.push(resolve));
			return c.text("ok");
		});
		app.get("/", (c) => c.text("health"));

		const outgoing = () => new EventEmitter();
		const o1 = outgoing();
		const o2 = outgoing();

		const r1 = app.request("/slow", {}, { outgoing: o1 });
		const r2 = app.request("/slow", {}, { outgoing: o2 });
		await tick();
		expect(gates).toHaveLength(2);

		// Cap reached: the next request is shed immediately, not queued.
		const res3 = await app.request("/slow", {}, { outgoing: outgoing() });
		expect(res3.status).toBe(529);
		expect(res3.headers.get("Retry-After")).toBe("1");

		// Health stays exempt so the pod keeps passing readiness while shedding.
		const resHealth = await app.request("/", {}, { outgoing: outgoing() });
		expect(resHealth.status).toBe(200);

		// Completing one request and closing its connection frees a slot.
		gates[0]();
		await r1;
		o1.emit("close");
		await tick();

		const o4 = outgoing();
		const r4 = app.request("/slow", {}, { outgoing: o4 });
		await tick();
		expect(gates).toHaveLength(3);

		gates[1]();
		gates[2]();
		await Promise.all([r2, r4]);
	});

	test("exempt paths are never counted", async () => {
		vi.resetModules();
		process.env.GATEWAY_MAX_INFLIGHT_REQUESTS = "1";
		const { backpressureMiddleware } = await import("./backpressure.js");

		const app = new Hono();
		app.use("*", backpressureMiddleware);
		app.get("/", (c) => c.text("health"));
		app.get("/metrics", (c) => c.text("metrics"));
		app.all("/mcp", (c) => c.text("mcp"));

		for (const path of ["/", "/metrics", "/mcp"]) {
			const res = await app.request(path, {}, { outgoing: new EventEmitter() });
			expect(res.status).toBe(200);
		}
	});
});
