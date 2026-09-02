import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { airsideListingToModelDefinition } from "./chat/tools/resolve-airside-model.js";
import { findAirsideModel } from "./lib/cached-queries.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "./test-utils/test-helpers.js";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

interface CapturedRequest {
	url: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
}

/**
 * Airside carrier listings are routable from their canonical
 * model_provider_mapping rows and billed at the materialized prices. These
 * tests stand up a mock OpenAI-compatible upstream and point the carrier's
 * provider key at it.
 */
describe("airside-listed models", () => {
	createGatewayApiTestHarness();

	let upstream: Server;
	let upstreamUrl = "";
	let captured: CapturedRequest[] = [];

	beforeAll(async () => {
		upstream = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
				captured.push({
					url: req.url ?? "",
					headers: req.headers,
					body: parsed,
				});
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "chatcmpl-luna-1",
						object: "chat.completion",
						model: "gpt-5.6-luna",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "Hello from Luna" },
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: 1000,
							completion_tokens: 500,
							total_tokens: 1500,
						},
					}),
				);
			});
		});
		upstreamUrl = await new Promise<string>((resolve) => {
			upstream.listen(0, () => {
				const address = upstream.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			upstream.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function materializeTestMapping(options: {
		providerId: string;
		modelId: string;
		inputPrice: string;
		outputPrice: string;
		externalId?: string;
		providerName?: string;
		modelName?: string;
		contextSize?: number;
		maxOutput?: number;
		tools?: boolean;
	}) {
		await db
			.insert(tables.provider)
			.values({
				id: options.providerId,
				name: options.providerName ?? options.providerId,
				description: "",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.model)
			.values({
				id: options.modelId,
				name: options.modelName ?? options.modelId,
				family: options.providerId,
			})
			.onConflictDoNothing();
		const mappingValues = {
			externalId: options.externalId ?? options.modelId,
			source: "airside" as const,
			inputPrice: options.inputPrice,
			outputPrice: options.outputPrice,
			contextSize: options.contextSize ?? null,
			maxOutput: options.maxOutput ?? null,
			streaming: true,
			tools: options.tools ?? false,
			status: "active" as const,
			deactivatedAt: null,
		};
		const existing = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: options.modelId },
				providerId: { eq: options.providerId },
				region: { isNull: true },
			},
		});
		if (existing) {
			await db
				.update(tables.modelProviderMapping)
				.set(mappingValues)
				.where(eq(tables.modelProviderMapping.id, existing.id));
		} else {
			await db.insert(tables.modelProviderMapping).values({
				modelId: options.modelId,
				providerId: options.providerId,
				...mappingValues,
			});
		}
		await clearCache();
	}

	test("retains static-only metadata on imported mappings", async () => {
		await materializeTestMapping({
			providerId: "anthropic",
			modelId: "claude-fable-5-1",
			externalId: "claude-fable-5-1",
			inputPrice: "10e-6",
			outputPrice: "50e-6",
		});
		const listed = await findAirsideModel("anthropic", "claude-fable-5-1");
		expect(listed).toBeTruthy();

		const { mapping } = airsideListingToModelDefinition(listed!);
		expect(mapping).toMatchObject({
			cacheWriteInputPrice: "12.5e-6",
			cacheWriteInputPrice1h: "20.0e-6",
			minCacheableTokens: 512,
			reasoningMode: "adaptive",
			supportedParameters: ["max_tokens", "effort"],
		});
	});

	async function setup(
		token: string,
		options: {
			modelStatus?: "active" | "draft" | "delisted";
			filingStatus?: "approved" | "pending";
			modelName?: string;
			maxOutput?: number;
		} = {},
	) {
		const modelName = options.modelName ?? "gpt-5.6-luna";
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Airside test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `${token}-mistral-key`,
			...encryptProviderKeyForStorage(
				"mock-mistral-key",
				`${token}-mistral-key`,
				"org-id",
			),
			provider: "mistral",
			organizationId: "org-id",
			baseUrl: upstreamUrl,
		});
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Mistral AI",
		});
		await db.insert(tables.providerDraftModel).values({
			id: `${token}-model`,
			providerCompanyId: `${token}-company`,
			providerId: "mistral",
			externalId: modelName,
			modelName,
			displayName: "GPT 5.6 Luna",
			contextSize: 128000,
			streaming: true,
			tools: true,
			status: options.modelStatus ?? "active",
		});
		await db.insert(tables.providerPriceFiling).values({
			id: `${token}-filing`,
			draftModelId: `${token}-model`,
			providerCompanyId: `${token}-company`,
			kind: "initial",
			inputPrice: "2e-6",
			outputPrice: "1e-5",
			status: options.filingStatus ?? "approved",
		});
		if (
			(options.modelStatus ?? "active") === "active" &&
			(options.filingStatus ?? "approved") === "approved"
		) {
			await materializeTestMapping({
				providerId: "mistral",
				modelId: modelName,
				inputPrice: "2e-6",
				outputPrice: "1e-5",
				providerName: "Mistral AI",
				modelName: "GPT 5.6 Luna",
				contextSize: 128000,
				maxOutput: options.maxOutput,
				tools: true,
			});
		} else {
			const materializedMapping = await db.query.modelProviderMapping.findFirst(
				{
					where: {
						modelId: { eq: modelName },
						providerId: { eq: "mistral" },
						region: { isNull: true },
						source: { eq: "airside" },
					},
				},
			);
			if (materializedMapping) {
				await db
					.delete(tables.modelProviderMapping)
					.where(eq(tables.modelProviderMapping.id, materializedMapping.id));
			}
			await clearCache();
		}
	}

	test("routes an approved listing and bills the filed prices", async () => {
		await setup("airside-luna-token");
		const requestId = "airside-luna-req-1";

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-luna-token",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: { message: { content: string } }[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(json.choices[0].message.content).toBe("Hello from Luna");
		expect(json.usage.prompt_tokens).toBe(1000);

		// The upstream got a plain OpenAI-compatible call with the bare model id.
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/v1/chat/completions");
		expect(captured[0].body.model).toBe("gpt-5.6-luna");
		expect(captured[0].headers.authorization).toBe("Bearer mock-mistral-key");

		// The log attributes the traffic to the carrier and bills the filing.
		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("mistral");
		expect(log!.usedModel).toBe("mistral/gpt-5.6-luna");
		// 1000 tokens at $2/M in + 500 tokens at $10/M out.
		expect(Number(log!.inputCost)).toBeCloseTo(0.002, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.005, 6);
		expect(Number(log!.cost)).toBeCloseTo(0.007, 6);
	});

	test("lists the approved listing in /v1/models", async () => {
		await setup("airside-v1models-token");
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as { data: { id: string }[] };
		expect(data.some((m) => m.id === "gpt-5.6-luna")).toBe(true);

		const mappedRes = await app.request("/v1/models?mapped=true");
		const mapped = (await mappedRes.json()) as { data: { id: string }[] };
		expect(mapped.data.some((m) => m.id === "mistral/gpt-5.6-luna")).toBe(true);
	});

	test("does not route a listing that is still drafted", async () => {
		await setup("airside-draft-token", {
			modelStatus: "draft",
			filingStatus: "pending",
		});
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-draft-token",
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("does not route a delisted model", async () => {
		await setup("airside-delisted-token", { modelStatus: "delisted" });
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-delisted-token",
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("an active listing overrides the static catalogue mapping", async () => {
		// The catalogue-to-DB migration switch: a carrier imports its catalogue
		// models, and from then on its listing — not the hardcoded mapping —
		// serves and prices the pair, so the mapping can be retired later
		// without a routing gap.
		const token = "airside-override-token";
		await setup(token, { modelName: "mistral-small-2506" });
		await clearCache();

		const requestId = "airside-override-req-1";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "mistral/mistral-small-2506",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		expect(captured).toHaveLength(1);
		expect(captured[0].body.model).toBe("mistral-small-2506");

		// Billed at the filing ($2/M in, $10/M out), not the catalogue mapping's
		// $0.1/M and $0.3/M.
		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(Number(log!.inputCost)).toBeCloseTo(0.002, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.005, 6);
	});

	test("validates requests against the carrier's canonical mapping", async () => {
		// The static mapping has no maxOutput; the carrier's row does, and it
		// is the one /v1/models advertises, so it must be the one enforced.
		const token = "airside-limits-token";
		await setup(token, { modelName: "mistral-small-2506", maxOutput: 1000 });
		await clearCache();

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "mistral-small-2506",
				max_tokens: 2000,
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("(1000)");
		expect(captured).toHaveLength(0);
	});

	test("bills an Airside-owned pair reached through a dynamic route", async () => {
		// Dynamic routes (like auto and cross-model fallback) pick their target
		// from the static catalogue; the served pair is still Airside-owned.
		const token = "airside-dynamic-token";
		await setup(token, { modelName: "mistral-small-2506" });
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));
		const graph = {
			entry: "m",
			nodes: [
				{
					id: "m",
					type: "model" as const,
					model: "mistral-small-2506",
					providers: ["mistral"],
				},
			],
		} as DynamicRouteGraph;
		await db.insert(tables.dynamicRoute).values({
			id: `${token}-route`,
			projectId: "project-id",
			name: "airside-owned",
			enabled: true,
			draftGraph: graph,
		});
		await db.insert(tables.dynamicRouteVersion).values({
			id: `${token}-route-v1`,
			routeId: `${token}-route`,
			version: 1,
			graph,
		});
		await db
			.update(tables.dynamicRoute)
			.set({ publishedVersionId: `${token}-route-v1` })
			.where(eq(tables.dynamicRoute.id, `${token}-route`));
		await clearCache();

		const requestId = "airside-dynamic-req-1";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "dynamic/airside-owned",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		expect(captured).toHaveLength(1);
		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(Number(log!.inputCost)).toBeCloseTo(0.002, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.005, 6);
	});

	async function setRoutingUptime(
		modelId: string,
		providerId: string,
		uptimePercent: number,
	) {
		// Routing reads uptime from recent credits-mode history rows.
		const totalRequests = 100;
		const uptimeFraction = uptimePercent / 100;
		const errorsCount = Math.round(totalRequests * (1 - uptimeFraction));
		await db.insert(tables.modelProviderMappingHistory).values({
			modelId,
			providerId,
			modelProviderMappingId: `${modelId}::${providerId}`,
			usedMode: "credits",
			minuteTimestamp: new Date(Math.floor(Date.now() / 60000) * 60000),
			logsCount: totalRequests,
			errorsCount,
			clientErrorsCount: 0,
			gatewayErrorsCount: 0,
			upstreamErrorsCount: errorsCount,
			cachedCount: 0,
			totalOutputTokens: 100,
			totalDuration: 1000,
			totalTimeToFirstToken: 100 * totalRequests,
			totalTimeToFirstReasoningToken: 0,
			timeToFirstTokenCount: totalRequests,
			timeToFirstReasoningTokenCount: 0,
		});
	}

	test("bills an Airside-owned pair reached by cross-provider fallback", async () => {
		// A provider-pinned request only settles Airside ownership for the
		// pinned pair. When routing moves it to a sibling provider whose pair
		// is Airside-owned, the served request is billed at the filed prices.
		const token = "airside-fallback-token";
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Airside fallback test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values(
			(["deepinfra", "novita"] as const).map((provider) => ({
				id: `${token}-${provider}-key`,
				...encryptProviderKeyForStorage(
					`mock-${provider}-key`,
					`${token}-${provider}-key`,
					"org-id",
				),
				provider,
				organizationId: "org-id",
				baseUrl: upstreamUrl,
			})),
		);
		await setRoutingUptime("ling-3.0-flash", "deepinfra", 0);
		await setRoutingUptime("ling-3.0-flash", "novita", 100);
		await materializeTestMapping({
			providerId: "novita",
			modelId: "ling-3.0-flash",
			inputPrice: "2e-6",
			outputPrice: "1e-5",
			contextSize: 128000,
		});

		const requestId = "airside-fallback-req-1";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "deepinfra/ling-3.0-flash",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		expect(captured).toHaveLength(1);
		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("novita");
		expect(log!.routingMetadata?.selectionReason).toBe("low-uptime-fallback");
		expect(Number(log!.inputCost)).toBeCloseTo(0.002, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.005, 6);
	});

	async function setupCustomCarrier(
		token: string,
		options: { managedCredential?: boolean } = {},
	) {
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Airside custom carrier test key",
			createdBy: "user-id",
		});
		// Credits mode: custom carriers are served by the platform's managed
		// credential, never by org BYOK keys.
		await db
			.update(tables.project)
			.set({ mode: "credits" })
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Acme Sky",
		});
		await db.insert(tables.providerClaim).values({
			id: `${token}-claim`,
			providerCompanyId: `${token}-company`,
			providerId: "acme-sky",
			kind: "custom",
			matchedDomain: "acme-sky.ai",
			customName: "Acme Sky",
			customBaseUrl: upstreamUrl,
			status: "active",
		});
		await db.insert(tables.providerDraftModel).values({
			id: `${token}-model`,
			providerCompanyId: `${token}-company`,
			providerId: "acme-sky",
			modelName: "sky-large",
			externalId: "sky-large",
			displayName: "Sky Large",
			contextSize: 64000,
			streaming: true,
			status: "active",
		});
		await db.insert(tables.providerPriceFiling).values({
			id: `${token}-filing`,
			draftModelId: `${token}-model`,
			providerCompanyId: `${token}-company`,
			kind: "initial",
			inputPrice: "3e-6",
			outputPrice: "9e-6",
			status: "approved",
		});
		await materializeTestMapping({
			providerId: "acme-sky",
			modelId: "sky-large",
			inputPrice: "3e-6",
			outputPrice: "9e-6",
			providerName: "Acme Sky",
			modelName: "Sky Large",
			contextSize: 64000,
		});
		if (options.managedCredential !== false) {
			await db.insert(tables.providerKey).values({
				id: `${token}-managed-key`,
				managed: true,
				organizationId: null,
				provider: "acme-sky",
				...encryptProviderKeyForStorage(
					"mock-acme-key",
					`${token}-managed-key`,
					null,
				),
			});
		}
	}

	test("routes a custom carrier to its registered endpoint on the managed credential", async () => {
		await setupCustomCarrier("airside-custom-token");
		const requestId = "airside-custom-req-1";

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-custom-token",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "acme-sky/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: { message: { content: string } }[];
		};
		expect(json.choices[0].message.content).toBe("Hello from Luna");

		// The claim's base URL got a plain OpenAI-compatible call, authorized
		// with the platform's managed credential for the carrier.
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/v1/chat/completions");
		expect(captured[0].body.model).toBe("sky-large");
		expect(captured[0].headers.authorization).toBe("Bearer mock-acme-key");

		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("acme-sky");
		expect(log!.usedModel).toBe("acme-sky/sky-large");
		// 1000 tokens at $3/M in + 500 tokens at $9/M out.
		expect(Number(log!.inputCost)).toBeCloseTo(0.003, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.0045, 6);

		// The bare id /v1/models advertises resolves too (unique listing).
		const bare = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-custom-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "sky-large",
				messages: [{ role: "user", content: "Say hi again" }],
			}),
		});
		expect(bare.status).toBe(200);
	});

	test("custom carrier without a managed credential fails with a clear error", async () => {
		await setupCustomCarrier("airside-nocred-token", {
			managedCredential: false,
		});
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-nocred-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "acme-sky/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: { message: string } };
		expect(json.error.message).toContain("No platform credential");
		expect(captured).toHaveLength(0);
	});

	test("a listing takes over a deactivated static-catalogue mapping", async () => {
		// nebius/llama-3.1-8b-instruct is a retired catalogue mapping
		// (deactivated, never deleted). Deactivation hands routing over to an
		// Airside listing — the catalogue -> DB migration switch.
		const token = "airside-takeover-token";
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Airside takeover test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `${token}-nebius-key`,
			...encryptProviderKeyForStorage(
				"mock-nebius-key",
				`${token}-nebius-key`,
				"org-id",
			),
			provider: "nebius",
			organizationId: "org-id",
			baseUrl: upstreamUrl,
		});
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Nebius Ops",
		});
		await db.insert(tables.providerDraftModel).values({
			id: `${token}-model`,
			providerCompanyId: `${token}-company`,
			providerId: "nebius",
			modelName: "llama-3.1-8b-instruct",
			externalId: "llama-3.1-8b-instruct",
			streaming: true,
			status: "active",
		});
		await db.insert(tables.providerPriceFiling).values({
			id: `${token}-filing`,
			draftModelId: `${token}-model`,
			providerCompanyId: `${token}-company`,
			kind: "initial",
			inputPrice: "1e-6",
			outputPrice: "4e-6",
			status: "approved",
		});
		await materializeTestMapping({
			providerId: "nebius",
			modelId: "llama-3.1-8b-instruct",
			inputPrice: "1e-6",
			outputPrice: "4e-6",
			providerName: "Nebius",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-takeover-token",
				"x-no-fallback": "true",
				"x-request-id": "airside-takeover-req-1",
			},
			body: JSON.stringify({
				model: "nebius/llama-3.1-8b-instruct",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(200);
		expect(captured).toHaveLength(1);
		expect(captured[0].body.model).toBe("llama-3.1-8b-instruct");

		const log = await waitForLogByRequestId("airside-takeover-req-1");
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("nebius");
		// Billed at the filing, not the retired static mapping's prices.
		expect(Number(log!.inputCost)).toBeCloseTo(0.001, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.002, 6);
	});

	test("merges listings with static models in /v1/models", async () => {
		captured = [];
		await clearCache();
		await db.insert(tables.providerCompany).values({
			id: "merge-company",
			name: "Merge Co",
		});
		// Airside-owned rows replace their provider mapping without duplicating
		// the static model entry.
		await db.insert(tables.providerDraftModel).values([
			{
				id: "merge-static-model",
				providerCompanyId: "merge-company",
				providerId: "mistral",
				modelName: "mistral-large-latest",
				externalId: "mistral-large-latest",
				streaming: true,
				status: "active",
			},
			{
				id: "merge-takeover-model",
				providerCompanyId: "merge-company",
				providerId: "nebius",
				modelName: "llama-3.1-8b-instruct",
				externalId: "llama-3.1-8b-instruct",
				streaming: true,
				status: "active",
			},
		]);
		await db.insert(tables.providerPriceFiling).values([
			{
				id: "merge-static-filing",
				draftModelId: "merge-static-model",
				providerCompanyId: "merge-company",
				kind: "initial",
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				status: "approved",
			},
			{
				id: "merge-takeover-filing",
				draftModelId: "merge-takeover-model",
				providerCompanyId: "merge-company",
				kind: "initial",
				inputPrice: "1e-6",
				outputPrice: "4e-6",
				status: "approved",
			},
		]);
		for (const [modelId, providerId, inputPrice, outputPrice] of [
			["mistral-large-latest", "mistral", "2e-6", "6e-6"],
			["llama-3.1-8b-instruct", "nebius", "1e-6", "4e-6"],
		] as const) {
			await materializeTestMapping({
				providerId,
				modelId,
				inputPrice,
				outputPrice,
			});
		}

		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as {
			data: { id: string }[];
		};
		expect(data.filter((m) => m.id === "mistral-large-latest")).toHaveLength(1);
		expect(data.filter((m) => m.id === "llama-3.1-8b-instruct")).toHaveLength(
			1,
		);

		// The takeover mapping is exposed on the merged entry.
		const mappedRes = await app.request("/v1/models?mapped=true");
		const mapped = (await mappedRes.json()) as { data: { id: string }[] };
		expect(
			mapped.data.some((m) => m.id === "nebius/llama-3.1-8b-instruct"),
		).toBe(true);
	});

	test("does not route an unregistered provider prefix", async () => {
		await setupCustomCarrier("airside-unknown-token");
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-unknown-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "nobody-here/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});
