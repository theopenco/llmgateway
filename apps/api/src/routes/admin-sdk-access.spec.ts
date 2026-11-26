import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

describe("admin Payments SDK access", () => {
	let cookie: string;
	const orgId = "sdk-access-org";
	const projectId = "sdk-access-project";
	const path = `/admin/organizations/${orgId}/projects/${projectId}/payments-sdk`;

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		vi.stubEnv("ADMIN_EMAILS", "");
		vi.stubEnv("ADMIN_VIEWER_EMAILS", "");
		vi.stubEnv("ADMIN_SUPPORT_EMAILS", "");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "SDK Access Org",
			billingEmail: "sdk-access@example.com",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "SDK Access Project",
			organizationId: orgId,
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	function patch(enabled: unknown, url = path, authCookie = cookie) {
		return app.request(url, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: authCookie },
			body: JSON.stringify({ paymentsSdkEnabled: enabled }),
		});
	}

	test("unlocks setup without enabling sessions and audits changes", async () => {
		const read = () => app.request(path, { headers: { Cookie: cookie } });
		expect(await (await read()).json()).toEqual({ paymentsSdkEnabled: false });
		const settings = () =>
			app.request(`/projects/${projectId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Cookie: cookie },
				body: JSON.stringify({ endUserEnabled: true }),
			});
		const user = await db.query.user.findFirst({
			where: { email: "admin@example.com" },
		});
		await db
			.insert(tables.userOrganization)
			.values({ userId: user!.id, organizationId: orgId, role: "owner" });
		expect((await settings()).status).toBe(403);
		expect((await patch(true)).status).toBe(200);
		expect(
			(await db.query.project.findFirst({ where: { id: projectId } }))
				?.endUserEnabled,
		).toBe(false);
		expect(await (await read()).json()).toEqual({ paymentsSdkEnabled: true });
		expect((await settings()).status).toBe(200);
		expect((await patch(false)).status).toBe(200);
		expect((await settings()).status).toBe(403);
		const project = await db.query.project.findFirst({
			where: { id: projectId },
		});
		expect(project?.paymentsSdkEnabled).toBe(false);
		expect(project?.endUserEnabled).toBe(true);
		const audits = await db.query.auditLog.findMany({
			where: { organizationId: orgId, action: "project.update" },
		});
		expect(
			audits.filter((audit) =>
				Object.hasOwn(audit.metadata?.changes ?? {}, "paymentsSdkEnabled"),
			),
		).toHaveLength(2);
	});

	test("rejects cross-organization, deleted, and missing projects", async () => {
		expect((await patch(true, path.replace(orgId, "other-org"))).status).toBe(
			404,
		);
		expect((await patch(true, path.replace(projectId, "missing"))).status).toBe(
			404,
		);
		await db
			.update(tables.project)
			.set({ status: "deleted" })
			.where(eq(tables.project.id, projectId));
		expect((await patch(true)).status).toBe(404);
		expect(
			(await app.request(path, { headers: { Cookie: cookie } })).status,
		).toBe(404);
	});

	test("rejects deleted organizations", async () => {
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, orgId));
		expect((await patch(true)).status).toBe(404);
	});

	test("rejects unauthenticated and invalid writes", async () => {
		expect((await patch(true, path, "")).status).toBe(401);
		expect((await patch("true")).status).toBe(400);
	});

	test.each(["viewer", "support", "none"])(
		"blocks %s from approving setup",
		async (role) => {
			vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
			vi.stubEnv(
				"ADMIN_SUPPORT_EMAILS",
				role === "support" ? "admin@example.com" : "",
			);
			vi.stubEnv(
				"ADMIN_VIEWER_EMAILS",
				role === "viewer" ? "admin@example.com" : "",
			);
			expect((await patch(true)).status).toBe(403);
			const read = await app.request(path, { headers: { Cookie: cookie } });
			expect(read.status).toBe(role === "none" ? 403 : 200);
		},
	);
});
