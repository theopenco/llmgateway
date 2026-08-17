import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import { getBlockedSignupCountries } from "@/utils/country-blocking.js";

describe("admin blocked signup countries", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("returns an empty list by default", async () => {
		const res = await app.request("/admin/settings/blocked-signup-countries", {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ countries: [] });
	});

	test("requires authentication", async () => {
		const res = await app.request("/admin/settings/blocked-signup-countries");
		expect(res.status).toBe(401);
	});

	test("stores a normalized list", async () => {
		const res = await app.request("/admin/settings/blocked-signup-countries", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ countries: [" aq ", "kp", "AQ"] }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ countries: ["AQ", "KP"] });
		expect(await getBlockedSignupCountries()).toEqual(["AQ", "KP"]);
	});

	test("rejects invalid country codes", async () => {
		const res = await app.request("/admin/settings/blocked-signup-countries", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ countries: ["AQ", "Germany"] }),
		});

		expect(res.status).toBe(400);
		expect(await getBlockedSignupCountries()).toEqual([]);
	});

	test("clears the list", async () => {
		await app.request("/admin/settings/blocked-signup-countries", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ countries: ["AQ"] }),
		});

		const res = await app.request("/admin/settings/blocked-signup-countries", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ countries: [] }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ countries: [] });
		expect(await getBlockedSignupCountries()).toEqual([]);
	});
});
