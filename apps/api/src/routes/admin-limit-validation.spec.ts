import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

const originalAdminEmails = process.env.ADMIN_EMAILS;

describe("admin limit/offset validation", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	describe("GET /admin/model-provider-mappings", () => {
		const path = "/admin/model-provider-mappings";

		it("rejects limit above max (100)", async () => {
			const res = await app.request(`${path}?limit=99999999`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});

		it("rejects negative limit", async () => {
			const res = await app.request(`${path}?limit=-1`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});

		it("rejects negative offset", async () => {
			const res = await app.request(`${path}?offset=-1`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});
	});

	describe("GET /admin/organizations/:orgId/projects/:projectId/model-provider-stats", () => {
		const path =
			"/admin/organizations/org-test/projects/proj-test/model-provider-stats";

		it("rejects limit above max (100)", async () => {
			const res = await app.request(`${path}?limit=99999999`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});

		it("rejects negative limit", async () => {
			const res = await app.request(`${path}?limit=-1`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});

		it("rejects negative offset", async () => {
			const res = await app.request(`${path}?offset=-1`, {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(400);
		});
	});
});
