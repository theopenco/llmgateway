import { describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { isMappingDeactivated } from "@llmgateway/shared/deactivation";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("auto routing", () => {
	const harness = createGatewayApiTestHarness();

	async function seed(providers: string[]) {
		await db.insert(tables.apiKey).values({
			id: "token-auto",
			...hashApiKeyForStorage("real-token-auto"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values(
			providers.map((provider) => ({
				id: `pk-auto-${provider}`,
				...encryptProviderKeyForStorage(
					`sk-${provider}-test-key`,
					`pk-auto-${provider}`,
					"org-id",
				),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			})),
		);
		return "real-token-auto";
	}

	test("a document request never selects a deactivated mapping", async () => {
		// Documents widen auto to the whole catalogue, where retired Gemini 1.5
		// mappings used to win on price and 404 upstream.
		const token = await seed(["google-ai-studio"]);

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "auto",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "Summarize this document" },
							{
								type: "file",
								file: {
									filename: "doc.pdf",
									file_data: "data:application/pdf;base64,JVBERi0xLjQK",
								},
							},
						],
					},
				],
			}),
		});
		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const usedProvider = logs[0]?.usedProvider;
		const usedModel = models.find(
			(model) => logs[0]?.usedModel === `${usedProvider}/${model.id}`,
		);
		const mapping = (
			usedModel?.providers as ProviderModelMapping[] | undefined
		)?.find((provider) => provider.providerId === usedProvider);
		expect(mapping?.document).toBe(true);
		expect(isMappingDeactivated(mapping!)).toBe(false);
	});
});
