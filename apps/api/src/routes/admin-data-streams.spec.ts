import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "admin-data-streams-org";

describe("admin data stream access", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Admin Data Streams Org",
			billingEmail: "admin-data-streams@example.com",
			plan: "enterprise",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function patch(body: unknown) {
		return app.request(`/admin/organizations/${ORG_ID}/data-streams`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify(body),
		});
	}

	async function org() {
		const [row] = await db
			.select({
				dataStreamsEnabled: tables.organization.dataStreamsEnabled,
				requestLogExportEnabled: tables.organization.requestLogExportEnabled,
			})
			.from(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		return row;
	}

	test("opens data streams per organization and audits the change", async () => {
		expect(await org()).toEqual({
			dataStreamsEnabled: false,
			requestLogExportEnabled: false,
		});

		const opened = await patch({
			dataStreamsEnabled: true,
			requestLogExportEnabled: true,
		});
		expect(opened.status).toBe(200);
		expect(await org()).toEqual({
			dataStreamsEnabled: true,
			requestLogExportEnabled: true,
		});

		// Request log export cannot stay on without data streams.
		const closed = await patch({
			dataStreamsEnabled: false,
			requestLogExportEnabled: true,
		});
		expect((await closed.json()).requestLogExportEnabled).toBe(false);
		expect(await org()).toEqual({
			dataStreamsEnabled: false,
			requestLogExportEnabled: false,
		});

		const audits = await db.query.auditLog.findMany({
			where: {
				organizationId: ORG_ID,
				action: "data_stream.settings_update",
			},
		});
		expect(audits).toHaveLength(2);
	});

	test("rejects unknown organizations", async () => {
		const res = await app.request("/admin/organizations/nope/data-streams", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({
				dataStreamsEnabled: true,
				requestLogExportEnabled: false,
			}),
		});
		expect(res.status).toBe(404);
	});
});
