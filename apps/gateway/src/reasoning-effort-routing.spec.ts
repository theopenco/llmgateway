import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "./test-utils/test-helpers.js";

import type { ReasoningEffort } from "@llmgateway/models";
import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

const restrictedEfforts: ReasoningEffort[] = ["high", "max"];
const capableEfforts: ReasoningEffort[] = [
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
const restrictedProvider = "effort-restricted";
const capableProvider = "effort-capable";

const fallbackProvider = "effort-fallback";

describe("reasoning-effort provider routing", () => {
	const harness = createGatewayApiTestHarness();
	let upstream: Server;
	let failingProvider = "";
	let upstreamUrl = "";
	let captured: Array<{ provider: string; effort: unknown }> = [];

	beforeAll(async () => {
		upstream = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				const parsed = JSON.parse(body) as {
					model: string;
					reasoning_effort?: ReasoningEffort;
					stream?: boolean;
				};
				const provider = req.url?.split("/")[1] ?? "";
				captured.push({ provider, effort: parsed.reasoning_effort });
				if (provider === failingProvider) {
					res.writeHead(503, { "content-type": "application/json" });
					res.end(
						JSON.stringify({ error: { message: "Service unavailable" } }),
					);
					return;
				}
				const supported =
					provider === restrictedProvider ? restrictedEfforts : capableEfforts;
				if (
					parsed.reasoning_effort !== undefined &&
					!supported.includes(parsed.reasoning_effort)
				) {
					res.writeHead(400, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							error: { message: "Unsupported reasoning_effort" },
						}),
					);
					return;
				}
				if (parsed.stream) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					res.end(
						`data: ${JSON.stringify({ id: "effort-stream", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "effort-stream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`,
					);
					return;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "effort-completion",
						object: "chat.completion",
						model: parsed.model,
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "Hello" },
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 2,
							total_tokens: 12,
						},
					}),
				);
			});
		});
		await new Promise<void>((resolve) =>
			upstream.listen(0, "127.0.0.1", resolve),
		);
		const address = upstream.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing upstream address");
		}
		upstreamUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			upstream.close((error) => (error ? reject(error) : resolve())),
		);
	});

	async function setup(
		modelId = "deepseek-v4.1-flash-1017",
		devpass = false,
		withFallback = false,
	) {
		captured = [];
		failingProvider = "";
		await harness.setProjectMode("credits");
		if (devpass) {
			await harness.setDevPlan({ devPlan: "max" });
		}
		await db.insert(tables.apiKey).values({
			id: "effort-key",
			...hashApiKeyForStorage("effort-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Reasoning effort test",
		});
		await db.insert(tables.apiKeyIamRule).values({
			apiKeyId: "effort-key",
			ruleType: "allow_providers",
			ruleValue: {
				providers: [
					restrictedProvider,
					capableProvider,
					fallbackProvider,
					"llmgateway",
				],
			},
			status: "active",
		});
		await db
			.insert(tables.model)
			.values({ id: modelId, name: "Reasoning test model", family: "test" })
			.onConflictDoNothing();
		for (const [providerId, efforts, price] of [
			[restrictedProvider, restrictedEfforts, "0.01e-6"],
			[capableProvider, capableEfforts, "10e-6"],
			...(withFallback
				? [[fallbackProvider, capableEfforts, "20e-6"] as const]
				: []),
		] as const) {
			await db
				.insert(tables.provider)
				.values({
					id: providerId,
					name: providerId,
					description: "Test carrier",
				})
				.onConflictDoNothing();
			await db
				.insert(tables.providerCompany)
				.values({ id: providerId, name: "Test carrier" });
			await db.insert(tables.providerClaim).values({
				id: providerId,
				providerCompanyId: providerId,
				providerId,
				kind: "custom",
				matchedDomain: "example.com",
				customName: providerId,
				customBaseUrl: `${upstreamUrl}/${providerId}`,
				status: "active",
			});
			await db.insert(tables.providerDraftModel).values({
				id: providerId,
				providerCompanyId: providerId,
				providerId,
				modelName: modelId,
				externalId: modelId,
				apiFormat: "openai-chat-completions",
				reasoning: true,
				reasoningEfforts: efforts,
				contextSize: 1050000,
				streaming: true,
				status: "active",
			});
			await db.insert(tables.providerPriceFiling).values({
				id: providerId,
				draftModelId: providerId,
				providerCompanyId: providerId,
				kind: "initial",
				inputPrice: price,
				outputPrice: price,
				cachedInputPrice: price,
				status: "approved",
			});
			await db.insert(tables.modelProviderMapping).values({
				modelId,
				providerId,
				externalId: modelId,
				apiFormat: "openai-chat-completions",
				source: "airside",
				reasoning: true,
				reasoningEfforts: efforts,
				contextSize: 1050000,
				streaming: true,
				inputPrice: price,
				outputPrice: price,
				cachedInputPrice: price,
				status: "active",
			});
			await db.insert(tables.providerKey).values({
				id: providerId,
				managed: true,
				organizationId: null,
				provider: providerId,
				variant: devpass ? "plans" : "default",
				...encryptProviderKeyForStorage("mock-effort-key", providerId, null),
			});
			await harness.setRoutingMetrics(modelId, providerId, { uptime: 100 });
		}
		await clearCache();
	}

	async function request(
		model: string,
		effort: ReasoningEffort,
		options: {
			stream?: boolean;
			nested?: boolean;
			session?: string;
			requestId?: string;
		} = {},
	) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer effort-token",
				"x-request-id": options.requestId ?? "effort-request",
				...(options.session ? { "x-session-id": options.session } : {}),
			},
			body: JSON.stringify({
				model,
				stream: options.stream,
				...(options.nested
					? { reasoning: { effort } }
					: { reasoning_effort: effort }),
				messages: [{ role: "user", content: `Say hello at ${effort} effort` }],
			}),
		});
	}

	test.each(["bare", "auto", "smart", "dynamic"])(
		"excludes an incompatible cheaper carrier during %s routing",
		async (mode) => {
			const modelId =
				mode === "auto" ? "claude-haiku-4-5" : "deepseek-v4.1-flash-1017";
			await setup(modelId);
			if (mode === "smart") {
				await db
					.update(tables.project)
					.set({
						smartRoutingConfig: { classifier: "none", models: [modelId] },
					})
					.where(eq(tables.project.id, "project-id"));
			}
			if (mode === "dynamic") {
				await harness.setOrganizationPlan("enterprise");
				const graph: DynamicRouteGraph = {
					entry: "model",
					nodes: [
						{
							id: "model",
							type: "model",
							model: modelId,
							providers: [restrictedProvider, capableProvider],
						},
					],
				};
				await db.insert(tables.dynamicRoute).values({
					id: "effort-route",
					projectId: "project-id",
					name: "effort-route",
					enabled: true,
					draftGraph: graph,
				});
				await db.insert(tables.dynamicRouteVersion).values({
					id: "effort-version",
					routeId: "effort-route",
					version: 1,
					graph,
				});
				await db
					.update(tables.dynamicRoute)
					.set({ publishedVersionId: "effort-version" })
					.where(eq(tables.dynamicRoute.id, "effort-route"));
			}
			await clearCache();
			const res = await request(
				mode === "bare"
					? modelId
					: mode === "dynamic"
						? "dynamic/effort-route"
						: mode,
				"medium",
				{ nested: mode === "smart" },
			);
			expect(res.status, await res.text()).toBe(200);
			expect(captured).toEqual([
				{ provider: capableProvider, effort: "medium" },
			]);
			const log = await waitForLogByRequestId("effort-request");
			expect(log?.usedProvider).toBe(capableProvider);
			expect(log?.routingMetadata?.filteredProviders).toContainEqual(
				expect.objectContaining({
					providerId: restrictedProvider,
					codes: expect.arrayContaining(["reasoning_effort"]),
				}),
			);
			expect(
				log?.routingMetadata?.providerScores?.some(
					(score) => score.providerId === restrictedProvider,
				),
			).not.toBe(true);
		},
	);

	test("honours the effort on DevPass provider selection", async () => {
		await setup(undefined, true);
		const res = await request("deepseek-v4.1-flash-1017", "medium");
		expect(res.status, await res.text()).toBe(200);
		expect(captured).toEqual([{ provider: capableProvider, effort: "medium" }]);
	});

	test("skips always-thinking mappings for none", async () => {
		await setup();
		const res = await request("deepseek-v4.1-flash-1017", "none");
		expect(res.status, await res.text()).toBe(200);
		expect(captured).toHaveLength(1);
		expect(captured[0].provider).toBe(capableProvider);
	});

	test("does not keep a session on a provider that cannot serve the new effort", async () => {
		await setup();
		const first = await request(
			`${restrictedProvider}/deepseek-v4.1-flash-1017`,
			"high",
			{ session: "effort-session", requestId: "effort-first" },
		);
		expect(first.status, await first.text()).toBe(200);
		expect(captured[0].provider).toBe(restrictedProvider);
		const second = await request("deepseek-v4.1-flash-1017", "medium", {
			session: "effort-session",
		});
		expect(second.status, await second.text()).toBe(200);
		expect(captured).toEqual([
			{ provider: restrictedProvider, effort: "high" },
			{ provider: capableProvider, effort: "medium" },
		]);
	});

	test("fails before contacting an upstream when no carrier accepts the effort", async () => {
		await setup();
		await db
			.update(tables.modelProviderMapping)
			.set({ reasoningEfforts: ["high"] })
			.where(eq(tables.modelProviderMapping.providerId, capableProvider));
		await clearCache();
		const res = await request("deepseek-v4.1-flash-1017", "medium");
		expect(res.status, await res.text()).toBe(400);
		expect(captured).toEqual([]);
	});

	test("keeps streaming requests on an effort-compatible carrier", async () => {
		await setup();
		const res = await request("deepseek-v4.1-flash-1017", "medium", {
			stream: true,
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("[DONE]");
		expect(captured).toEqual([{ provider: capableProvider, effort: "medium" }]);
	});

	test("does not retry an incompatible carrier after an upstream failure", async () => {
		await setup(undefined, false, true);
		failingProvider = capableProvider;
		const res = await request("deepseek-v4.1-flash-1017", "medium");
		expect(res.status, await res.text()).toBe(200);
		expect(captured.map(({ provider }) => provider)).toEqual([
			capableProvider,
			fallbackProvider,
		]);
		expect(captured.every(({ effort }) => effort === "medium")).toBe(true);
	});
});
