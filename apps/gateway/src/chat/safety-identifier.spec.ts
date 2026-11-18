import { describe, expect, test, afterEach, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "@/test-utils/mock-openai-server.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { getOrganizationSafetyIdentifier } from "@llmgateway/shared/safety-identifier";

afterEach(() => vi.unstubAllEnvs());

describe("chat safety identifier", () => {
	const harness = createGatewayApiTestHarness();

	test("forwards one organization-derived identifier for every key in the org", async () => {
		await harness.setProjectMode("credits");
		await db.insert(tables.organization).values({
			id: "org-id-safety-other",
			name: "Other Organization",
			billingEmail: "user",
			credits: "100",
			retentionLevel: "retain",
		});
		await db.insert(tables.userOrganization).values({
			id: "org-id-safety-other-member",
			userId: "user-id",
			organizationId: "org-id-safety-other",
		});
		await db.insert(tables.project).values({
			id: "project-id-safety-other",
			name: "Other Project",
			organizationId: "org-id-safety-other",
			mode: "credits",
		});
		const keys = [
			{ id: "token-id-safety-a", token: "real-token-safety-a", org: "org-id" },
			{ id: "token-id-safety-b", token: "real-token-safety-b", org: "org-id" },
			{
				id: "token-id-safety-c",
				token: "real-token-safety-c",
				org: "org-id-safety-other",
			},
		];
		for (const key of keys) {
			await db.insert(tables.apiKey).values({
				id: key.id,
				...hashApiKeyForStorage(key.token),
				projectId:
					key.org === "org-id" ? "project-id" : "project-id-safety-other",
				description: "Test API Key",
				createdBy: "user-id",
			});
		}
		await db.insert(tables.providerKey).values({
			id: "provider-key-id-safety",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id-safety",
				null,
			),
			provider: "openai",
			organizationId: null,
			managed: true,
			config: { baseUrl: harness.mockServerUrl },
			baseUrl: harness.mockServerUrl,
		});

		for (const key of keys) {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${key.token}`,
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: `Hello from ${key.id}` }],
					safety_identifier: "client-controlled",
					user: "client-user",
				}),
			});
			expect(res.status).toBe(200);
		}

		const logs = await waitForLogs(3);
		const forwarded = keys.map(
			(key) =>
				(
					logs.find((entry) => entry.apiKeyId === key.id)?.upstreamRequest as
						Record<string, unknown> | undefined
				)?.safety_identifier,
		);
		expect(forwarded[0]).toBe(getOrganizationSafetyIdentifier("org-id"));
		expect(forwarded[1]).toBe(forwarded[0]);
		expect(forwarded[2]).toBe(
			getOrganizationSafetyIdentifier("org-id-safety-other"),
		);
		expect(forwarded[2]).not.toBe(forwarded[0]);
		expect(String(forwarded[0])).not.toContain("org-id");
	});

	test.each(["credits", "api-keys", "hybrid"] as const)(
		"keeps safety attribution correct on %s retries",
		async (mode) => {
			await harness.setProjectMode(mode);
			vi.stubEnv("LLM_OPENAI_API_KEY", "test-token");
			vi.stubEnv("LLM_OPENAI_BASE_URL", harness.mockServerUrl);
			await db.insert(tables.apiKey).values({
				id: "token-id-safety-retry",
				...hashApiKeyForStorage("real-token-safety-retry"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});
			// Two keys for one provider: the first 500 rotates to the second key
			// through resolveProviderContextForRetry, which rebuilds the body.
			await db.insert(tables.providerKey).values(
				["a", "b"].map((suffix) => {
					const managed =
						mode === "credits" || (mode === "hybrid" && suffix === "b");
					const organizationId = managed ? null : "org-id";
					return {
						id: `provider-key-id-safety-retry-${suffix}`,
						...encryptProviderKeyForStorage(
							`sk-test-key-${suffix}`,
							`provider-key-id-safety-retry-${suffix}`,
							organizationId,
						),
						provider: "openai",
						organizationId,
						managed,
						config: { baseUrl: harness.mockServerUrl },
						baseUrl: harness.mockServerUrl,
					};
				}),
			);
			resetFailOnceCounter();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-safety-retry",
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE safety" }],
					safety_identifier: "end-user-retry",
				}),
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.metadata?.routing?.[0]).toMatchObject({ succeeded: false });

			const logs = await waitForLogs(1);
			const succeeded = logs.find(
				(entry) =>
					entry.apiKeyId === "token-id-safety-retry" && !entry.hasError,
			);
			expect(succeeded?.params).toMatchObject({
				safety_identifier: "end-user-retry",
			});
			if (mode === "api-keys") {
				expect(succeeded?.upstreamRequest).not.toHaveProperty(
					"safety_identifier",
				);
			} else {
				expect(succeeded?.usedMode).toBe("credits");
				expect(succeeded?.upstreamRequest).toMatchObject({
					safety_identifier: getOrganizationSafetyIdentifier("org-id"),
				});
			}
		},
	);
});

describe("safety identifier credential modes", () => {
	const harness = createGatewayApiTestHarness();
	test.each([
		{ mode: "credits", byok: false },
		{ mode: "api-keys", byok: true },
		{ mode: "hybrid", byok: true },
		{ mode: "hybrid", byok: false },
	] as const)("$mode (BYOK: $byok)", async ({ mode, byok }) => {
		await harness.setProjectMode(mode);
		vi.stubEnv("LLM_OPENAI_API_KEY", "test-token");
		vi.stubEnv("LLM_OPENAI_BASE_URL", harness.mockServerUrl);
		await db.insert(tables.apiKey).values({
			id: "safety-mode-key",
			...hashApiKeyForStorage("test-token-safety-mode"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		if (byok) {
			await db.insert(tables.providerKey).values({
				id: "safety-mode-provider-key",
				...encryptProviderKeyForStorage(
					"test-token",
					"safety-mode-provider-key",
					"org-id",
				),
				provider: "openai",
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}
		for (const client of ["user-a", "user-b"]) {
			for (const path of [
				"/v1/chat/completions",
				"/v1/responses",
				"/v1/messages",
			]) {
				const response = await app.request(path, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer test-token-safety-mode",
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model: "openai/gpt-4o-mini",
						messages: [{ role: "user", content: `Hello ${client}` }],
						safety_identifier: client,
						user: "spoofed-user",
						metadata: {
							user_id: path === "/v1/messages" ? client : "spoofed-metadata",
						},
						input: `Hello ${client}`,
						max_tokens: 32,
						store: false,
					}),
				});
				expect(response.status, await response.text()).toBe(200);
			}
		}
		const logs = await waitForLogs(6);
		expect(logs.map((log) => log.params?.safety_identifier).sort()).toEqual([
			"user-a",
			"user-a",
			"user-a",
			"user-b",
			"user-b",
			"user-b",
		]);
		for (const log of logs) {
			expect(log.usedMode).toBe(byok ? "api-keys" : "credits");
			expect(log.upstreamRequest).toMatchObject(
				byok
					? {}
					: { safety_identifier: getOrganizationSafetyIdentifier("org-id") },
			);
			if (byok) {
				expect(log.upstreamRequest).not.toHaveProperty("safety_identifier");
			}
			expect(log.upstreamRequest).not.toHaveProperty("user");
			expect(log.upstreamRequest).not.toHaveProperty("metadata");
		}
	});

	test("omits the identifier when the managed credential turns forwarding off", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-safety-off",
			...hashApiKeyForStorage("real-token-safety-off"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await harness.setProjectMode("credits");
		await cdb.insert(tables.providerKey).values({
			id: "managed-safety-off",
			provider: "openai",
			...encryptProviderKeyForStorage("sk-managed", "managed-safety-off", null),
			managed: true,
			organizationId: null,
			config: { baseUrl: harness.mockServerUrl },
			forwardSafetyIdentifier: false,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-safety-off",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "Hello" }],
				safety_identifier: "client-controlled",
			}),
		});
		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((entry) => entry.apiKeyId === "token-id-safety-off");
		expect(log?.upstreamRequest).toBeDefined();
		expect(log?.upstreamRequest).not.toHaveProperty("safety_identifier");
		expect(log?.upstreamRequest).not.toHaveProperty("user");
	});

	test("omits the identifier on BYOK even when the managed-only setting is off", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-safety-byok",
			...hashApiKeyForStorage("real-token-safety-byok"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id-safety-byok",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id-safety-byok",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			forwardSafetyIdentifier: false,
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-safety-byok",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((entry) => entry.apiKeyId === "token-id-safety-byok");
		expect(log?.upstreamRequest).not.toHaveProperty("safety_identifier");
	});
});
