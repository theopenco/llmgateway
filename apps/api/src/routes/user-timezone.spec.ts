import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("account time zone", () => {
	let token: string;
	beforeEach(async () => {
		token = await createTestUser();
	});
	afterEach(async () => {
		await deleteAll();
	});

	it("persists a saved zone independently of browser cookies and other users", async () => {
		await db.insert(tables.user).values({
			id: "other-zone-user",
			email: "other@example.com",
			timeZone: "UTC",
		});
		const initial = await app.request("/user/me", {
			headers: { Cookie: token },
		});
		expect((await initial.json()).user.timeZone).toBeNull();
		const update = await app.request("/user/me", {
			method: "PATCH",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ timeZone: "America/New_York" }),
		});
		expect(update.status).toBe(200);
		expect((await update.json()).user.timeZone).toBe("America/New_York");
		const read = await app.request("/user/me", {
			headers: { Cookie: `${token}; llmgateway-timezone=local:Asia/Bangkok` },
		});
		expect((await read.json()).user.timeZone).toBe("America/New_York");
		const other = await db.query.user.findFirst({
			where: { id: "other-zone-user" },
		});
		expect(other?.timeZone).toBe("UTC");
	});

	it("rejects invalid zones and unauthenticated changes", async () => {
		for (const timeZone of ["Not/AZone", "", "x".repeat(65)]) {
			const response = await app.request("/user/me", {
				method: "PATCH",
				headers: { Cookie: token, "Content-Type": "application/json" },
				body: JSON.stringify({ timeZone }),
			});
			expect(response.status).toBe(400);
		}
		const response = await app.request("/user/me", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ timeZone: "UTC" }),
		});
		expect(response.status).toBe(401);
	});

	it("accepts UTC and clearing a saved zone", async () => {
		for (const timeZone of ["UTC", null]) {
			const response = await app.request("/user/me", {
				method: "PATCH",
				headers: { Cookie: token, "Content-Type": "application/json" },
				body: JSON.stringify({ timeZone }),
			});
			expect(response.status).toBe(200);
			expect((await response.json()).user.timeZone).toBe(timeZone);
		}
	});
});
