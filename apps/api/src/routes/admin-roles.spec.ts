import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

// The seeded test user is admin@example.com; each test grants it one role.
describe("admin panel staff roles", () => {
	let cookie: string;

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
		cookie = await createTestUser();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	function request(path: string, method = "GET", body?: unknown) {
		return app.request(path, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	it("gives viewers read-only access including platform financials", async () => {
		vi.stubEnv("ADMIN_VIEWER_EMAILS", "admin@example.com");
		const me = await request("/user/me");
		expect((await me.json()).user).toMatchObject({
			isAdmin: false,
			adminRole: "viewer",
		});
		const orgs = await request("/admin/organizations");
		expect(orgs.status).toBe(200);
		expect(await orgs.json()).toHaveProperty("organizations");
		expect((await request("/admin/organizations/missing-org")).status).toBe(
			404,
		);
		expect((await request("/admin/metrics")).status).toBe(200);
		const stats = await request("/admin/global-stats?range=all");
		expect(stats.status).toBe(200);
		expect(await stats.json()).toHaveProperty("totals.cost");
		const keys = await request("/admin/global-stats/provider-keys?range=all");
		expect(keys.status).toBe(200);
		expect(await keys.json()).toHaveProperty("providerKeys");
		const chatPlans = await request("/admin/chat-plans");
		expect(chatPlans.status).toBe(200);
		expect(await chatPlans.json()).toHaveProperty("kpis");
		expect((await request("/admin/chat-plans?sortBy=margin")).status).toBe(200);
		expect((await request("/admin/devpass?marginNegative=true")).status).toBe(
			200,
		);
		expect(
			(
				await request("/admin/discounts", "POST", {
					provider: "openai",
					discountPercent: 10,
				})
			).status,
		).toBe(403);
		expect(
			(
				await request("/admin/devpass/missing-org/refund", "POST", {
					transactionId: "tx",
				})
			).status,
		).toBe(403);
	});

	it("lets support issue refunds but keeps platform financials hidden", async () => {
		vi.stubEnv("ADMIN_SUPPORT_EMAILS", "admin@example.com");
		expect(
			(
				await request("/admin/devpass/missing-org/refund", "POST", {
					transactionId: "tx",
				})
			).status,
		).toBe(404);
		expect(
			(
				await request(
					"/admin/devpass/missing-org/cancel-subscription",
					"POST",
					{ immediate: false },
				)
			).status,
		).toBe(403);
		expect((await request("/admin/metrics")).status).toBe(403);
		expect((await request("/admin/global-stats?range=all")).status).toBe(403);
		expect(
			(await request("/admin/global-stats/provider-keys?range=all")).status,
		).toBe(403);
		const chatPlans = await request("/admin/chat-plans");
		expect(chatPlans.status).toBe(200);
		expect(await chatPlans.json()).not.toHaveProperty("kpis");
	});

	it("keeps full access for admins", async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");

		const me = await request("/user/me");
		expect((await me.json()).user).toMatchObject({
			isAdmin: true,
			adminRole: "admin",
		});
		expect((await request("/admin/metrics")).status).toBe(200);
	});
});
