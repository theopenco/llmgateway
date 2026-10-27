import { expect, test } from "vitest";

import { app } from "./index.js";

test("/", async () => {
	const res = await app.request("/");
	expect(res.status).toBe(200);
	const data = await res.json();
	expect(data).toHaveProperty("message", "OK");
	expect(data).toHaveProperty("health");
	expect(data.health).toHaveProperty("status");
	expect(data.health).toHaveProperty("database");
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
