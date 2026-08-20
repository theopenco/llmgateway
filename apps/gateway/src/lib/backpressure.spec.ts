import { EventEmitter } from "node:events";

import { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";

import { gatewayRequestsShedTotal } from "@llmgateway/instrumentation";

import { internalApiOriginHeaders } from "./api-origin.js";
import { backpressureMiddleware } from "./backpressure.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

async function shedCount(): Promise<number> {
	const metric = await gatewayRequestsShedTotal.get();
	return (
		metric.values.find((value) => value.labels.scope === "pod")?.value ?? 0
	);
}

describe("backpressure middleware", () => {
	afterEach(() => {
		delete process.env.GATEWAY_MAX_INFLIGHT_REQUESTS;
	});

	test("sheds excess inference load with 529 and frees slots on response close", async () => {
		process.env.GATEWAY_MAX_INFLIGHT_REQUESTS = "2";

		const app = new Hono();
		app.use("*", backpressureMiddleware);

		const gates: Array<() => void> = [];
		app.post("/v1/chat/completions", async (c) => {
			await new Promise<void>((resolve) => gates.push(resolve));
			return c.text("ok");
		});
		app.get("/", (c) => c.text("health"));

		const outgoing = () => new EventEmitter();
		const o1 = outgoing();
		const o2 = outgoing();

		const shedBefore = await shedCount();
		const post = { method: "POST" };

		const r1 = app.request("/v1/chat/completions", post, { outgoing: o1 });
		const r2 = app.request("/v1/chat/completions", post, { outgoing: o2 });
		await tick();
		expect(gates).toHaveLength(2);

		// Cap reached: the next request is shed immediately, not queued.
		const res3 = await app.request("/v1/chat/completions", post, {
			outgoing: outgoing(),
		});
		expect(res3.status).toBe(529);
		expect(res3.headers.get("Retry-After")).toBe("1");
		expect(await shedCount()).toBe(shedBefore + 1);

		// Health stays exempt so the pod keeps passing readiness while shedding.
		const resHealth = await app.request("/", {}, { outgoing: outgoing() });
		expect(resHealth.status).toBe(200);

		// Completing one request and closing its connection frees a slot.
		gates[0]();
		await r1;
		o1.emit("close");
		await tick();

		const o4 = outgoing();
		const r4 = app.request("/v1/chat/completions", post, { outgoing: o4 });
		await tick();
		expect(gates).toHaveLength(3);

		gates[1]();
		gates[2]();
		await Promise.all([r2, r4]);

		// Close the remaining connections so the shared in-flight counter returns
		// to 0 and doesn't leak into other tests.
		o2.emit("close");
		o4.emit("close");
	});

	test("non-inference requests are never counted", async () => {
		process.env.GATEWAY_MAX_INFLIGHT_REQUESTS = "1";

		const app = new Hono();
		app.use("*", backpressureMiddleware);
		app.get("/", (c) => c.text("health"));
		app.get("/metrics", (c) => c.text("metrics"));
		app.all("/mcp", (c) => c.text("mcp"));
		app.get("/v1/models", (c) => c.text("models"));
		app.get("/v1/videos/vid_1", (c) => c.text("status"));
		app.post("/v1/chat/completions", async (c) => {
			await new Promise<void>((resolve) => gate.push(resolve));
			return c.text("ok");
		});

		// Hold the single slot with an inference request...
		const gate: Array<() => void> = [];
		const held = new EventEmitter();
		const r1 = app.request(
			"/v1/chat/completions",
			{ method: "POST" },
			{ outgoing: held },
		);
		await tick();
		expect(gate).toHaveLength(1);

		// ...cheap reads keep flowing even though the cap is saturated.
		for (const path of ["/", "/metrics", "/mcp", "/v1/models"]) {
			const res = await app.request(path, {}, { outgoing: new EventEmitter() });
			expect(res.status).toBe(200);
		}
		// GETs on inference prefixes (e.g. video status polls) are cheap too.
		const statusRes = await app.request(
			"/v1/videos/vid_1",
			{},
			{ outgoing: new EventEmitter() },
		);
		expect(statusRes.status).toBe(200);

		gate[0]();
		await r1;
		held.emit("close");
	});

	test("internal re-dispatch hops are not double-counted or shed", async () => {
		process.env.GATEWAY_MAX_INFLIGHT_REQUESTS = "1";

		const app = new Hono();
		app.use("*", backpressureMiddleware);

		const gate: Array<() => void> = [];
		app.post("/v1/chat/completions", async (c) => {
			await new Promise<void>((resolve) => gate.push(resolve));
			return c.text("ok");
		});

		// The outer request holds the pod's only slot...
		const held = new EventEmitter();
		const r1 = app.request(
			"/v1/chat/completions",
			{ method: "POST" },
			{ outgoing: held },
		);
		await tick();
		expect(gate).toHaveLength(1);

		// ...but its internal forwarding hop must still be admitted, not 529'd.
		const r2 = app.request(
			"/v1/chat/completions",
			{ method: "POST", headers: internalApiOriginHeaders("messages") },
			{ outgoing: new EventEmitter() },
		);
		await tick();
		expect(gate).toHaveLength(2);

		gate[0]();
		gate[1]();
		await Promise.all([r1, r2]);
		held.emit("close");
	});
});
