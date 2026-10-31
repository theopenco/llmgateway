import { describe, expect, test, afterEach, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "@/test-utils/mock-openai-server.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, inArray, tables, eq } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

afterEach(() => vi.unstubAllEnvs());

describe("chat safety identifier", () => {
	const harness = createGatewayApiTestHarness();

	test("forwards the authenticating API key's identifier upstream", async () => {
		await harness.setProjectMode("credits");
		const keys = [
			{ id: "token-id-safety-a", token: "real-token-safety-a" },
			{ id: "token-id-safety-b", token: "real-token-safety-b" },
		];
		for (const key of keys) {
			await db.insert(tables.apiKey).values({
				id: key.id,
				...hashApiKeyForStorage(key.token),
				projectId: "project-id",
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
				}),
			});
			expect(res.status).toBe(200);
		}

		const stored = await db
			.select({
				id: tables.apiKey.id,
				safetyIdentifier: tables.apiKey.safetyIdentifier,
			})
			.from(tables.apiKey)
			.where(
				inArray(
					tables.apiKey.id,
					keys.map((key) => key.id),
				),
			);
		const identifiers = new Map(
			stored.map((row) => [row.id, row.safetyIdentifier]),
		);
		for (const identifier of identifiers.values()) {
			expect(identifier).toMatch(/^key_[0-9a-f]{32}$/);
		}
		expect(identifiers.get(keys[0].id)).not.toBe(identifiers.get(keys[1].id));

		const logs = await waitForLogs(2);
		for (const key of keys) {
			const log = logs.find((entry) => entry.apiKeyId === key.id);
			expect(log?.upstreamRequest).toMatchObject({
				safety_identifier: identifiers.get(key.id),
			});
		}
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

			const [apiKey] = await db
				.select({ safetyIdentifier: tables.apiKey.safetyIdentifier })
				.from(tables.apiKey)
				.where(eq(tables.apiKey.id, "token-id-safety-retry"));
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
					safety_identifier: apiKey?.safetyIdentifier,
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
		const [key] = await db
			.select()
			.from(tables.apiKey)
			.where(eq(tables.apiKey.id, "safety-mode-key"));
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
				byok ? {} : { safety_identifier: key.safetyIdentifier },
			);
			if (byok) {
				expect(log.upstreamRequest).not.toHaveProperty("safety_identifier");
			}
			expect(log.upstreamRequest).not.toHaveProperty("user");
			expect(log.upstreamRequest).not.toHaveProperty("metadata");
		}
	});
});
