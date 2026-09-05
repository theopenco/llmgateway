import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
	encryptModelVerificationCredential,
	encryptProviderKeyForStorage,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

import {
	claimNextModelVerification,
	processNextModelVerification,
} from "./model-verifications.js";

import type {
	ProviderModelVerificationCheck,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";

const originalHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;
const companyIds: string[] = [];
const providerKeyIds: string[] = [];
const userIds: string[] = [];

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
});
