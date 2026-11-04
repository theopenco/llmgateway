import { createHash, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const ONE_HOUR_MS = 60 * 60 * 1000;

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

async function redeem(code: string, verifier: string) {
	return await app.request("/public/cli-auth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code, code_verifier: verifier }),
	});
}

describe("CLI browser login code", () => {
	let cookie: string;

	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function issue(challenge: string) {
		const res = await app.request("/keys/cli-code", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({
				description: "OpenCode (CLI)",
				projectId: "test-project-id",
				expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
				codeChallenge: challenge,
			}),
		});
		expect(res.status).toBe(200);
		return (await res.json()) as { apiKeyId: string; code: string };
	}

	test("requires a session to issue a code", async () => {
		const res = await app.request("/keys/cli-code", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				description: "OpenCode (CLI)",
				projectId: "test-project-id",
				codeChallenge: pkce().challenge,
			}),
		});
		expect(res.status).toBe(401);
	});

	test("redeems the code once with the matching verifier", async () => {
		const { verifier, challenge } = pkce();
		const { apiKeyId, code } = await issue(challenge);

		const res = await redeem(code, verifier);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			api_key: string;
			expires_at: string | null;
		};
		const apiKey = await db.query.apiKey.findFirst({
			where: { id: { eq: apiKeyId } },
		});
		expect(apiKey?.tokenHash === getApiKeyFingerprint(body.api_key)).toBe(true);
		expect(body.expires_at).toBe(apiKey?.expiresAt?.toISOString());

		expect((await redeem(code, verifier)).status).toBe(400);
	});

	test("burns the code on a wrong verifier", async () => {
		const { verifier, challenge } = pkce();
		const { code } = await issue(challenge);

		expect((await redeem(code, pkce().verifier)).status).toBe(400);
		expect((await redeem(code, verifier)).status).toBe(400);
	});

	test("rejects an unknown code", async () => {
		expect(
			(await redeem(randomBytes(32).toString("base64url"), pkce().verifier))
				.status,
		).toBe(400);
	});

	test("rejects a malformed challenge", async () => {
		const res = await app.request("/keys/cli-code", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({
				description: "OpenCode (CLI)",
				projectId: "test-project-id",
				codeChallenge: "plain",
			}),
		});
		expect(res.status).toBe(400);
		expect(
			await db.query.apiKey.findMany({
				where: { projectId: { eq: "test-project-id" } },
			}),
		).toHaveLength(0);
	});
});
