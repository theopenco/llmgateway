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
	AirsideModelMetadataChanges,
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
		credentialSource?: "supplied" | "carrier" | "managed";
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
			credentialSource === "managed"
				? null
				: encryptModelVerificationCredential(
						"single-use-provider-key",
						verificationId,
						companyId,
					),
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
		pendingMetadata?: AirsideModelMetadataChanges;
		targetReasoningEfforts?: string[] | null;
	} = {},
) {
	const { pendingMetadata, targetReasoningEfforts, ...listingOverrides } =
		overrides;
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
		...listingOverrides,
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
	if (pendingMetadata) {
		await db.insert(tables.providerPriceFiling).values({
			draftModelId: draftModel.id,
			providerCompanyId: companyId,
			kind: "metadata",
			inputPrice: "2e-6",
			outputPrice: "6e-6",
			metadata: pendingMetadata,
			requestedBy: userId,
		});
	}
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
			reasoningEfforts:
				targetReasoningEfforts === undefined
					? ["low", "high"]
					: targetReasoningEfforts,
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
	return { draftModelId: draftModel.id, modelName, providerId, verificationId };
}

describe("model verification worker", () => {
	it("runs a carrier-stored credential off the run's own copy", async () => {
		const verificationId = await enqueueVerification({
			credentialSource: "carrier",
		});
		let seenToken: string | undefined;
		const processed = await processNextModelVerification(async (options) => {
			seenToken = options.token;
			return { passed: true, checks: [], summary: "ok" };
		});

		expect(processed).toBe(true);
		expect(seenToken).toBe("single-use-provider-key");
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(stored?.credentialCiphertext).toBeNull();
	});

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

	it("leaves the listing alone when checks fail", async () => {
		const { draftModelId, modelName, providerId, verificationId } =
			await seedActiveListing();
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

		// One refused request does not prove the deployment cannot do it, so the
		// run only reports the failure.
		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing).toMatchObject({
			streaming: true,
			tools: true,
			reasoning: true,
			reasoningMaxTokens: true,
			reasoningEfforts: ["low", "high"],
		});
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: modelName }, providerId: { eq: providerId } },
		});
		expect(mapping).toMatchObject({
			streaming: true,
			tools: true,
			reasoning: true,
			reasoningMaxTokens: true,
			reasoningEfforts: ["low", "high"],
		});
		const run = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(run?.status).toBe("failed");
		expect(run?.demotedCapabilities).toBeNull();
	});

	it("leaves a filing awaiting review intact when its capability fails", async () => {
		const { draftModelId, verificationId } = await seedActiveListing({
			reasoning: false,
			reasoningMaxTokens: false,
			reasoningEfforts: undefined,
			pendingMetadata: {
				reasoning: true,
				reasoningEfforts: ["low", "high"],
				maxOutput: 4096,
			},
		});
		await processNextModelVerification(async () => ({
			passed: false,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{
					id: "reasoning",
					label: "Reasoning",
					status: "failed",
					feedback: "No reasoning content was returned.",
				},
			],
			summary: "1 of 2 verification checks failed.",
		}));

		// The reviewer sees the filing as the carrier proposed it, with the run's
		// failure next to it, rather than a change silently pruned.
		const filing = await db.query.providerPriceFiling.findFirst({
			where: { draftModelId: { eq: draftModelId }, status: { eq: "pending" } },
		});
		expect(filing?.metadata).toEqual({
			reasoning: true,
			reasoningEfforts: ["low", "high"],
			maxOutput: 4096,
		});
		const run = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: verificationId } },
		});
		expect(run?.demotedCapabilities).toBeNull();
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

	it("narrows reasoning efforts without dropping reasoning", async () => {
		const { draftModelId, modelName, providerId } = await seedActiveListing({
			reasoningEfforts: ["none", "low", "medium", "high"],
			targetReasoningEfforts: ["none", "low", "medium", "high"],
		});
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "reasoning", label: "Reasoning", status: "passed" },
			],
			summary: "2 verification checks passed.",
			unsupportedReasoningEfforts: ["medium"],
		}));

		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing).toMatchObject({
			reasoning: true,
			reasoningEfforts: ["none", "low", "high"],
		});
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: modelName }, providerId: { eq: providerId } },
		});
		expect(mapping?.reasoningEfforts).toEqual(["none", "low", "high"]);
	});

	it("enumerates the effort tiers a listing left undeclared", async () => {
		const { draftModelId } = await seedActiveListing({
			targetReasoningEfforts: null,
		});
		await db
			.update(tables.providerDraftModel)
			.set({ reasoningEfforts: null })
			.where(eq(tables.providerDraftModel.id, draftModelId));
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "reasoning", label: "Reasoning", status: "passed" },
			],
			summary: "2 verification checks passed.",
			unsupportedReasoningEfforts: ["medium", "minimal"],
		}));

		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing?.reasoningEfforts).toEqual([
			"none",
			"low",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("narrows a pending filing's proposed effort tiers", async () => {
		const { draftModelId } = await seedActiveListing({
			pendingMetadata: {
				reasoning: true,
				reasoningEfforts: ["none", "minimal", "low", "high"],
			},
			targetReasoningEfforts: ["none", "minimal", "low", "high"],
		});
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [
				{ id: "basic", label: "Basic completion", status: "passed" },
				{ id: "reasoning", label: "Reasoning", status: "passed" },
			],
			summary: "2 verification checks passed.",
			unsupportedReasoningEfforts: ["minimal"],
		}));

		const filing = await db.query.providerPriceFiling.findFirst({
			where: { draftModelId: { eq: draftModelId } },
		});
		expect(filing?.metadata?.reasoningEfforts).toEqual(["none", "low", "high"]);
		// The row declared a different set, so the refusal says nothing about it.
		const listing = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId } },
		});
		expect(listing?.reasoningEfforts).toEqual(["low", "high"]);
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
