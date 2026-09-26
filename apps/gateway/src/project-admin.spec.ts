import { describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { clearCache } from "./test-utils/test-helpers.js";

describe("project admin gateway access", () => {
	const harness = createGatewayApiTestHarness();

	test("enforces project grants on existing keys after a role change", async () => {
		await db.insert(tables.apiKey).values({
			id: "project-admin-key",
			...hashApiKeyForStorage("project-admin-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Project admin test",
		});
		await db.insert(tables.providerKey).values({
			id: "project-admin-provider-key",
			...encryptProviderKeyForStorage(
				"test-provider-key",
				"project-admin-provider-key",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		await db
			.update(tables.userOrganization)
			.set({ role: "project_admin" })
			.where(eq(tables.userOrganization.id, "user-org-id"));

		const completion = (prompt: string) =>
			app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer project-admin-token",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: prompt }],
				}),
			});

		const denied = await completion("No project grant");
		expect(denied.status).toBe(403);
		expect(JSON.stringify(await denied.json())).toContain("project");

		await db
			.insert(tables.userProject)
			.values({ userOrganizationId: "user-org-id", projectId: "project-id" });
		await clearCache();
		const allowed = await completion("Assigned project");
		expect(allowed.status).toBe(200);
		expect((await allowed.json()).choices[0].message.content).toBeTruthy();

		await db
			.delete(tables.userProject)
			.where(eq(tables.userProject.userOrganizationId, "user-org-id"));
		await clearCache();
		expect((await completion("Revoked project")).status).toBe(403);
	});
});
