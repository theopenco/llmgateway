import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, inArray, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("chat safety identifier", () => {
	const harness = createGatewayApiTestHarness();

	test("forwards the authenticating API key's identifier upstream", async () => {
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
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
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
});
