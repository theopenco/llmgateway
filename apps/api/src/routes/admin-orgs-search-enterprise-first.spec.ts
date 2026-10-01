import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

interface OrgListResponse {
	organizations: { id: string }[];
}

describe("admin — organizations search ranks enterprise first", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: "search-ent-old-enterprise",
				name: "Searchable Enterprise",
				billingEmail: "searchable-enterprise@example.com",
				plan: "enterprise",
				createdAt: new Date("2025-01-01T00:00:00.000Z"),
			},
			{
				id: "search-ent-new-free",
				name: "Searchable Free",
				billingEmail: "searchable-free@example.com",
				createdAt: new Date("2026-06-01T00:00:00.000Z"),
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function listIds(params: string) {
		const res = await app.request(`/admin/organizations?limit=50&${params}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;
		return body.organizations
			.map((o) => o.id)
			.filter((id) => id.startsWith("search-ent-"));
	}

	test("puts the enterprise org ahead of newer matches when searching", async () => {
		expect(
			await listIds("search=searchable&sortBy=createdAt&sortOrder=desc"),
		).toEqual(["search-ent-old-enterprise", "search-ent-new-free"]);
	});

	test("keeps the plain sort order without a search", async () => {
		expect(await listIds("sortBy=createdAt&sortOrder=desc")).toEqual([
			"search-ent-new-free",
			"search-ent-old-enterprise",
		]);
	});
});
