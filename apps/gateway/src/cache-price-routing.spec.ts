import { afterEach, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("DevPass cached-workload price routing", () => {
	const harness = createGatewayApiTestHarness();
	const model = "deepseek-v4-flash";

	afterEach(async () => {
		await db
			.delete(tables.projectHourlyModelStats)
			.where(eq(tables.projectHourlyModelStats.projectId, "project-id"));
	});

	test.each([
		[false, 2000, "deepinfra"],
		[true, 2000, "fireworks"],
		[true, 1, "fireworks"],
	])(
		"routes with usage=%s and prompt repetitions=%s",
		async (withUsage, repetitions, expected) => {
			await harness.setDevPlan({ devPlan: "pro" });
			await db
				.update(tables.organization)
				.set({ retentionLevel: "none" })
				.where(eq(tables.organization.id, "org-id"));
			await db
				.update(tables.project)
				.set({ defaultRoutingStrategy: "price" })
				.where(eq(tables.project.id, "project-id"));
			await db.insert(tables.apiKey).values({
				id: "token-id-cache-routing",
				...hashApiKeyForStorage("test-token-cache-routing"),
				projectId: "project-id",
				createdBy: "user-id",
				description: "Test API Key",
			});
			for (const provider of ["deepinfra", "fireworks"] as const) {
				const keyId = `provider-key-cache-routing-${provider}`;
				await db.insert(tables.providerKey).values({
					id: keyId,
					...encryptProviderKeyForStorage("sk-test-key", keyId, "org-id"),
					provider,
					organizationId: "org-id",
					baseUrl:
						provider === "deepinfra"
							? `${harness.mockServerUrl}/v1`
							: harness.mockServerUrl,
				});
				await harness.setRoutingMetrics(model, provider, { uptime: 100 });
			}
			if (withUsage) {
				await db.insert(tables.projectHourlyModelStats).values({
					projectId: "project-id",
					hourTimestamp: new Date(
						Math.floor(Date.now() / 3_600_000) * 3_600_000,
					),
					usedModel: model,
					usedProvider: "deepinfra",
					requestCount: 100,
					inputTokens: "10000000",
					cachedTokens: "9950000",
					outputTokens: "50000",
				});
			}

			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token-cache-routing",
					"x-source": "opencode",
					"x-session-id": "cache-routing-session",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "user", content: "Coding context. ".repeat(repetitions) },
					],
				}),
			});
			const json = await response.json();
			expect(response.status, JSON.stringify(json)).toBe(200);
			expect(json.metadata.routing[0].provider).toBe(expected);
		},
	);
});
