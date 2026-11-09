import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { metricsApp } from "@/metrics-app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { inferencePaths } from "@/test-utils/gateway-security-paths.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type { InferencePath } from "@/test-utils/gateway-security-paths.js";

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
	// Read-only asset access requires a job-scoped bearer signature.
	"GET /v1/video-assets/jobs/:video_id/content",
	...[1, 2, 3, 4].map((version) => `GET /v${version}/ai/config`),
];
// Batch management: key-authenticated (regular keys, IP rules) and scoped to
// the key's project. The requests a batch runs are later sent to the
// inference paths below as the creating key, so every inference boundary
// still applies to them.
const batchRoutes = [
	"GET /v1/files",
	"POST /v1/files",
	"GET /v1/files/:file_id",
	"DELETE /v1/files/:file_id",
	"GET /v1/files/:file_id/content",
	"GET /v1/batches",
	"POST /v1/batches",
	"GET /v1/batches/:batch_id",
	"POST /v1/batches/:batch_id/cancel",
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
			...batchRoutes,
			...internalInferenceRoutes,
			...inferencePaths.map((route) => `POST ${route.path}`),
			"ALL /mcp",
		].sort();
		expect(actual).toEqual(classified);
		expect(actual).toHaveLength(59);
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

	function batchRequest(route: string, authenticated = true) {
		const [method, template] = route.split(" ");
		const path = template
			.replace(":file_id", "file-missing")
			.replace(":batch_id", "batch_missing");
		const auth = authenticated ? headers : {};
		if (route === "POST /v1/files") {
			const form = new FormData();
			form.append("purpose", "batch");
			form.append("file", new File(["{}"], "batch.jsonl"));
			return app.request(path, { method, headers: auth, body: form });
		}
		if (route === "POST /v1/batches") {
			return app.request(path, {
				method,
				headers: { ...auth, "Content-Type": "application/json" },
				body: JSON.stringify({
					input_file_id: "file-missing",
					endpoint: "/v1/chat/completions",
					completion_window: "24h",
				}),
			});
		}
		return app.request(path, { method, headers: auth });
	}

	test.each(batchRoutes)("%s rejects missing credentials", async (route) => {
		const response = await batchRequest(route, false);
		expect(response.status, await response.text()).toBe(401);
		expect(upstreamCalls).toBe(0);
	});

	describe.each(["key", "member", "team"] as const)(
		"%s trusted-IP boundary for batch management",
		(scope) => {
			test.each(batchRoutes)(
				"%s denies a caller outside the configured CIDRs",
				async (route) => {
					await installIamRule(scope, {
						ruleType: "allow_ip_cidrs",
						ruleValue: { ipCidrs: ["192.0.2.0/24"] },
					});
					const response = await batchRequest(route);
					expect(response.status, await response.text()).toBe(403);
					expect(upstreamCalls).toBe(0);
				},
			);
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
const internalInferenceRoutes = [
	// Signed snapshots have dedicated IAM, credits, replay and IP request tests.
	"POST /v1/internal/airside/inference",
];
