import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	encryptModelVerificationCredential,
	encryptProviderKeyForStorage,
	openAirsideInference,
	signAirsideInferenceResponse,
	providerVerificationCredentialFingerprint,
} from "@llmgateway/actions";
import { db, eq, inArray, tables } from "@llmgateway/db";

import {
	claimNextModelVerification,
	processNextModelVerification,
	resetModelVerificationGatewayPause,
} from "./model-verifications.js";

import type {
	AirsideInferencePricing,
	RunModelVerificationOptions,
} from "@llmgateway/actions";
import type {
	AirsideModelMetadataChanges,
	ProviderModelVerificationCheck,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";
import type { ToolChoiceMode } from "@llmgateway/models";

const organizationIds: string[] = [];

const originalHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;
const STALE_AGE_MS = 60 * 60 * 1000;
const companyIds: string[] = [];
const providerKeyIds: string[] = [];
const userIds: string[] = [];
const catalogueProviderIds: string[] = [];
const catalogueModelIds: string[] = [];

beforeEach(async () => {
	await resetModelVerificationGatewayPause();
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
	for (const id of organizationIds.splice(0)) {
		await db.delete(tables.organization).where(eq(tables.organization.id, id));
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
		claimKind?: "custom" | "catalogue";
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
		kind: options.claimKind ?? "custom",
		matchedDomain: "example.com",
		customBaseUrl: "https://provider.example.com/v1",
		status: "active",
		claimedBy: userId,
	});
	{
		const providerKeyId = `verification-key-${suffix}`;
		providerKeyIds.push(providerKeyId);
		await db.insert(tables.providerKey).values({
			id: providerKeyId,
			provider: providerId,
			...encryptProviderKeyForStorage(
				credentialSource === "managed"
					? "managed-provider-key"
					: "single-use-provider-key",
				providerKeyId,
				null,
			),
			managed: true,
			allowedModels: options.allowedModels,
			baseUrl: "https://provider.example.com/v1",
		});
		await db
			.update(tables.providerClaim)
			.set({ providerKeyId })
			.where(eq(tables.providerClaim.providerCompanyId, companyId));
	}
	const target: ProviderModelVerificationTarget = {
		providerId,
		modelName: "model-x",
		externalId: "upstream-model-x",
		pricing: { inputPrice: "0", outputPrice: "0" },
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
		inputPrice: "0",
		outputPrice: "0",
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
	const keyId = randomUUID();
	providerKeyIds.push(keyId);
	await db.insert(tables.providerKey).values({
		id: keyId,
		provider: providerId,
		managed: true,
		baseUrl: "https://provider.example.com/v1",
		...encryptProviderKeyForStorage("single-use-provider-key", keyId, null),
	});
	await db
		.update(tables.providerClaim)
		.set({ providerKeyId: keyId })
		.where(eq(tables.providerClaim.providerCompanyId, companyId));
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
	it.each(["custom", "catalogue"] as const)(
		"runs a stored credential for a DB-only %s claim",
		async (claimKind) => {
			const verificationId = await enqueueVerification({
				credentialSource: "carrier",
				claimKind,
			});
			let seenToken: string | undefined;
			const processed = await processNextModelVerification(async (options) => {
				seenToken = options.token;
				expect(options.skipEnvVars).toBe(true);
				return { passed: true, checks: [], summary: "ok" };
			});

			expect(processed).toBe(true);
			expect(seenToken).toBe("single-use-provider-key");
			const stored = await db.query.providerModelVerification.findFirst({
				where: { id: { eq: verificationId } },
			});
			expect(stored?.credentialCiphertext).toBeNull();
		},
	);

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
				pricing: { inputPrice: "0", outputPrice: "0" },
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

	it("selects managed credentials by canonical model ID", async () => {
		const verificationId = await enqueueVerification({
			credentialSource: "managed",
			allowedModels: ["model-x"],
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

it("pins first-deployment verification to its pending key through the operator gateway", async () => {
	const id = await enqueueVerification({ credentialSource: "carrier" });
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
	const pendingId = randomUUID();
	providerKeyIds.push(pendingId);
	await db.insert(tables.providerKey).values({
		id: pendingId,
		provider: job.target.providerId,
		managed: true,
		status: "inactive",
		baseUrl: "https://replacement.example.com/v1",
		...encryptProviderKeyForStorage("pending-provider-key", pendingId, null),
	});
	await db
		.update(tables.providerClaim)
		.set({
			providerKeyId: null,
			pendingProviderKeyId: pendingId,
			customBaseUrl: "https://replacement.example.com/v1",
		})
		.where(eq(tables.providerClaim.providerCompanyId, job.providerCompanyId!));
	await db
		.update(tables.providerModelVerification)
		.set({
			target: {
				...job.target,
				pricing: { inputPrice: "0.000001", outputPrice: "0.000002" },
			},
		})
		.where(eq(tables.providerModelVerification.id, id));
	vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", "test-token");
	vi.stubEnv("GATEWAY_URL", "http://localhost:6801");
	const gatewayFetch = vi.fn<typeof fetch>(async (input, init) => {
		expect(String(input)).toBe(
			"http://localhost:6801/v1/internal/airside/inference",
		);
		expect(
			new Headers(init?.headers).get("Authorization") === "Bearer test-token",
		).toBe(true);
		expect(String(init?.body).includes("pending-provider-key")).toBe(false);
		const { payload, envelope } = openAirsideInference(
			JSON.parse(String(init?.body)),
			"test-token",
		);
		expect(payload.providerKeyId).toBe(pendingId);
		expect(payload.runId).toBe(id);
		expect(payload.target.externalId).toBe(job.target.externalId);
		expect(payload.pricing).toEqual({
			inputPrice: "0.000001",
			outputPrice: "0.000002",
		});
		expect(payload.endpoint).toBe(
			"https://replacement.example.com/v1/chat/completions",
		);
		return Response.json(
			{ choices: [] },
			{
				headers: {
					"x-airside-inference": signAirsideInferenceResponse(envelope, 200),
				},
			},
		);
	});
	vi.stubGlobal("fetch", gatewayFetch);
	try {
		await processNextModelVerification(async (options) => {
			expect(options.token === "pending-provider-key").toBe(true);
			expect(options.baseUrl).toBe("https://replacement.example.com/v1");
			await options.fetchImplementation!(
				options.baseUrl + "/chat/completions",
				{
					method: "POST",
					headers: { Authorization: "Bearer " + options.token },
					body: JSON.stringify({
						model: options.target.externalId,
						messages: [],
					}),
				},
			);
			return { passed: true, checks: [], summary: "Passed" };
		});
		expect(gatewayFetch).toHaveBeenCalledOnce();
		expect(
			(
				await db.query.providerModelVerification.findFirst({
					where: { id: { eq: id } },
				})
			)?.target.gatewayExecutionVersion,
		).toBe(1);
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	}
});
it.each(["missing", "inactive", "deleted", "unmanaged", "wrong-provider"])(
	"rejects %s linked carrier credentials instead of using legacy run ciphertext",
	async (kind) => {
		const id = await enqueueVerification({ credentialSource: "carrier" });
		const job = (await db.query.providerModelVerification.findFirst({
			where: { id: { eq: id } },
		}))!;
		const claim = (await db.query.providerClaim.findFirst({
			where: { providerCompanyId: { eq: job.providerCompanyId! } },
		}))!;
		const organizationId = kind === "unmanaged" ? randomUUID() : null;
		if (organizationId) {
			organizationIds.push(organizationId);
			await db.insert(tables.organization).values({
				id: organizationId,
				name: "Test Organization",
				billingEmail: "test@example.com",
			});
		}
		if (kind === "missing") {
			await db
				.update(tables.providerClaim)
				.set({ providerKeyId: null })
				.where(eq(tables.providerClaim.id, claim.id));
		} else {
			await db
				.update(tables.providerKey)
				.set(
					kind === "unmanaged"
						? { managed: false, organizationId }
						: kind === "wrong-provider"
							? { provider: "another-provider" }
							: { status: kind === "deleted" ? "deleted" : "inactive" },
				)
				.where(eq(tables.providerKey.id, claim.providerKeyId!));
		}
		const runner = vi.fn();
		await processNextModelVerification(runner);
		expect(runner).not.toHaveBeenCalled();
		expect(
			(
				await db.query.providerModelVerification.findFirst({
					where: { id: { eq: id } },
				})
			)?.status,
		).toBe("failed");
	},
);
it("retains platform managed resolution for a catalogue claim with no linked credential", async () => {
	const id = await enqueueVerification({
		credentialSource: "managed",
		claimKind: "catalogue",
	});
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
	await db
		.update(tables.providerClaim)
		.set({ providerKeyId: null })
		.where(eq(tables.providerClaim.providerCompanyId, job.providerCompanyId!));
	const runner = vi.fn(async () => ({
		passed: true,
		checks: [],
		summary: "Passed",
	}));
	await processNextModelVerification(runner);
	expect(runner).toHaveBeenCalledOnce();
});
it("rejects an arbitrary legacy credential for a non-carrier admin job", async () => {
	const id = await enqueueVerification();
	await db
		.update(tables.providerModelVerification)
		.set({ providerCompanyId: null })
		.where(eq(tables.providerModelVerification.id, id));
	const runner = vi.fn();
	await processNextModelVerification(runner);
	expect(runner).not.toHaveBeenCalled();
});

it.each([401, 402, 404])(
	"requeues on operator gateway %s, pauses the queue, and fails once attempts run out",
	async (status) => {
		const { verificationId, draftModelId } = await seedActiveListing();
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", "test-token");
		vi.stubEnv("GATEWAY_URL", "http://localhost:6801");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ error: "operator rejection" }, { status }),
			),
		);
		const runner = async (options: RunModelVerificationOptions) => {
			await expect(
				options.fetchImplementation!(
					"https://provider.example.com/v1/chat/completions",
					{ method: "POST", body: JSON.stringify({ messages: [] }) },
				),
			).rejects.toThrow("Airside gateway inference is unavailable");
			return {
				passed: false,
				summary: "Failed",
				checks: [
					{ id: "basic", label: "Basic completion", status: "failed" as const },
				],
				unsupportedToolChoices: ["required" as const],
				unsupportedReasoningEfforts: ["high" as const],
			};
		};
		try {
			expect(await processNextModelVerification(runner)).toBe(true);
			const requeued = (await db.query.providerModelVerification.findFirst({
				where: { id: { eq: verificationId } },
			}))!;
			expect(requeued.status).toBe("queued");
			expect(requeued.attempts).toBe(1);
			expect(requeued.completedAt).toBeNull();
			expect(await processNextModelVerification(runner)).toBe(false);
			await db
				.update(tables.providerModelVerification)
				.set({ attempts: 2 })
				.where(eq(tables.providerModelVerification.id, verificationId));
			await resetModelVerificationGatewayPause();
			await processNextModelVerification(runner);
			const job = (await db.query.providerModelVerification.findFirst({
				where: { id: { eq: verificationId } },
			}))!;
			expect(job.status).toBe("failed");
			expect(job.checks.every((check) => check.status === "skipped")).toBe(
				true,
			);
			expect(job.summary).toBe("Airside gateway inference is unavailable");
			const draft = (await db.query.providerDraftModel.findFirst({
				where: { id: { eq: draftModelId } },
			}))!;
			expect(draft.supportedToolChoices).toBeNull();
			expect(draft.reasoningEfforts).toEqual(["low", "high"]);
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	},
);
it("invalidates an in-flight credential rotation before certifying or narrowing the listing", async () => {
	const { verificationId, draftModelId, providerId } =
		await seedActiveListing();
	const key = (await db.query.providerKey.findFirst({
		where: { provider: { eq: providerId } },
	}))!;
	await processNextModelVerification(async () => {
		await db
			.update(tables.providerKey)
			.set(encryptProviderKeyForStorage("rotated-provider-key", key.id, null))
			.where(eq(tables.providerKey.id, key.id));
		return {
			passed: true,
			summary: "Passed",
			checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
			unsupportedToolChoices: ["required"],
			unsupportedReasoningEfforts: ["high"],
		};
	});
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: verificationId } },
	}))!;
	expect(job.status).toBe("failed");
	expect(job.checks.every((check) => check.status === "skipped")).toBe(true);
	expect(job.summary).toContain("configuration changed");
	const draft = (await db.query.providerDraftModel.findFirst({
		where: { id: { eq: draftModelId } },
	}))!;
	expect(draft.supportedToolChoices).toBeNull();
	expect(draft.reasoningEfforts).toEqual(["low", "high"]);
});

it("accepts an exact platform-managed proof using the key endpoint default", async () => {
	const id = await enqueueVerification({
		credentialSource: "managed",
		claimKind: "catalogue",
	});
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
	const key = (await db.query.providerKey.findFirst({
		where: { provider: { eq: job.target.providerId } },
	}))!;
	await db
		.update(tables.providerModelVerification)
		.set({
			providerCompanyId: null,
			target: {
				...job.target,
				providerKeyId: key.id,
				credentialFingerprint: providerVerificationCredentialFingerprint(key),
			},
		})
		.where(eq(tables.providerModelVerification.id, id));
	const runner = vi.fn(async () => ({
		passed: true,
		checks: [],
		summary: "Passed",
	}));
	await processNextModelVerification(runner);
	expect(runner).toHaveBeenCalledOnce();
	expect(
		(
			await db.query.providerModelVerification.findFirst({
				where: { id: { eq: id } },
			})
		)?.status,
	).toBe("passed");
});

it("binds carrier proof and inference to the claim endpoint override", async () => {
	const id = await enqueueVerification({ credentialSource: "carrier" });
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
	const key = (await db.query.providerKey.findFirst({
		where: { provider: { eq: job.target.providerId } },
	}))!;
	const baseUrl = "https://override.example.com/v1";
	await db
		.update(tables.providerClaim)
		.set({ customBaseUrl: baseUrl })
		.where(eq(tables.providerClaim.providerCompanyId, job.providerCompanyId!));
	await db
		.update(tables.providerModelVerification)
		.set({
			target: {
				...job.target,
				providerKeyId: key.id,
				credentialFingerprint: providerVerificationCredentialFingerprint(
					key,
					baseUrl,
				),
			},
		})
		.where(eq(tables.providerModelVerification.id, id));
	const runner = vi.fn(async (options) => {
		expect(options.baseUrl).toBe(baseUrl);
		return { passed: true, checks: [], summary: "Passed" };
	});
	await processNextModelVerification(runner);
	expect(runner).toHaveBeenCalledOnce();
	expect(
		(
			await db.query.providerModelVerification.findFirst({
				where: { id: { eq: id } },
			})
		)?.status,
	).toBe("passed");
});

it("does not certify a passed legacy runner without verified gateway execution", async () => {
	const id = await enqueueVerification({ credentialSource: "carrier" });
	await processNextModelVerification(async () => ({
		passed: true,
		checks: [],
		summary: "Passed",
	}));
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
	expect(job.status).toBe("passed");
	expect(job.target.providerKeyId).toBeDefined();
	expect(job.target.credentialFingerprint).toBeDefined();
	expect(job.target.gatewayExecutionVersion).toBeUndefined();
});
function captureGatewayPricing() {
	vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", "test-token");
	vi.stubEnv("GATEWAY_URL", "http://localhost:6801");
	const prices: AirsideInferencePricing[] = [];
	const gatewayFetch = vi.fn<typeof fetch>(async (_input, init) => {
		const { payload, envelope } = openAirsideInference(
			JSON.parse(String(init?.body)),
			"test-token",
		);
		prices.push(payload.pricing);
		return Response.json(
			{ choices: [] },
			{
				headers: {
					"x-airside-inference": signAirsideInferenceResponse(envelope, 200),
				},
			},
		);
	});
	vi.stubGlobal("fetch", gatewayFetch);
	return { prices, gatewayFetch };
}
async function completeThroughGateway(options: RunModelVerificationOptions) {
	await options.fetchImplementation!(options.baseUrl + "/chat/completions", {
		method: "POST",
		headers: { Authorization: "Bearer " + options.token },
		body: JSON.stringify({ model: options.target.externalId, messages: [] }),
	});
	return { passed: true, checks: [], summary: "Passed" };
}
async function insertCatalogueBeforeAirside(providerId: string) {
	const airside = (await db.query.modelProviderMapping.findFirst({
		where: { providerId: { eq: providerId }, source: { eq: "airside" } },
	}))!;
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, airside.id));
	await db.insert(tables.modelProviderMapping).values([
		{
			...airside,
			id: randomUUID(),
			source: "catalogue",
			inputPrice: "0.1",
			outputPrice: "0.2",
			cacheReadInputPrice: "0.05",
		},
		airside,
	]);
	return airside;
}

it.each(["mapping-id", "draft"])(
	"keeps %s verification on Airside flat pricing despite a same-external NULL-region catalogue row",
	async (anchor) => {
		const { verificationId, providerId } = await seedActiveListing();
		const airside = await insertCatalogueBeforeAirside(providerId);
		if (anchor === "mapping-id") {
			await db
				.update(tables.providerModelVerification)
				.set({ modelProviderMappingId: airside.id })
				.where(eq(tables.providerModelVerification.id, verificationId));
		}
		const { prices, gatewayFetch } = captureGatewayPricing();
		try {
			await processNextModelVerification(completeThroughGateway);
			expect(gatewayFetch).toHaveBeenCalledOnce();
			expect(prices).toEqual([
				{ inputPrice: airside.inputPrice, outputPrice: airside.outputPrice },
			]);
			expect(
				(
					await db.query.providerModelVerification.findFirst({
						where: { id: { eq: verificationId } },
					})
				)?.status,
			).toBe("passed");
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	},
);
it("rejects a detached explicit mapping anchor instead of borrowing a same-tuple catalogue row", async () => {
	const { verificationId, providerId } = await seedActiveListing();
	const airside = await insertCatalogueBeforeAirside(providerId);
	await db
		.update(tables.providerModelVerification)
		.set({ modelProviderMappingId: airside.id })
		.where(eq(tables.providerModelVerification.id, verificationId));
	await db
		.update(tables.modelProviderMapping)
		.set({ externalId: "changed-upstream" })
		.where(eq(tables.modelProviderMapping.id, airside.id));
	const runner = vi.fn();
	await processNextModelVerification(runner);
	expect(runner).not.toHaveBeenCalled();
	const job = (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: verificationId } },
	}))!;
	expect(job.checks.every((check) => check.status === "skipped")).toBe(true);
	expect(job.target.gatewayExecutionVersion).toBeUndefined();
});
it.each([true, false])(
	"requires an unfiled pricing snapshot instead of an unanchored catalogue row (present: %s)",
	async (hasSnapshot) => {
		const id = await enqueueVerification({ credentialSource: "carrier" });
		const job = (await db.query.providerModelVerification.findFirst({
			where: { id: { eq: id } },
		}))!;
		const modelName = "unfiled-" + randomUUID();
		catalogueProviderIds.push(job.target.providerId);
		catalogueModelIds.push(modelName);
		await db.insert(tables.provider).values({
			id: job.target.providerId,
			name: "Verification Provider",
			description: "test",
		});
		await db
			.insert(tables.model)
			.values({ id: modelName, name: modelName, family: "verification" });
		await db.insert(tables.modelProviderMapping).values({
			modelId: modelName,
			providerId: job.target.providerId,
			externalId: job.target.externalId,
			source: "catalogue",
			inputPrice: "0.1",
			outputPrice: "0.2",
			cacheReadInputPrice: "0.05",
		});
		const pricing = hasSnapshot
			? { inputPrice: "0.000001", outputPrice: "0.000002" }
			: undefined;
		await db
			.update(tables.providerModelVerification)
			.set({ target: { ...job.target, modelName, pricing } })
			.where(eq(tables.providerModelVerification.id, id));
		const { prices, gatewayFetch } = captureGatewayPricing();
		try {
			await processNextModelVerification(completeThroughGateway);
			if (hasSnapshot) {
				expect(prices).toEqual([pricing]);
			} else {
				expect(gatewayFetch).not.toHaveBeenCalled();
				expect(
					(
						await db.query.providerModelVerification.findFirst({
							where: { id: { eq: id } },
						})
					)?.checks.every((check) => check.status === "skipped"),
				).toBe(true);
			}
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	},
);

it.each(["pending filing", "target snapshot", "both"])(
	"bills the mapped approved price instead of %s",
	async (proposal) => {
		const { verificationId, providerId } = await seedActiveListing({
			pendingMetadata:
				proposal === "target snapshot" ? undefined : { tools: true },
		});
		const mapping = (await db.query.modelProviderMapping.findFirst({
			where: { providerId: { eq: providerId }, source: { eq: "airside" } },
		}))!;
		if (proposal !== "pending filing") {
			const job = (await db.query.providerModelVerification.findFirst({
				where: { id: { eq: verificationId } },
			}))!;
			await db
				.update(tables.providerModelVerification)
				.set({
					target: {
						...job.target,
						pricing: {
							inputPrice: "11",
							outputPrice: "12",
							cachedInputPrice: "13",
							requestPrice: "14",
						},
					},
				})
				.where(eq(tables.providerModelVerification.id, verificationId));
		}
		const { prices, gatewayFetch } = captureGatewayPricing();
		const filingQuery = vi.spyOn(db.query.providerPriceFiling, "findFirst");
		try {
			await processNextModelVerification(completeThroughGateway);
			expect(gatewayFetch).toHaveBeenCalledOnce();
			expect(filingQuery).not.toHaveBeenCalled();
			expect(prices).toEqual([
				{ inputPrice: mapping.inputPrice, outputPrice: mapping.outputPrice },
			]);
		} finally {
			filingQuery.mockRestore();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	},
);
it("uses the pending initial filing when the draft has no materialized mapping", async () => {
	const { verificationId, providerId, draftModelId } = await seedActiveListing({
		pendingMetadata: { tools: true },
	});
	const filing = (await db.query.providerPriceFiling.findFirst({
		where: { draftModelId: { eq: draftModelId } },
		orderBy: { createdAt: "desc", id: "desc" },
	}))!;
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.providerId, providerId));
	const { prices, gatewayFetch } = captureGatewayPricing();
	try {
		await processNextModelVerification(completeThroughGateway);
		expect(gatewayFetch).toHaveBeenCalledOnce();
		expect(prices).toEqual([
			{ inputPrice: filing.inputPrice, outputPrice: filing.outputPrice },
		]);
		expect(
			(
				await db.query.providerModelVerification.findFirst({
					where: { id: { eq: verificationId } },
				})
			)?.status,
		).toBe("passed");
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	}
});
