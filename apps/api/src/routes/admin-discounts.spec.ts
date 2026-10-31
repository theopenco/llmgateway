import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "discount-edit-org";

describe("admin discount and routing multiplier editing", () => {
	let cookie: string;

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Discount Edit Org",
			billingEmail: "discount-edit@example.com",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	function request(path: string, method: string, body?: unknown) {
		return app.request(path, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	it("updates a global discount", async () => {
		const created = await request("/admin/discounts", "POST", {
			provider: "openai",
			discountPercent: 10,
		});
		expect(created.status).toBe(201);
		const { id } = await created.json();

		const expiresAt = "2030-01-01T00:00:00.000Z";
		const updated = await request(`/admin/discounts/${id}`, "PUT", {
			provider: "openai",
			model: "gpt-4o-mini",
			discountPercent: 25,
			reason: "renegotiated",
			expiresAt,
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			id,
			provider: "openai",
			model: "gpt-4o-mini",
			discountPercent: "0.2500",
			reason: "renegotiated",
			expiresAt,
		});
	});

	it("rejects a global discount update that collides with another target", async () => {
		await request("/admin/discounts", "POST", {
			provider: "anthropic",
			discountPercent: 5,
		});
		const created = await request("/admin/discounts", "POST", {
			provider: "openai",
			discountPercent: 10,
		});
		const { id } = await created.json();

		const res = await request(`/admin/discounts/${id}`, "PUT", {
			provider: "anthropic",
			discountPercent: 10,
		});
		expect(res.status).toBe(409);
	});

	it("does not update an organization discount through the global route", async () => {
		const created = await request(
			`/admin/organizations/${ORG_ID}/discounts`,
			"POST",
			{ provider: "openai", discountPercent: 10 },
		);
		const { id } = await created.json();

		const res = await request(`/admin/discounts/${id}`, "PUT", {
			provider: "openai",
			discountPercent: 50,
		});
		expect(res.status).toBe(404);
	});

	it("updates an organization discount and records an audit event", async () => {
		const created = await request(
			`/admin/organizations/${ORG_ID}/discounts`,
			"POST",
			{ provider: "openai", discountPercent: 10 },
		);
		const { id } = await created.json();

		const updated = await request(
			`/admin/organizations/${ORG_ID}/discounts/${id}`,
			"PUT",
			{ provider: "openai", discountPercent: 30, reason: "pilot" },
		);
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			id,
			organizationId: ORG_ID,
			discountPercent: "0.3000",
			reason: "pilot",
		});

		const audit = await db.query.auditLog.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "discount.update" },
			},
		});
		expect(audit).toMatchObject({ userId: "test-user-id", resourceId: id });
		expect(audit?.metadata).toMatchObject({
			before: { discountPercent: "0.1000" },
			after: { discountPercent: "0.3000" },
		});
	});

	it("updates a routing score multiplier", async () => {
		const created = await request("/admin/routing-score-multipliers", "POST", {
			provider: "openai",
			scoreMultiplier: -10,
		});
		expect(created.status).toBe(201);
		const { id } = await created.json();

		const updated = await request(
			`/admin/routing-score-multipliers/${id}`,
			"PUT",
			{ provider: "openai", scoreMultiplier: 15, reason: "flaky" },
		);
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			id,
			provider: "openai",
			scoreMultiplier: "0.1500",
			reason: "flaky",
			expiresAt: null,
		});
	});

	it("rejects routing score multiplier updates for unknown or colliding targets", async () => {
		await request("/admin/routing-score-multipliers", "POST", {
			provider: "anthropic",
			scoreMultiplier: 5,
		});
		const created = await request("/admin/routing-score-multipliers", "POST", {
			provider: "openai",
			scoreMultiplier: -10,
		});
		const { id } = await created.json();

		const collision = await request(
			`/admin/routing-score-multipliers/${id}`,
			"PUT",
			{ provider: "anthropic", scoreMultiplier: 1 },
		);
		expect(collision.status).toBe(409);

		const missing = await request(
			"/admin/routing-score-multipliers/does-not-exist",
			"PUT",
			{ provider: "openai", scoreMultiplier: 1 },
		);
		expect(missing.status).toBe(404);
	});
});
