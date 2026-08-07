import { describe, expect, test } from "vitest";

import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { cdb, db, tables } from "@llmgateway/db";

import { runRealtimePreflight } from "./preflight.js";

/**
 * Credits-mode realtime sessions served by a platform-managed provider
 * credential — the database-backed replacement for LLM_OPENAI_API_KEY.
 */
describe("realtime preflight with managed credentials", () => {
	const harness = createGatewayApiTestHarness();

	async function seedApiKey() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	}

	/**
	 * Written through cdb so the gateway's SWR mirror for provider_key is
	 * invalidated, exactly as the admin API writes it.
	 */
	async function seedManagedCredential() {
		await cdb.insert(tables.providerKey).values({
			id: "managed-openai",
			provider: "openai",
			token: "sk-managed-upstream",
			managed: true,
			organizationId: null,
		});
	}

	test("credits mode uses the managed credential and still bills as credits", async () => {
		await seedApiKey();
		await harness.setProjectMode("credits");
		await seedManagedCredential();

		const result = await runRealtimePreflight({
			token: "real-token",
			requestedModel: "gpt-realtime",
		});

		expect(result.managedKey?.id).toBe("managed-openai");
		expect(result.providerKey).toBeUndefined();
		expect(result.upstreamToken).toBe("sk-managed-upstream");
		// Health failures must attribute to the credential actually sent.
		expect(result.trackedKeyHealthId).toBe("managed-openai");
		expect(result.envVarName).toBeUndefined();
		// A managed credential is the platform's own key: the org is billed for
		// the session exactly as it was on the env-var path.
		expect(result.usedMode).toBe("credits");
	});

	test("hybrid mode falls back to the managed credential without a BYOK key", async () => {
		await seedApiKey();
		await harness.setProjectMode("hybrid");
		await seedManagedCredential();

		const result = await runRealtimePreflight({
			token: "real-token",
			requestedModel: "gpt-realtime",
		});

		expect(result.managedKey?.id).toBe("managed-openai");
		expect(result.providerKey).toBeUndefined();
		expect(result.usedMode).toBe("credits");
	});
});
