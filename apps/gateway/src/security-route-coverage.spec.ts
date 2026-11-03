import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { metricsApp } from "@/metrics-app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const publicRoutes = [
	"GET /",
	"GET /livez",
	"GET /health/deep",
	"GET /json",
	"GET /openapi.json",
	"GET /docs",
	"GET /robots.txt",
	"GET /.well-known/security.txt",
	"GET /.well-known/oauth-authorization-server",
	"GET /.well-known/oauth-authorization-server/mcp",
	"GET /.well-known/oauth-protected-resource",
	"GET /.well-known/oauth-protected-resource/mcp",
	"GET /oauth/authorize",
	"POST /oauth/register",
	"POST /oauth/token",
];
const readRoutes = [
	"GET /v1/key",
	"GET /v1/credits",
	"GET /v1/models",
	"GET /v1/responses/:response_id",
	"GET /v1/videos/:video_id",
	"GET /v1/videos/:video_id/content",
	"GET /v1/videos/logs/:log_id/content",
	...[1, 2, 3, 4].map((version) => `GET /v${version}/ai/config`),
];

interface InferencePath {
	path: string;
	body?: Record<string, unknown>;
	multipart?: () => FormData;
}

function transcriptionBody() {
	const audio = Buffer.alloc(364);
	audio.write("RIFF", 0);
	audio.writeUInt32LE(356, 4);
	audio.write("WAVEfmt ", 8);
	audio.writeUInt32LE(16, 16);
	audio.writeUInt16LE(1, 20);
	audio.writeUInt16LE(1, 22);
	audio.writeUInt32LE(16000, 24);
	audio.writeUInt32LE(32000, 28);
	audio.writeUInt16LE(2, 32);
	audio.writeUInt16LE(16, 34);
	audio.write("data", 36);
	audio.writeUInt32LE(320, 40);
	const form = new FormData();
	form.set("model", "grok-stt-1-0");
	form.set("file", new Blob([audio], { type: "audio/wav" }), "fixture.wav");
	return form;
}

function imageEditBody() {
	const form = new FormData();
	form.set("model", "gpt-image-2");
	form.set("prompt", "A security fixture");
	form.set(
		"image",
		new Blob(
			[
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJXcAAAAASUVORK5CYII=",
					"base64",
				),
			],
			{ type: "image/png" },
		),
		"fixture.png",
	);
	return form;
}

const inferencePaths: InferencePath[] = [
	{
		path: "/v1/chat/completions",
		body: {
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: "Security fixture" }],
		},
	},
	{
		path: "/v1/responses",
		body: { model: "gpt-4o-mini", input: "Security fixture", store: false },
	},
	{
		path: "/v1/responses/compact",
		body: {
			model: "gpt-4o-mini",
			input: [
				{
					role: "user",
					content: [{ type: "input_text", text: "Security fixture" }],
				},
			],
		},
	},
	{
		path: "/v1/messages",
		body: {
			model: "gpt-4o-mini",
			max_tokens: 10,
			messages: [{ role: "user", content: "Security fixture" }],
		},
	},
	{
		path: "/v1/embeddings",
		body: { model: "text-embedding-3-small", input: "Security fixture" },
	},
	{
		path: "/v1/moderations",
		body: { model: "omni-moderation-latest", input: "Security fixture" },
	},
	{
		path: "/v1/ocr",
		body: {
			model: "mistral-ocr-latest",
			document: {
				type: "image_url",
				image_url: "https://example.com/fixture.png",
			},
		},
	},
	{
		path: "/v1/rerank",
		body: {
			model: "qwen3-reranker-0.6b",
			query: "Security fixture",
			documents: ["Fixture"],
		},
	},
	{
		path: "/v1/search",
		body: { model: "perplexity-search", query: "Security fixture" },
	},
	{
		path: "/v1/images/generations",
		body: { model: "gpt-image-2", prompt: "Security fixture" },
	},
	{ path: "/v1/images/edits", multipart: imageEditBody },
	{
		path: "/v1/audio/speech",
		body: {
			model: "gemini-2.5-flash-preview-tts",
			input: "Security fixture",
			voice: "Kore",
		},
	},
	{ path: "/v1/audio/transcriptions", multipart: transcriptionBody },
	{
		path: "/v1/decisions",
		body: {
			model: "jev-1.13.0",
			input: "Security fixture",
			questions: [
				{ type: "predicate", name: "approved", instructions: "Approve?" },
			],
		},
	},
	{
		path: "/v1/systemone",
		body: {
			model: "jev-1.13.0",
			state: "Security fixture",
			questions: { approved: { type: "noul", instructions: "Approve?" } },
		},
	},
	{
		path: "/v1/realtime/client_secrets",
		body: { session: { type: "realtime", model: "gpt-realtime-mini" } },
	},
	{
		path: "/v1/videos",
		body: {
			model: "atlascloud/kling-v3-0",
			prompt: "Security fixture",
			size: "1280x720",
			seconds: 5,
		},
	},
	...[1, 2, 3, 4].map((version) => ({
		path: `/v${version}/ai/language-model`,
		body: {
			modelId: "gpt-4o-mini",
			prompt: [
				{ role: "user", content: [{ type: "text", text: "Security fixture" }] },
			],
		},
	})),
];

const headers = {
	Authorization: "Bearer security-coverage-token",
	"X-Forwarded-For": "198.51.100.10",
};

function request(endpoint: InferencePath, authenticated = true) {
	return app.request(endpoint.path, {
		method: "POST",
		headers: {
			...(authenticated ? headers : {}),
			...(endpoint.path.includes("/ai/language-model")
				? { "ai-language-model-id": "gpt-4o-mini" }
				: {}),
			...(!endpoint.multipart ? { "Content-Type": "application/json" } : {}),
		},
		body: endpoint.multipart
			? endpoint.multipart()
			: JSON.stringify(endpoint.body),
	});
}

describe("complete gateway route inventory", () => {
	test("classifies every mounted HTTP path; new routes require a security decision", () => {
		const actual = [
			...new Set(
				app.routes
					.filter((route) => route.path !== "*" && route.path !== "/*")
					.map((route) => `${route.method} ${route.path}`),
			),
		].sort();
		const classified = [
			...publicRoutes,
			...readRoutes,
			...inferencePaths.map((route) => `POST ${route.path}`),
			"ALL /mcp",
		].sort();
		expect(actual).toEqual(classified);
		expect(actual).toHaveLength(48);
	});

	test("tracks the separate realtime upgrade and internal-only metrics router", () => {
		const server = readFileSync(
			new URL("./realtime/server.ts", import.meta.url),
			"utf8",
		);
		const upgrades = [
			...new Set(
				[...server.matchAll(/["'](\/[^"'\s]*)["']/g)].map((match) => match[1]),
			),
		];
		// Root is the URL parsing base; realtime is the only accepted upgrade.
		expect(upgrades).toEqual(["/", "/v1/realtime"]);
		expect(
			metricsApp.routes.map((route) => `${route.method} ${route.path}`),
		).toEqual(["GET /metrics"]);
	});
});

describe("all inference path security boundaries", () => {
	const harness = createGatewayApiTestHarness();
	let upstreamCalls = 0;
	let internalResponses: string[] = [];
	beforeEach(async () => {
		await harness.setProjectMode("credits");
		vi.stubEnv("REALTIME_ENABLED", "true");
		vi.stubEnv("MCP_GATEWAY_URL", "https://gateway.example");
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));
		await db.insert(tables.apiKey).values({
			id: "security-coverage-key",
			...hashApiKeyForStorage("security-coverage-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Security coverage fixture",
		});
		upstreamCalls = 0;
		internalResponses = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const forwarded = new Request(input, init);
			if (new URL(forwarded.url).pathname === "/v1/chat/completions") {
				const response = await app.fetch(forwarded);
				internalResponses.push(await response.clone().text());
				return response;
			}
			upstreamCalls++;
			throw new Error(
				"Unexpected upstream request in a negative security test",
			);
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test.each(inferencePaths)(
		"$path rejects missing credentials before dispatch",
		async (endpoint) => {
			const response = await request(endpoint, false);
			expect(response.status, await response.text()).toBe(401);
			expect(upstreamCalls).toBe(0);
		},
	);

	describe.each(["organization", "key", "intersection"] as const)(
		"%s compliance",
		(scope) => {
			test.each(inferencePaths)(
				"$path cannot escape restrictions",
				async (endpoint) => {
					if (scope !== "key") {
						await db
							.update(tables.organization)
							.set({
								providerCompliancePolicy: {
									enabled: true,
									allowedProviders:
										scope === "intersection" ? ["openai"] : ["custom:private"],
								},
							})
							.where(eq(tables.organization.id, "org-id"));
					}
					if (scope !== "organization") {
						await db
							.update(tables.apiKey)
							.set({
								providerCompliancePolicy: {
									enabled: true,
									allowedProviders:
										scope === "intersection"
											? ["anthropic"]
											: ["custom:private"],
								},
							})
							.where(eq(tables.apiKey.id, "security-coverage-key"));
					}
					const response = await request(endpoint);
					expect(response.status, await response.text()).toBe(403);
					expect(upstreamCalls).toBe(0);
				},
			);
		},
	);

	describe.each(["key", "member", "team"] as const)("%s IAM floor", (scope) => {
		test.each(inferencePaths)(
			"$path cannot widen the provider ceiling",
			async (endpoint) => {
				const rule = {
					ruleType: "allow_providers" as const,
					ruleValue: { providers: ["custom:private"] },
				};
				await installIamRule(scope, rule);
				const response = await request(endpoint);
				expect(response.status, await response.text()).toBe(403);
				expect(upstreamCalls).toBe(0);
			},
		);
	});

	describe.each(["key", "member", "team"] as const)(
		"%s trusted-IP boundary",
		(scope) => {
			test.each(inferencePaths)(
				"$path denies a caller outside the configured CIDRs",
				async (endpoint) => {
					await installIamRule(scope, {
						ruleType: "allow_ip_cidrs",
						ruleValue: { ipCidrs: ["192.0.2.0/24"] },
					});
					const response = await request(endpoint);
					expect(response.status, await response.text()).toBe(403);
					expect(upstreamCalls).toBe(0);
				},
			);
		},
	);

	test.each(inferencePaths)(
		"$path carries an allowed caller IP through adapters to compliance",
		async (endpoint) => {
			await installIamRule("key", {
				ruleType: "allow_ip_cidrs",
				ruleValue: { ipCidrs: ["198.51.100.0/24"] },
			});
			await db
				.update(tables.apiKey)
				.set({
					providerCompliancePolicy: {
						enabled: true,
						allowedProviders: ["custom:private"],
					},
				})
				.where(eq(tables.apiKey.id, "security-coverage-key"));
			const response = await request(endpoint);
			const body = await response.text();
			expect(response.status, body).toBe(403);
			expect(body.toLowerCase()).toContain("compliance");
			expect(upstreamCalls).toBe(0);
		},
	);

	test.each([
		{
			name: "chat",
			arguments: {
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "Security fixture" }],
			},
		},
		{ name: "generate-image", arguments: { prompt: "Security fixture" } },
		{ name: "generate-nano-banana", arguments: { prompt: "Security fixture" } },
	])(
		"MCP $name forwards and enforces policy before provider dispatch",
		async (tool) => {
			await installIamRule("key", {
				ruleType: "allow_ip_cidrs",
				ruleValue: { ipCidrs: ["198.51.100.0/24"] },
			});
			await db
				.update(tables.apiKey)
				.set({
					providerCompliancePolicy: {
						enabled: true,
						allowedProviders: ["custom:private"],
					},
				})
				.where(eq(tables.apiKey.id, "security-coverage-key"));
			const response = await app.request("/mcp", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: tool,
				}),
			});
			expect(response.status, await response.clone().text()).toBe(200);
			const result = await response.json();
			expect(result.result.isError).toBe(true);
			expect(JSON.stringify(result.result)).toContain("403");
			expect(internalResponses.at(-1)).toContain("compliance");
			expect(upstreamCalls).toBe(0);
		},
	);
});
async function installIamRule(
	scope: "key" | "member" | "team",
	rule: {
		ruleType: "allow_providers" | "allow_ip_cidrs";
		ruleValue: { providers?: string[]; ipCidrs?: string[] };
	},
) {
	if (scope === "key") {
		await db.insert(tables.apiKeyIamRule).values({
			id: "coverage-rule",
			apiKeyId: "security-coverage-key",
			...rule,
		});
	}
	if (scope === "member") {
		await db.insert(tables.userIamRule).values({
			id: "coverage-rule",
			userOrganizationId: "user-org-id",
			...rule,
		});
	}
	if (scope === "team") {
		await db.insert(tables.organizationTeam).values({
			id: "coverage-team",
			organizationId: "org-id",
			name: "Coverage team",
		});
		await db
			.update(tables.userOrganization)
			.set({ teamId: "coverage-team", role: "developer" })
			.where(eq(tables.userOrganization.id, "user-org-id"));
		await db
			.insert(tables.organizationTeamProject)
			.values({ teamId: "coverage-team", projectId: "project-id" });
		await db
			.insert(tables.organizationTeamIamRule)
			.values({ id: "coverage-rule", teamId: "coverage-team", ...rule });
	}
}
