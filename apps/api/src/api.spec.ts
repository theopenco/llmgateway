import { expect, test } from "vitest";

import { app } from "./index.js";

test("/ answers without touching dependencies", async () => {
	const res = await app.request("/");
	expect(res.status).toBe(200);
	const data = await res.json();
	expect(data).toHaveProperty("message", "OK");
	expect(data).toHaveProperty("version");
	expect(data).not.toHaveProperty("health");
});

test("/health/deep checks the database and Redis", async () => {
	const res = await app.request("/health/deep");
	expect(res.status).toBe(200);
	const data = await res.json();
	expect(data.health).toMatchObject({
		status: "ok",
		database: { connected: true },
		redis: { connected: true },
	});
});

test("/livez", async () => {
	const res = await app.request("/livez");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ status: "ok" });
});

test("/user/me", async () => {
	const res = await app.request("/user/me");
	expect(res.status).toBe(401);
	const text = await res.text();
	expect(text).toMatch(/Unauthorized/);
});
