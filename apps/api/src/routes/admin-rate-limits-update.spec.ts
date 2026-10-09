import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "rate-limit-org";
const original = {
	provider: "openai",
	model: "gpt-4o",
	limitType: "rpm",
	maxRequests: 10,
	enforcement: "per_org",
	mode: "strict",
	reason: "Initial cap",
};

describe("admin rate limit updates", () => {
	let cookie: string;

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await db.delete(tables.rateLimit);
		await deleteAll();
	});

	function request(
		path: string,
		method: string,
		body?: unknown,
		auth = cookie,
	) {
		return app.request(path, {
			method,
			headers: { Cookie: auth, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	for (const scope of ["global", "organization"] as const) {
		const base =
			scope === "global"
				? "/admin/rate-limits"
				: `/admin/organizations/${ORG_ID}/rate-limits`;

		it(`updates every ${scope} setting in place and switches windows`, async () => {
			const createdResponse = await request(base, "POST", original);
			expect(createdResponse.status).toBe(201);
			const created = await createdResponse.json();
			const body = {
				...original,
				provider: null,
				model: "gpt-4o-mini",
				limitType: "rpd",
				maxRequests: 50,
				mode: "soft",
				reason: null,
				enforcement: "global",
			};
			const response = await request(`${base}/${created.id}`, "PUT", body);
			expect(response.status).toBe(200);
			const updated = await response.json();
			expect(updated).toMatchObject({
				...body,
				id: created.id,
				createdAt: created.createdAt,
				enforcement: scope === "global" ? "global" : "per_org",
				organizationId: scope === "global" ? null : ORG_ID,
			});
			const stored = await db.query.rateLimit.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(stored).toMatchObject({ maxRpm: null, maxRpd: 50, reason: null });
			expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
				new Date(created.updatedAt).getTime(),
			);
			const list = await (await request(base, "GET")).json();
			expect(list.rateLimits).toContainEqual(updated);
			const reversed = await request(`${base}/${created.id}`, "PUT", original);
			expect(reversed.status).toBe(200);
			expect(
				await db.query.rateLimit.findFirst({
					where: { id: { eq: created.id } },
				}),
			).toMatchObject({ maxRpm: 10, maxRpd: null });
			if (scope === "organization") {
				const events = await db.query.auditLog.findMany({
					where: {
						resourceId: { eq: created.id },
						action: { eq: "rate_limit.update" },
					},
				});
				expect(events).toHaveLength(2);
				expect(events).toContainEqual(
					expect.objectContaining({
						userId: "test-user-id",
						metadata: { before: created, after: updated, source: "admin" },
					}),
				);
			}
		});

		it.each(["strict", "soft", "lax"])(
			`round-trips zero %s ${scope} caps when editing`,
			async (mode) => {
				const created = await (await request(base, "POST", original)).json();
				for (const limitType of ["rpm", "rpd"]) {
					const response = await request(`${base}/${created.id}`, "PUT", {
						...original,
						limitType,
						maxRequests: 0,
						mode,
					});
					expect(response.status).toBe(200);
					const updated = await response.json();
					expect(updated).toMatchObject({
						id: created.id,
						maxRequests: 0,
						mode,
						limitType,
					});
					const list = await (await request(base, "GET")).json();
					expect(list.rateLimits).toContainEqual(updated);
				}
			},
		);

		it(`rejects invalid ${scope} edits without changing the rule`, async () => {
			const created = await (await request(base, "POST", original)).json();
			for (const change of [
				{ maxRequests: -1 },
				{ maxRequests: 1.5 },
				{ provider: null, model: null },
				{ provider: "missing-provider" },
				{ model: "missing-model" },
				{ provider: "anthropic", model: "gpt-4o" },
			]) {
				const response = await request(`${base}/${created.id}`, "PUT", {
					...original,
					...change,
				});
				expect(response.status).toBe(400);
			}
			const list = await (await request(base, "GET")).json();
			expect(list.rateLimits).toContainEqual(created);
		});

		it(`rejects conflicting ${scope} targets, including a different window`, async () => {
			const first = await (await request(base, "POST", original)).json();
			const secondBody = { ...original, model: null };
			const second = await (await request(base, "POST", secondBody)).json();
			const response = await request(`${base}/${first.id}`, "PUT", {
				...secondBody,
				limitType: "rpd",
			});
			expect(response.status).toBe(409);
			const list = await (await request(base, "GET")).json();
			expect(list.rateLimits).toEqual(expect.arrayContaining([first, second]));
			expect(
				(await request(`${base}/${first.id}`, "PUT", original)).status,
			).toBe(200);
		});

		it(`enforces ${scope} update permissions`, async () => {
			const created = await (await request(base, "POST", original)).json();
			expect(
				(await request(`${base}/${created.id}`, "PUT", original, "")).status,
			).toBe(401);
			vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
			for (const role of ["ADMIN_VIEWER_EMAILS", "ADMIN_SUPPORT_EMAILS"]) {
				vi.stubEnv(role, "admin@example.com");
				expect(
					(await request(`${base}/${created.id}`, "PUT", original)).status,
				).toBe(403);
				vi.stubEnv(role, "");
			}
			expect(
				(await request(`${base}/${created.id}`, "PUT", original)).status,
			).toBe(403);
		});
	}

	it("returns 404 for missing and incorrectly scoped rules", async () => {
		const global = await (
			await request("/admin/rate-limits", "POST", original)
		).json();
		const org = await (
			await request(
				`/admin/organizations/${ORG_ID}/rate-limits`,
				"POST",
				original,
			)
		).json();
		for (const path of [
			"/admin/rate-limits/missing",
			`/admin/rate-limits/${org.id}`,
			`/admin/organizations/${ORG_ID}/rate-limits/${global.id}`,
			`/admin/organizations/${ORG_ID}/rate-limits/missing`,
			`/admin/organizations/another-org/rate-limits/${org.id}`,
		]) {
			expect((await request(path, "PUT", original)).status).toBe(404);
		}
	});
});
