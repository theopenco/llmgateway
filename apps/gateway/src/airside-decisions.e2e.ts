import "dotenv/config";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
	encryptProviderKeyForStorage,
	runProviderModelVerification,
} from "@llmgateway/actions";
import { db, eq, inArray, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import {
	generateTestRequestId,
	logMode,
	validateLogByRequestId,
} from "./chat-helpers.e2e.js";
import { clearCache } from "./test-utils/test-helpers.js";

/**
 * A real carrier's decision models, listed through Airside and served on
 * /v1/decisions. Opt-in, scoped by env:
 *   AIRSIDE_DECISIONS_BASE_URL  carrier API base URL (without /v1)
 *   AIRSIDE_DECISIONS_API_KEY   key that can call the models
 *   AIRSIDE_DECISIONS_MODELS    comma-separated upstream model ids
 */
const baseUrl = process.env.AIRSIDE_DECISIONS_BASE_URL;
const apiKey = process.env.AIRSIDE_DECISIONS_API_KEY;
const upstreamModels = (process.env.AIRSIDE_DECISIONS_MODELS ?? "")
	.split(",")
	.map((model) => model.trim())
	.filter(Boolean);
const enabled = Boolean(baseUrl && apiKey && upstreamModels.length > 0);

const PROVIDER_ID = "e2e-decision-carrier";
const TOKEN = "airside-decisions-e2e-token";
const ORG_ID = "airside-decisions-e2e-org";
const PROJECT_ID = "airside-decisions-e2e-project";
const COMPANY_ID = "airside-decisions-e2e-company";

/** Gateway model id for an upstream id: catalogue-style, unique to the run. */
function listingModelId(upstreamModel: string): string {
	return `e2e-${upstreamModel.toLowerCase().replace(/[^a-z0-9.-]/g, "-")}`;
}

function decisionTarget(upstreamModel: string, vision: boolean) {
	return {
		providerId: PROVIDER_ID,
		modelName: listingModelId(upstreamModel),
		externalId: upstreamModel,
		decisions: true,
		apiFormat: "openai-chat-completions" as const,
		streaming: false,
		vision,
		audio: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		reasoningEfforts: null,
		webSearch: false,
	};
}

async function cleanUp() {
	const modelIds = upstreamModels.map(listingModelId);
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.providerId, PROVIDER_ID));
	if (modelIds.length > 0) {
		await db.delete(tables.model).where(inArray(tables.model.id, modelIds));
	}
	await db
		.delete(tables.providerKey)
		.where(eq(tables.providerKey.provider, PROVIDER_ID));
	await db
		.delete(tables.providerClaim)
		.where(eq(tables.providerClaim.providerId, PROVIDER_ID));
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, COMPANY_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
	await db.delete(tables.apiKey).where(eq(tables.apiKey.projectId, PROJECT_ID));
	await db.delete(tables.project).where(eq(tables.project.id, PROJECT_ID));
	await db
		.delete(tables.userOrganization)
		.where(eq(tables.userOrganization.organizationId, ORG_ID));
	await db
		.delete(tables.organization)
		.where(eq(tables.organization.id, ORG_ID));
}

describe.skipIf(!enabled)("e2e airside decision listings", () => {
	beforeAll(async () => {
		await cleanUp();
		await db
			.insert(tables.user)
			.values({ id: "user-id", name: "user", email: "user" })
			.onConflictDoNothing();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Airside decisions e2e",
			billingEmail: "user",
			credits: "100",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-member`,
			userId: "user-id",
			organizationId: ORG_ID,
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Airside decisions e2e",
			organizationId: ORG_ID,
			mode: "credits",
		});
		await db.insert(tables.apiKey).values({
			id: `${TOKEN}-id`,
			...hashApiKeyForStorage(TOKEN),
			projectId: PROJECT_ID,
			description: "Airside decisions e2e",
			createdBy: "user-id",
		});
		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "E2E decision carrier",
			description: "",
		});
		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "E2E decision carrier",
		});
		await db.insert(tables.providerClaim).values({
			id: `${COMPANY_ID}-claim`,
			providerCompanyId: COMPANY_ID,
			providerId: PROVIDER_ID,
			kind: "custom",
			matchedDomain: new URL(baseUrl!).hostname,
			customName: "E2E decision carrier",
			customBaseUrl: baseUrl!,
			status: "active",
		});
		await db.insert(tables.providerKey).values({
			id: `${COMPANY_ID}-managed-key`,
			managed: true,
			organizationId: null,
			provider: PROVIDER_ID,
			...encryptProviderKeyForStorage(
				apiKey!,
				`${COMPANY_ID}-managed-key`,
				null,
			),
		});
		for (const upstreamModel of upstreamModels) {
			const modelId = listingModelId(upstreamModel);
			await db.insert(tables.model).values({
				id: modelId,
				name: upstreamModel,
				family: PROVIDER_ID,
				output: ["decision"],
			});
			await db.insert(tables.modelProviderMapping).values({
				modelId,
				providerId: PROVIDER_ID,
				externalId: upstreamModel,
				source: "airside",
				decisions: true,
				inputPrice: "1e-7",
				outputPrice: "0",
				streaming: false,
				status: "active",
			});
		}
		await clearCache();
	});

	afterAll(async () => {
		await cleanUp();
		await clearCache();
	});

	test.each(upstreamModels)(
		"preflight passes for %s",
		{ timeout: 180_000 },
		async (upstreamModel) => {
			const result = await runProviderModelVerification({
				target: decisionTarget(upstreamModel, false),
				token: apiKey!,
				baseUrl,
				skipEnvVars: true,
			});
			if (logMode || !result.passed) {
				console.log(
					`preflight ${upstreamModel}:`,
					JSON.stringify(result.checks, null, 2),
				);
			}
			expect(result.passed, result.summary).toBe(true);
		},
	);

	test.each(upstreamModels)(
		"/v1/decisions serves %s",
		{ timeout: 60_000 },
		async (upstreamModel) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/decisions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${TOKEN}`,
				},
				body: JSON.stringify({
					model: `${PROVIDER_ID}/${listingModelId(upstreamModel)}`,
					input:
						"Our production checkout has returned 500 errors for every customer since 09:00.",
					questions: [
						{
							type: "predicate",
							name: "is_outage",
							instructions: "Does this describe a production outage?",
						},
					],
				}),
			});
			const json = await res.json();
			if (logMode) {
				console.log("decisions response:", JSON.stringify(json, null, 2));
			}
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(json.answers).toHaveLength(1);
			expect(json.answers[0]).toMatchObject({
				type: "predicate",
				name: "is_outage",
			});
			expect(json.answers[0].probability).toBeGreaterThanOrEqual(0);
			expect(json.answers[0].probability).toBeLessThanOrEqual(1);

			const log = await validateLogByRequestId(requestId);
			expect(log.usedProvider).toBe(PROVIDER_ID);
			expect(Number(log.promptTokens)).toBeGreaterThan(0);
			expect(Number(log.cost)).toBeGreaterThan(0);
		},
	);
});
