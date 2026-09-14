import { afterEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import * as routingConfigLoader from "./lib/routing-config-loader.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("DevPass cached-workload price routing", () => {
	const harness = createGatewayApiTestHarness();
	const model = "deepseek-v4-flash";

	afterEach(async () => {
		vi.restoreAllMocks();
		await db
			.delete(tables.projectHourlyModelStats)
			.where(eq(tables.projectHourlyModelStats.projectId, "project-id"));
	});

	test.each([
		[false, 2000, "deepinfra", true, true],
		[false, 1, "deepinfra", true, true],
		[true, 2000, "fireworks", true, true],
		[true, 1, "fireworks", true, true],
		[false, 1, "deepinfra", false, true],
		[true, 1, "fireworks", false, true],
		[false, 1, "deepinfra", false, false],
	])(
		"routes with usage=%s, repetitions=%s, provider=%s, DevPass=%s, coding=%s",
		async (withUsage, repetitions, expected, devpass, coding) => {
			const resolveConfig = vi.spyOn(
				routingConfigLoader,
				"getResolvedRoutingConfig",
			);
			if (devpass) {
				await harness.setDevPlan({ devPlan: "pro" });
			}
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
					usedModel: `deepinfra/${model}`,
					usedProvider: "deepinfra",
					requestCount: 20,
					inputTokens: "20000",
					cachedTokens: "19900",
					outputTokens: "100",
				});
			}

			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token-cache-routing",
					"x-source": coding ? "opencode" : "api",
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
			const config = await resolveConfig.mock.results[0].value;
			expect(config.thresholds).toMatchObject({
				cacheHitRate: coding || devpass ? 0.9 : 0.1,
				cacheOutputRatio: coding || devpass ? 0.02 : 0.2,
			});
		},
	);
});
