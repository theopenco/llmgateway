import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { encryptModelVerificationCredential } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

import { processNextModelVerification } from "./model-verifications.js";

import type {
	ProviderModelVerificationCheck,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";

const originalHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;
const companyIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
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

async function enqueueVerification() {
	process.env.GATEWAY_API_KEY_HASH_SECRET = "model-verification-test-secret";
	const suffix = randomUUID();
	const userId = `verification-user-${suffix}`;
	const companyId = `verification-company-${suffix}`;
	const providerId = `verification-provider-${suffix}`;
	const verificationId = `verification-job-${suffix}`;
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
		credentialSource: "supplied",
		credentialCiphertext: encryptModelVerificationCredential(
			"single-use-provider-key",
			verificationId,
			companyId,
		),
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
});
