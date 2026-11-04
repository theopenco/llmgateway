import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const configPaths = [
	"/v1/ai/config",
	"/v2/ai/config",
	"/v3/ai/config",
	"/v4/ai/config",
];
const privateMetadataPaths = ["/v1/key", "/v1/credits"];
const metadataPaths = [...privateMetadataPaths, ...configPaths];
const headers = {
	Authorization: "Bearer read-access-token",
	"X-Forwarded-For": "198.51.100.10",
};

describe("gateway authenticated reads", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(async () => {
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "read-access-key",
			...hashApiKeyForStorage("read-access-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Read access fixture",
		});
	});

	test.each(metadataPaths)(
		"%s rejects expired keys without enforcing spend caps",
		async (path) => {
			await db
				.update(tables.apiKey)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(tables.apiKey.id, "read-access-key"));
			const response = await app.request(path, { headers });
			expect(response.status, await response.text()).toBe(401);
		},
	);

	test.each(metadataPaths)("%s rejects a removed member", async (path) => {
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.userId, "user-id"));
		const response = await app.request(path, { headers });
		expect(response.status, await response.text()).toBe(403);
	});

	test.each(metadataPaths)(
		"%s rejects publishable principals",
		async (path) => {
			await db
				.update(tables.apiKey)
				.set({ keyType: "platform_publishable" })
				.where(eq(tables.apiKey.id, "read-access-key"));
			const response = await app.request(path, { headers });
			expect(response.status, await response.text()).toBe(403);
		},
	);

	test.each(metadataPaths)("%s rejects an archived project", async (path) => {
		await db
			.update(tables.project)
			.set({ status: "deleted" })
			.where(eq(tables.project.id, "project-id"));
		const response = await app.request(path, { headers });
		expect(response.status, await response.text()).toBe(410);
	});

	test.each(metadataPaths)(
		"%s still works after key quota is exhausted",
		async (path) => {
			await db
				.update(tables.apiKey)
				.set({ usage: "1", usageLimit: "1" })
				.where(eq(tables.apiKey.id, "read-access-key"));
			const response = await app.request(path, { headers });
			expect(response.status, await response.text()).toBe(200);
		},
	);

	test.each([
		...privateMetadataPaths,
		"/v1/responses/missing",
		"/v1/videos/missing",
		"/v1/videos/missing/content",
	])("%s enforces trusted-IP rules on private metadata", async (path) => {
		await db.insert(tables.apiKeyIamRule).values({
			id: "read-ip-rule",
			apiKeyId: "read-access-key",
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["192.0.2.0/24"] },
		});
		const response = await app.request(path, { headers });
		expect(response.status, await response.text()).toBe(403);
	});

	test.each(configPaths)(
		"%s filters discovery through organization provider and model restrictions",
		async (path) => {
			await db
				.update(tables.organization)
				.set({
					plan: "enterprise",
					providerCompliancePolicy: {
						enabled: true,
						allowedProviders: ["openai"],
						allowedModels: ["gpt-4o-mini"],
					},
				})
				.where(eq(tables.organization.id, "org-id"));

			const response = await app.request(path, { headers });
			expect(response.status).toBe(200);
			expect(
				(await response.json()).models.map((model: { id: string }) => model.id),
			).toEqual(["openai/gpt-4o-mini"]);
		},
	);

	test.each(configPaths)(
		"%s does not advertise models blocked by IAM",
		async (path) => {
			await db.insert(tables.apiKeyIamRule).values({
				id: "read-model-rule",
				apiKeyId: "read-access-key",
				ruleType: "allow_models",
				ruleValue: { models: ["not-an-allowed-model"] },
			});
			const response = await app.request(path, { headers });
			expect(response.status).toBe(200);
			expect((await response.json()).models).toEqual([]);
		},
	);
	test.each(["/v1/responses", "/v1/responses/compact"])(
		"%s authorizes IP before reading chained history",
		async (path) => {
			await db.insert(tables.apiKeyIamRule).values({
				id: "history-ip-rule",
				apiKeyId: "read-access-key",
				ruleType: "allow_ip_cidrs",
				ruleValue: { ipCidrs: ["192.0.2.0/24"] },
			});
			for (const input of [
				{ input: "Follow up", previous_response_id: "missing-response" },
				{ input: [{ type: "item_reference", id: "missing-item" }] },
			]) {
				const response = await app.request(path, {
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({
						model: "gpt-4o-mini",
						store: false,
						...input,
					}),
				});
				expect(response.status, await response.text()).toBe(403);
			}
		},
	);

	test.each(["/v1/credits", ...configPaths])(
		"%s preserves case-insensitive SDK bearer authentication",
		async (path) => {
			const response = await app.request(path, {
				headers: { Authorization: "bearer read-access-token" },
			});
			expect(response.status, await response.text()).toBe(200);
		},
	);
});
