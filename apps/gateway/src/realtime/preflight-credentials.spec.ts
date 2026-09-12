import { Decimal } from "decimal.js";
import { describe, expect, test } from "vitest";

import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import {
	createRealtimeSessionRecord,
	recordRealtimeResponse,
} from "./billing.js";
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
			...hashApiKeyForStorage("real-token"),
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
			...encryptProviderKeyForStorage(
				"sk-managed-upstream",
				"managed-openai",
				null,
			),
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
		const [organization] = await db
			.select({ safetyIdentifier: tables.organization.safetyIdentifier })
			.from(tables.organization)
			.where(eq(tables.organization.id, "org-id"));
		expect(result.safetyIdentifier).toBe(organization?.safetyIdentifier);
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

	test("snapshots Airside settings on realtime usage logs", async () => {
		await seedApiKey();
		await harness.setProjectMode("credits");
		await seedManagedCredential();
		await db.insert(tables.providerCompany).values({
			id: "airside-company-openai-realtime",
			name: "OpenAI Realtime",
		});
		await db.insert(tables.providerRoutingSettings).values({
			providerCompanyId: "airside-company-openai-realtime",
			providerId: "openai",
			discountPercent: "0.05",
			marginPercent: "0.25",
		});

		const preflight = await runRealtimePreflight({
			token: "real-token",
			requestedModel: "gpt-realtime",
		});
		const session = await createRealtimeSessionRecord(
			preflight,
			"gpt-realtime",
		);
		await recordRealtimeResponse({
			preflight,
			sessionId: session.id,
			requestedModel: "gpt-realtime",
			responseId: "response-airside-snapshot",
			responseStatus: "completed",
			durationMs: 100,
			responseSizeBytes: 10,
			usage: {
				totalTokens: 30,
				inputTokens: 10,
				outputTokens: 20,
				inputTextTokens: 10,
				inputAudioTokens: 0,
				inputImageTokens: 0,
				cachedTokens: 0,
				cachedTextTokens: 0,
				cachedAudioTokens: 0,
				cachedImageTokens: 0,
				outputTextTokens: 20,
				outputAudioTokens: 0,
			},
			costs: {
				inputCost: new Decimal("0.01"),
				cachedInputCost: new Decimal(0),
				audioInputCost: new Decimal(0),
				imageInputCost: new Decimal(0),
				outputCost: new Decimal("0.02"),
				audioOutputCost: new Decimal(0),
				totalCost: new Decimal("0.03"),
			},
			pricingSnapshot: {
				textInput: "1e-6",
				textOutput: "2e-6",
			},
			discount: 0,
			source: "test",
			userAgent: undefined,
		});

		const row = await db.query.log.findFirst({
			where: { realtimeSessionId: { eq: session.id } },
		});
		expect(row?.providerDiscountPercent).toBeCloseTo(0.05);
		expect(row?.providerMarginPercent).toBeCloseTo(0.25);
	});
});
