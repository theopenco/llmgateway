import { beforeAll, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

// Request-path integration tests for named dynamic routes: enterprise gating,
// route lookup, graph evaluation against real request context, the handoff
// into provider selection (including provider restriction), and the recorded
// routing metadata. The pure evaluator and graph schema have their own unit
// suite in chat/tools/evaluate-dynamic-route.spec.ts.
describe("dynamic routes request path", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	async function seedBase(suffix: string, providers: string[] = ["openai"]) {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: `token-dyn-${suffix}`,
			token: `real-token-dyn-${suffix}`,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		if (providers.length > 0) {
			await db.insert(tables.providerKey).values(
				providers.map((provider) => ({
					id: `pk-dyn-${provider}-${suffix}`,
					token: `sk-${provider}-test-key`,
					provider,
					organizationId: "org-id",
					baseUrl: mockServerUrl,
					// Azure requests must stay on the mock server's /openai/v1/*
					// aliases regardless of local LLM_AZURE_DEPLOYMENT_TYPE values.
					...(provider === "azure"
						? { options: { azure_deployment_type: "ai-foundry" as const } }
						: {}),
				})),
			);
		}

		return `real-token-dyn-${suffix}`;
	}

	async function seedRoute(
		suffix: string,
		graph: DynamicRouteGraph,
		{ enabled = true, published = true } = {},
	) {
		await db.insert(tables.dynamicRoute).values({
			id: `dr-${suffix}`,
			projectId: "project-id",
			name: `route-${suffix}`,
			enabled,
			draftGraph: graph,
		});
		if (published) {
			await db.insert(tables.dynamicRouteVersion).values({
				id: `drv-${suffix}`,
				routeId: `dr-${suffix}`,
				version: 1,
				graph,
			});
			await db
				.update(tables.dynamicRoute)
				.set({ publishedVersionId: `drv-${suffix}` })
				.where(eq(tables.dynamicRoute.id, `dr-${suffix}`));
		}
		return `route-${suffix}`;
	}

	async function chatCompletion(
		token: string,
		body: Record<string, unknown>,
		headers: Record<string, string> = {},
	) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	function modelNode(id: string, model: string, providers?: string[]) {
		return { id, type: "model" as const, model, providers };
	}

	test("requires the enterprise plan", async () => {
		const token = await seedBase("plan");
		const routeName = await seedRoute("plan", {
			entry: "m",
			nodes: [modelNode("m", "gpt-4o-mini")],
		} as DynamicRouteGraph);
		// Harness seeds the org on the pro plan; undo the enterprise upgrade.
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, "org-id"));

		const res = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi plan" }],
		});
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error.message).toContain("enterprise");
	});

	test("404s for unknown, disabled, and unpublished routes", async () => {
		const token = await seedBase("missing");
		const disabled = await seedRoute(
			"missing-disabled",
			{
				entry: "m",
				nodes: [modelNode("m", "gpt-4o-mini")],
			} as DynamicRouteGraph,
			{ enabled: false },
		);
		const unpublished = await seedRoute(
			"missing-unpublished",
			{
				entry: "m",
				nodes: [modelNode("m", "gpt-4o-mini")],
			} as DynamicRouteGraph,
			{ published: false },
		);

		for (const name of ["does-not-exist", disabled, unpublished]) {
			const res = await chatCompletion(token, {
				model: `dynamic/${name}`,
				messages: [{ role: "user", content: `hi ${name}` }],
			});
			expect(res.status).toBe(404);
		}
	});

	test("conditional header match picks the branch and records metadata", async () => {
		const token = await seedBase("cond");
		const routeName = await seedRoute("cond", {
			entry: "tier",
			nodes: [
				{
					id: "tier",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-user-tier" },
							op: "eq",
							value: "paid",
							next: "premium",
						},
					],
					else: "basic",
				},
				modelNode("premium", "gpt-4o-mini"),
				modelNode("basic", "gpt-5-nano"),
			],
		} as DynamicRouteGraph);

		const premium = await chatCompletion(
			token,
			{
				model: `dynamic/${routeName}`,
				messages: [{ role: "user", content: "hi cond premium" }],
			},
			{ "x-user-tier": "paid" },
		);
		expect(premium.status).toBe(200);
		const premiumJson = await premium.json();
		expect(premiumJson.metadata.used_model).toBe("gpt-4o-mini");
		expect(premiumJson.metadata.requested_model).toBe(`dynamic/${routeName}`);

		const basic = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi cond basic" }],
		});
		expect(basic.status).toBe(200);
		expect((await basic.json()).metadata.used_model).toBe("gpt-5-nano");

		// The log's routing metadata records the route and the evaluation path.
		await waitForLogs(2);
		const logs = await db.query.log.findMany({});
		const premiumLog = logs.find((l) => l.usedModel.includes("gpt-4o-mini"));
		const dynamicRouteMeta = (
			premiumLog?.routingMetadata as {
				dynamicRoute?: { name: string; version: number; path: string[] };
			} | null
		)?.dynamicRoute;
		expect(dynamicRouteMeta).toMatchObject({
			name: routeName,
			version: 1,
			path: ["tier", "premium"],
		});
	});

	test("body conditions read the raw request body, not the stripped copy", async () => {
		const token = await seedBase("body");
		const routeName = await seedRoute("body", {
			entry: "seg",
			nodes: [
				{
					id: "seg",
					type: "conditional",
					conditions: [
						{
							// "metadata" is NOT part of the completions schema, so this
							// only works when evaluation sees the raw body.
							field: { source: "body", path: "metadata.segment" },
							op: "eq",
							value: "beta",
							next: "beta",
						},
					],
					else: "stable",
				},
				modelNode("beta", "gpt-4o-mini"),
				modelNode("stable", "gpt-5-nano"),
			],
		} as DynamicRouteGraph);

		const beta = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi body beta" }],
			metadata: { segment: "beta" },
		});
		expect(beta.status).toBe(200);
		expect((await beta.json()).metadata.used_model).toBe("gpt-4o-mini");

		const stable = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi body stable" }],
		});
		expect(stable.status).toBe(200);
		expect((await stable.json()).metadata.used_model).toBe("gpt-5-nano");
	});

	test("model-node provider restriction overrides natural routing", async () => {
		const token = await seedBase("restrict", ["openai", "azure"]);
		// gpt-5.5 is served by openai and azure; azure is the natural routing
		// winner (see session-sticky.spec.ts), so landing on openai proves the
		// route's provider restriction narrowed the candidates.
		const unrestricted = await seedRoute("restrict-none", {
			entry: "m",
			nodes: [modelNode("m", "gpt-5.5")],
		} as DynamicRouteGraph);
		const restricted = await seedRoute("restrict-openai", {
			entry: "m",
			nodes: [modelNode("m", "gpt-5.5", ["openai"])],
		} as DynamicRouteGraph);

		const natural = await chatCompletion(token, {
			model: `dynamic/${unrestricted}`,
			messages: [{ role: "user", content: "hi restrict natural" }],
		});
		expect(natural.status).toBe(200);
		expect((await natural.json()).metadata.used_provider).toBe("azure");

		const pinned = await chatCompletion(token, {
			model: `dynamic/${restricted}`,
			messages: [{ role: "user", content: "hi restrict pinned" }],
		});
		expect(pinned.status).toBe(200);
		expect((await pinned.json()).metadata.used_provider).toBe("openai");
	});

	test("routes to a custom-provider catalog model", async () => {
		const token = await seedBase("custom", []);
		await db.insert(tables.providerKey).values({
			id: "pk-dyn-custom",
			token: "sk-custom-test-key",
			provider: "custom",
			name: "private-provider",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		await db.insert(tables.customModel).values({
			id: "cm-dyn-custom",
			providerKeyId: "pk-dyn-custom",
			organizationId: "org-id",
			modelName: "private-model:revision",
			inputPrice: "1e-6",
			outputPrice: "2e-6",
		});
		const routeName = await seedRoute("custom", {
			entry: "m",
			nodes: [modelNode("m", "private-provider/private-model:revision")],
		} as DynamicRouteGraph);

		const response = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi custom dynamic route" }],
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.metadata).toMatchObject({
			requested_model: `dynamic/${routeName}`,
			used_model: "private-model:revision",
			used_provider: "custom",
		});

		await waitForLogs(1);
		const log = await db.query.log.findFirst({});
		expect(
			(
				log?.routingMetadata as {
					dynamicRoute?: { name: string; path: string[] };
				} | null
			)?.dynamicRoute,
		).toMatchObject({ name: routeName, path: ["m"] });
	});

	test("percentage splits stay sticky per session", async () => {
		const token = await seedBase("split");
		const routeName = await seedRoute("split", {
			entry: "p",
			nodes: [
				{
					id: "p",
					type: "percentage",
					splits: [
						{ weight: 50, next: "a" },
						{ weight: 50, next: "b" },
					],
				},
				modelNode("a", "gpt-4o-mini"),
				modelNode("b", "gpt-5-nano"),
			],
		} as DynamicRouteGraph);

		const first = await chatCompletion(
			token,
			{
				model: `dynamic/${routeName}`,
				messages: [{ role: "user", content: "hi split one" }],
			},
			{ "x-session-id": "split-session-1" },
		);
		expect(first.status).toBe(200);
		const firstModel = (await first.json()).metadata.used_model;

		const second = await chatCompletion(
			token,
			{
				model: `dynamic/${routeName}`,
				messages: [{ role: "user", content: "hi split two" }],
			},
			{ "x-session-id": "split-session-1" },
		);
		expect(second.status).toBe(200);
		expect((await second.json()).metadata.used_model).toBe(firstModel);
	});

	test("end nodes reject the request with 400", async () => {
		const token = await seedBase("end");
		const routeName = await seedRoute("end", {
			entry: "gate",
			nodes: [
				{
					id: "gate",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-allowed" },
							op: "exists",
							next: "m",
						},
					],
					else: "reject",
				},
				modelNode("m", "gpt-4o-mini"),
				{ id: "reject", type: "end" },
			],
		} as DynamicRouteGraph);

		const rejected = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi end" }],
		});
		expect(rejected.status).toBe(400);
		const json = await rejected.json();
		expect(json.error.message).toContain("ended without resolving");

		const allowed = await chatCompletion(
			token,
			{
				model: `dynamic/${routeName}`,
				messages: [{ role: "user", content: "hi end allowed" }],
			},
			{ "x-allowed": "1" },
		);
		expect(allowed.status).toBe(200);
	});

	test("free_models_only rejects a route resolving to a paid model", async () => {
		const token = await seedBase("free");
		const routeName = await seedRoute("free", {
			entry: "m",
			nodes: [modelNode("m", "gpt-4o-mini")],
		} as DynamicRouteGraph);

		const res = await chatCompletion(token, {
			model: `dynamic/${routeName}`,
			messages: [{ role: "user", content: "hi free" }],
			free_models_only: true,
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.message).toContain("free_models_only");
	});
});
