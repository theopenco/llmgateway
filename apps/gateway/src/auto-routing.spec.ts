import { describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { isMappingDeactivated } from "@llmgateway/shared/deactivation";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { clearCache, waitForLogs } from "./test-utils/test-helpers.js";

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

	test("auto respects lax caps without turning a new session into an exemption", async () => {
		const token = await seed(["google-ai-studio"]);
		await db.insert(tables.rateLimit).values({
			id: "auto-lax",
			provider: "google-ai-studio",
			enforcement: "global",
			maxRpm: 1,
			mode: "lax",
		});
		const key =
			"rate_limit:provider_cap:rpm:__global__:google-ai-studio:__all_models__";
		for (const [turn, sessionId, status] of [
			[1, "ongoing-auto", 200],
			[2, "ongoing-auto", 200],
			[3, "new-auto", 429],
		] as const) {
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"x-session-id": sessionId,
				},
				body: JSON.stringify({
					model: "auto",
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: `Summarize this document, turn ${turn}` },
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
			expect(response.status).toBe(status);
			await response.text();
		}
		expect(await redisClient.zcard(key)).toBe(2);
	});

	test.each([
		["lax", 1],
		["lax", 0],
		["soft", 0],
		["strict", 0],
	] as const)(
		"auto skips a model exhausted by a %s cap of %s",
		async (mode, maxRpm) => {
			const token = await seed(["google-ai-studio"]);
			const send = (turn: number) =>
				app.request("/v1/chat/completions", {
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
									{
										type: "text",
										text: `Summarize this document, turn ${turn}`,
									},
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
			const first = await send(1);
			expect(first.status).toBe(200);
			await first.text();
			const [firstLog] = await waitForLogs(1);
			const cappedModel = firstLog
				.usedModel!.slice("google-ai-studio/".length)
				.split(":")[0];
			await db.insert(tables.rateLimit).values({
				id: "auto-model-cap",
				model: cappedModel,
				maxRpm,
				mode,
			});
			await clearCache();
			await redisClient.zadd(
				`rate_limit:provider_cap:rpm:org-id:google-ai-studio:${cappedModel}`,
				Date.now(),
				"seed",
			);
			const second = await send(2);
			expect(second.status).toBe(200);
			await second.text();
			const logs = await waitForLogs(2);
			expect(
				logs.some(
					(log) => log.usedModel && log.usedModel !== firstLog.usedModel,
				),
			).toBe(true);
		},
	);

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
