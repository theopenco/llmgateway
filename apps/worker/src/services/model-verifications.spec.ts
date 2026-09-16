import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	encryptModelVerificationCredential,
	encryptProviderKeyForStorage,
} from "@llmgateway/actions";
import { db, eq, inArray, tables } from "@llmgateway/db";

import {
	claimNextModelVerification,
	processNextModelVerification,
} from "./model-verifications.js";

import type {
	ProviderModelVerificationCheck,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";
import type { ToolChoiceMode } from "@llmgateway/models";

const originalHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;
const STALE_AGE_MS = 60 * 60 * 1000;
const companyIds: string[] = [];
const providerKeyIds: string[] = [];
const userIds: string[] = [];
const catalogueProviderIds: string[] = [];
const catalogueModelIds: string[] = [];

beforeEach(async () => {
	await db
		.delete(tables.providerModelVerification)
		.where(
			inArray(tables.providerModelVerification.status, ["queued", "running"]),
		);
});

afterEach(async () => {
	for (const id of providerKeyIds.splice(0)) {
		await db.delete(tables.providerKey).where(eq(tables.providerKey.id, id));
	}
	for (const id of companyIds.splice(0)) {
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, id));
	}
	for (const id of userIds.splice(0)) {
		await db.delete(tables.user).where(eq(tables.user.id, id));
	}
	for (const id of catalogueModelIds.splice(0)) {
		await db.delete(tables.model).where(eq(tables.model.id, id));
	}
	for (const id of catalogueProviderIds.splice(0)) {
		await db.delete(tables.provider).where(eq(tables.provider.id, id));
	}
	if (originalHashSecret === undefined) {
		delete process.env.GATEWAY_API_KEY_HASH_SECRET;
	} else {
		process.env.GATEWAY_API_KEY_HASH_SECRET = originalHashSecret;
	}
});

async function enqueueVerification(
	options: {
		credentialSource?: "supplied" | "managed";
		allowedModels?: string[];
	} = {},
) {
	process.env.GATEWAY_API_KEY_HASH_SECRET = "model-verification-test-secret";
	const suffix = randomUUID();
	const userId = `verification-user-${suffix}`;
	const companyId = `verification-company-${suffix}`;
	const providerId = `verification-provider-${suffix}`;
	const verificationId = `verification-job-${suffix}`;
	const credentialSource = options.credentialSource ?? "supplied";
	userIds.push(userId);
	companyIds.push(companyId);
	await db.insert(tables.user).values({
		id: userId,
		email: `${userId}@example.com`,
		name: "Verification User",
	});
	await db.insert(tables.providerCompany).values({
		id: companyId,
		name: "Verification Provider",
	});
	await db.insert(tables.providerClaim).values({
		providerCompanyId: companyId,
		providerId,
		kind: "custom",
		matchedDomain: "example.com",
		customBaseUrl: "https://provider.example.com/v1",
		status: "active",
		claimedBy: userId,
	});
	if (credentialSource === "managed") {
		const providerKeyId = `verification-key-${suffix}`;
		providerKeyIds.push(providerKeyId);
		await db.insert(tables.providerKey).values({
			id: providerKeyId,
			provider: providerId,
			...encryptProviderKeyForStorage(
				"managed-provider-key",
				providerKeyId,
				null,
			),
			managed: true,
			allowedModels: options.allowedModels,
		});
	}
	const target: ProviderModelVerificationTarget = {
		providerId,
		modelName: "model-x",
		externalId: "upstream-model-x",
		streaming: false,
		vision: false,
		audio: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		reasoningEfforts: null,
		webSearch: false,
	};
	const checks: ProviderModelVerificationCheck[] = [
		{ id: "basic", label: "Basic completion", status: "queued" },
	];
	await db.insert(tables.providerModelVerification).values({
		id: verificationId,
		providerCompanyId: companyId,
		requestedBy: userId,
		target,
		checks,
		credentialSource,
		credentialCiphertext:
			credentialSource === "supplied"
				? encryptModelVerificationCredential(
						"single-use-provider-key",
						verificationId,
						companyId,
					)
				: null,
	});
	return verificationId;
}

/** An approved listing plus its materialized mapping and a queued job. */
async function seedActiveListing(
	overrides: {
		streaming?: boolean;
		tools?: boolean;
		supportedToolChoices?: ToolChoiceMode[];
		reasoning?: boolean;
		reasoningMaxTokens?: boolean;
		reasoningEfforts?: string[];
	} = {},
) {
	const suffix = randomUUID();
	const userId = `verification-user-${suffix}`;
	const companyId = `verification-company-${suffix}`;
	const providerId = `verification-provider-${suffix}`;
	const modelName = `verification-model-${suffix}`;
	const verificationId = `verification-job-${suffix}`;
	userIds.push(userId);
	companyIds.push(companyId);
	catalogueProviderIds.push(providerId);
	catalogueModelIds.push(modelName);
	await db.insert(tables.user).values({
		id: userId,
		email: `${userId}@example.com`,
		name: "Verification User",
	});
	await db.insert(tables.providerCompany).values({
		id: companyId,
		name: "Verification Provider",
	});
	await db.insert(tables.providerClaim).values({
		providerCompanyId: companyId,
		providerId,
		kind: "custom",
		matchedDomain: "example.com",
		customBaseUrl: "https://provider.example.com/v1",
		status: "active",
		claimedBy: userId,
	});
	const listingValues = {
		streaming: true,
		tools: true,
		reasoning: true,
		reasoningMaxTokens: true,
		reasoningEfforts: ["low", "high"],
		...overrides,
	};
	const [draftModel] = await db
		.insert(tables.providerDraftModel)
		.values({
			providerCompanyId: companyId,
			providerId,
			modelName,
			externalId: "upstream-model-x",
			family: "verification",
			status: "active",
			createdBy: userId,
			...listingValues,
		})
		.returning();
	await db.insert(tables.provider).values({
		id: providerId,
		name: "Verification Provider",
		description: "Verification carrier",
	});
	await db
		.insert(tables.model)
		.values({ id: modelName, name: modelName, family: "verification" });
	await db.insert(tables.modelProviderMapping).values({
		modelId: modelName,
		providerId,
		externalId: "upstream-model-x",
		source: "airside",
		...listingValues,
	});
	process.env.GATEWAY_API_KEY_HASH_SECRET = "model-verification-test-secret";
	await db.insert(tables.providerModelVerification).values({
		id: verificationId,
		providerCompanyId: companyId,
		draftModelId: draftModel.id,
		requestedBy: userId,
		target: {
			providerId,
			modelName,
			externalId: "upstream-model-x",
			streaming: true,
			vision: false,
			audio: false,
			tools: true,
			jsonOutput: false,
			jsonOutputSchema: false,
			reasoning: true,
			reasoningMaxTokens: true,
			reasoningEfforts: ["low", "high"],
			webSearch: false,
		},
		checks: [{ id: "basic", label: "Basic completion", status: "queued" }],
		credentialSource: "supplied",
		credentialCiphertext: encryptModelVerificationCredential(
			"single-use-provider-key",
			verificationId,
			companyId,
		),
	});
	return { draftModelId: draftModel.id, modelName, providerId };
}

describe("model verification worker", () => {
	it("claims a queued check, persists feedback, and erases its credential", async () => {
		const verificationId = await enqueueVerification();
		const processed = await processNextModelVerification(async (options) => {
			const passed: ProviderModelVerificationCheck = {
				id: "basic",
				label: "Basic completion",
				status: "passed",
				feedback: "Passed",
			};
			await options.onCheck?.({ ...passed, status: "running" });
			await options.onCheck?.(passed);
			return {
				passed: true,
				checks: [passed],
				summary: "1 verification check passed.",
			};
		});

		expect(processed).toBe(true);
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored).toMatchObject({
			status: "passed",
			attempts: 1,
			credentialCiphertext: null,
			summary: "1 verification check passed.",
		});
		expect(stored?.checks).toEqual([
			expect.objectContaining({ status: "passed", feedback: "Passed" }),
		]);
		expect(stored?.startedAt).toBeInstanceOf(Date);
		expect(stored?.completedAt).toBeInstanceOf(Date);
	});

	it("persists a terminal failure without leaking the supplied key", async () => {
		const verificationId = await enqueueVerification();
		await processNextModelVerification(async () => {
			throw new Error("upstream rejected single-use-provider-key");
		});
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored?.status).toBe("failed");
		expect(stored?.credentialCiphertext).toBeNull();
		expect(JSON.stringify(stored)).not.toContain("single-use-provider-key");
		expect(stored?.checks[0]).toMatchObject({ status: "failed" });
	});

	it("runs an admin job without a carrier from the managed credential", async () => {
		process.env.GATEWAY_API_KEY_HASH_SECRET = "model-verification-test-secret";
		const suffix = randomUUID();
		const providerId = `verification-provider-${suffix}`;
		const verificationId = `verification-job-${suffix}`;
		const providerKeyId = `verification-key-${suffix}`;
		providerKeyIds.push(providerKeyId);
		await db.insert(tables.providerKey).values({
			id: providerKeyId,
			provider: providerId,
			...encryptProviderKeyForStorage(
				"platform-provider-key",
				providerKeyId,
				null,
			),
			managed: true,
		});
		await db.insert(tables.providerModelVerification).values({
			id: verificationId,
			providerCompanyId: null,
			initiatedBy: "admin",
			requestedBy: null,
			target: {
				providerId,
				modelName: "model-x",
				externalId: "upstream-model-x",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				reasoningEfforts: null,
				webSearch: false,
			},
			checks: [{ id: "basic", label: "Basic completion", status: "queued" }],
			credentialSource: "managed",
		});

		await processNextModelVerification(async (options) => {
			// No provider claim exists, so the run must still resolve a token.
			expect(options.token).toBe("platform-provider-key");
			return {
				passed: true,
				checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
				summary: "1 verification check passed.",
			};
		});
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored?.status).toBe("passed");
	});

	it("selects managed credentials by upstream model ID", async () => {
		const verificationId = await enqueueVerification({
			credentialSource: "managed",
			allowedModels: ["upstream-model-x"],
		});
		await processNextModelVerification(async (options) => {
			expect(options.token).toBe("managed-provider-key");
			return {
				passed: true,
				checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
				summary: "1 verification check passed.",
			};
		});
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored?.status).toBe("passed");
	});

	it("drops the capabilities a failed re-verification disproved", async () => {
		const { draftModelId, modelName, providerId } = await seedActiveListing();
		await processNextModelVerification(async () => ({
			passed: false,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "streaming", label: "Streaming", status: "passed" },
				{
					id: "tools",
					label: "Tool calls",
					status: "failed",
					feedback: "The required tool call was not returned.",
				},
				{
					id: "reasoning",
					label: "Reasoning",
					status: "failed",
					feedback: "No reasoning content was returned.",
				},
				{
					id: "reasoning_budget",
					label: "Reasoning budget",
					status: "skipped",
					feedback: "Skipped after verification failed.",
				},
			],
			summary: "2 of 5 verification checks failed.",
		}));

		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing).toMatchObject({
			streaming: true,
			tools: false,
			reasoning: false,
			// Effort tiers and the budget go with the reasoning they describe,
			// even though only the reasoning check itself failed.
			reasoningMaxTokens: false,
			reasoningEfforts: null,
		});
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: modelName }, providerId: { eq: providerId } },
		});
		expect(mapping).toMatchObject({
			streaming: true,
			tools: false,
			reasoning: false,
			reasoningMaxTokens: false,
			reasoningEfforts: null,
		});
	});

	it("narrows tool_choice support without dropping tool calls", async () => {
		const { draftModelId, modelName, providerId } = await seedActiveListing();
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "tools", label: "Tool calls", status: "passed" },
			],
			summary: "2 verification checks passed.",
			unsupportedToolChoices: ["required"],
		}));

		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing).toMatchObject({
			tools: true,
			supportedToolChoices: ["auto", "none", "function"],
		});
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: modelName }, providerId: { eq: providerId } },
		});
		expect(mapping?.supportedToolChoices).toEqual(["auto", "none", "function"]);
	});

	it("keeps a carrier's own tool_choice narrowing", async () => {
		const { draftModelId } = await seedActiveListing({
			supportedToolChoices: ["auto", "required"],
		});
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "tools", label: "Tool calls", status: "passed" },
			],
			summary: "2 verification checks passed.",
			unsupportedToolChoices: ["required"],
		}));

		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing?.supportedToolChoices).toEqual(["auto"]);
	});

	it("does not let a stale attempt overwrite a reclaimed job", async () => {
		const verificationId = await enqueueVerification();
		const replacementChecks: ProviderModelVerificationCheck[] = [
			{
				id: "basic",
				label: "Basic completion",
				status: "running",
				feedback: "Replacement attempt",
			},
		];
		await processNextModelVerification(async (options) => {
			await db
				.update(tables.providerModelVerification)
				.set({ status: "queued", startedAt: null })
				.where(eq(tables.providerModelVerification.id, verificationId));
			const reclaimed = await claimNextModelVerification();
			expect(reclaimed).toMatchObject({
				id: verificationId,
				status: "running",
				attempts: 2,
			});
			await db
				.update(tables.providerModelVerification)
				.set({ checks: replacementChecks })
				.where(eq(tables.providerModelVerification.id, verificationId));
			await options.onCheck?.({
				id: "basic",
				label: "Basic completion",
				status: "passed",
			});
			return {
				passed: true,
				checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
				summary: "1 verification check passed.",
			};
		});

		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored).toMatchObject({
			status: "running",
			attempts: 2,
			checks: replacementChecks,
		});
		expect(stored?.credentialCiphertext).not.toBeNull();
	});

	it("requeues a stale running job until the attempt ceiling", async () => {
		const verificationId = await enqueueVerification();
		const stale = new Date(Date.now() - STALE_AGE_MS);
		await db
			.update(tables.providerModelVerification)
			.set({
				status: "running",
				attempts: 1,
				startedAt: stale,
				updatedAt: stale,
			})
			.where(eq(tables.providerModelVerification.id, verificationId));
		const reclaimed = await claimNextModelVerification();
		expect(reclaimed).toMatchObject({
			id: verificationId,
			status: "running",
			attempts: 2,
		});
	});

	it("fails a stale job terminally once the attempt ceiling is reached", async () => {
		const verificationId = await enqueueVerification();
		const stale = new Date(Date.now() - STALE_AGE_MS);
		await db
			.update(tables.providerModelVerification)
			.set({
				status: "running",
				attempts: 3,
				startedAt: stale,
				updatedAt: stale,
			})
			.where(eq(tables.providerModelVerification.id, verificationId));
		expect(await claimNextModelVerification()).toBeNull();
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored).toMatchObject({
			status: "failed",
			attempts: 3,
			summary: "Verification timed out.",
			credentialCiphertext: null,
		});
		expect(stored?.checks[0]).toMatchObject({
			status: "failed",
			feedback: "Verification timed out.",
		});
		expect(stored?.completedAt).toBeInstanceOf(Date);
	});
});
