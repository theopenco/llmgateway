import { describe, expect, test } from "vitest";

import { app } from "./app.js";
import { metricsApp } from "./metrics-app.js";

describe("metrics endpoint isolation", () => {
	test("the public gateway app does not expose /metrics", async () => {
		const res = await app.request("/metrics");
		expect(res.status).toBe(404);
	});

	test("the internal metrics app serves Prometheus metrics", async () => {
		const res = await metricsApp.request("/metrics");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/plain");
	});
});
