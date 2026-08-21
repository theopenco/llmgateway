import { expect, test, beforeEach, describe, afterEach, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { decryptProviderKey, validateProviderKey } from "@llmgateway/actions";
import {
	redisClient,
	SWR_PREFIX,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import { and, asc, cdb, db, eq, getTableName, tables } from "@llmgateway/db";
import { getProviderModelIds } from "@llmgateway/shared";

import type * as ActionsModule from "@llmgateway/actions";

// Validation is skipped in the test env, so the only way to exercise the
// upstream-failure branches is to stand in for the validator. Delegates to the
// real implementation unless a test overrides it, keeping every other case on
// the normal path.
vi.mock("@llmgateway/actions", async (importOriginal) => {
	const actual = await importOriginal<typeof ActionsModule>();
	return { ...actual, validateProviderKey: vi.fn(actual.validateProviderKey) };
});

describe("provider keys route", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		// Create test organization
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "pro",
		});

		// Associate user with organization
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		// Create test project
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		// Create test provider key
		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: "test-org-id",
		});
	});

	test("GET /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider");
		expect(res.status).toBe(401);
	});

	test("POST /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				provider: "openai",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("DELETE /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});

	test("PATCH /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("GET /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKeys");
		expect(json.providerKeys.length).toBe(1);
		expect(json.providerKeys[0].provider).toBe("openai");
	});

	test("POST /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "inference.net",
				token: "inference-test-token",
				organizationId: "test-org-id",
				description: "Production inference",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.provider).toBe("inference.net");
		expect(json.providerKey.description).toBe("Production inference");
		expect(json.providerKey.maskedToken).toBeDefined();
		expect(json.providerKey.maskedToken).toContain("•");
		expect(json.providerKey.token).toBeUndefined();
		// Response must never expose the ciphertext column either.
		expect(json.providerKey.tokenCiphertext).toBeUndefined();
		expect(json.providerKey.tokenMasked).toBeUndefined();

		// Verify the key was created in the database AND that the plaintext
		// was never persisted — only the ciphertext + masked form should remain.
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "inference.net",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.provider).toBe("inference.net");
		// Asserting the legacy plaintext column stays NULL is the whole point of
		// this test, so it is one of the few places allowed to read it directly.
		// eslint-disable-next-line no-restricted-syntax
		expect(providerKey?.token).toBeNull();
		expect(providerKey?.tokenCiphertext).toMatch(/^llmgw:v2:/);
		expect(providerKey?.tokenMasked).toBeTruthy();
		expect(providerKey?.tokenMasked).not.toBe("inference-test-token");
	});

	test("POST /keys/provider AAD binds ciphertext to row id + organization", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "inference.net",
				token: "aad-bound-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);

		const row = await db.query.providerKey.findFirst({
			where: { provider: { eq: "inference.net" } },
		});
		expect(row?.tokenCiphertext).toMatch(/^llmgw:v2:/);

		// Correct row id + org → decrypts.
		expect(
			decryptProviderKey(row!.tokenCiphertext!, row!.id, row!.organizationId!),
		).toBe("aad-bound-token");

		// Tampered row id → throws (cross-row copy fails).
		expect(() =>
			decryptProviderKey(
				row!.tokenCiphertext!,
				"different-row-id",
				row!.organizationId!,
			),
		).toThrow();

		// Tampered organization id → throws (cross-org copy fails).
		expect(() =>
			decryptProviderKey(row!.tokenCiphertext!, row!.id, "different-org"),
		).toThrow();
	});

	test("provider_key CHECK constraint rejects rows with both token and tokenCiphertext", async () => {
		await expect(
			db.insert(tables.providerKey).values({
				id: "test-bad-shape",
				token: "plaintext-here",
				tokenCiphertext: "llmgw:v1:should-not-coexist:::",
				provider: "openai",
				organizationId: "test-org-id",
			}),
		).rejects.toThrow();
	});

	test("provider_key CHECK constraint rejects rows with neither token form", async () => {
		// A row readProviderKey could never resolve must not be storable.
		await expect(
			db.insert(tables.providerKey).values({
				id: "test-tokenless-shape",
				provider: "openai",
				organizationId: "test-org-id",
			}),
		).rejects.toThrow();
	});

	test("POST /keys/provider rejects token with non-ASCII characters", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: "sk-realprefix••••••••",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	describe("POST /keys/provider workspace-scoped regions", () => {
		const postAlibabaKey = (options: Record<string, string>) =>
			app.request("/keys/provider", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({
					provider: "alibaba",
					token: "sk-alibaba-test-key",
					organizationId: "test-org-id",
					options,
				}),
			});

		// Frankfurt reaches a shared entry point without one, so the workspace id
		// is an upgrade rather than a requirement.
		test("accepts eu-frankfurt without a workspace id", async () => {
			const res = await postAlibabaKey({ alibaba_region: "eu-frankfurt" });
			expect(res.status).not.toBe(400);
		});

		test("rejects a workspace id that is not a bare hostname label", async () => {
			const res = await postAlibabaKey({
				alibaba_region: "eu-frankfurt",
				alibaba_workspace_id: "evil.example.com/x",
			});
			expect(res.status).toBe(400);
		});

		test("accepts regions served by a shared host without a workspace id", async () => {
			const res = await postAlibabaKey({ alibaba_region: "singapore" });
			expect(res.status).not.toBe(400);
		});
	});

	test("POST /keys/provider with invalid provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "invalid-provider",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	describe("POST /keys/provider upstream validation failures", () => {
		// A provider can answer 401 for a key that is perfectly valid but not
		// entitled to the validation model — AWS Bedrock does exactly this. The
		// response must carry that reason instead of a generic "invalid key",
		// which would send the user chasing the wrong problem.
		test("surfaces the provider reason behind a 401", async () => {
			const reason =
				"openai.gpt-5.6-luna is not available for this account. You can explore other available models on Amazon Bedrock.";
			vi.mocked(validateProviderKey).mockResolvedValueOnce({
				valid: false,
				statusCode: 401,
				model: "gpt-5.6-luna",
				error: reason,
			});

			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					provider: "aws-mantle",
					token: "ABSKtest",
					organizationId: "test-org-id",
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain(reason);
			expect(json.message).toContain("aws-mantle");
			expect(json.message).toContain("gpt-5.6-luna");
			expect(json.message).toContain("status 401");
			// The old generic wording is what this fix removes.
			expect(json.message).not.toContain("Invalid API key");
			// A 401 never resolves by waiting, so it must not advise retrying.
			expect(json.message).not.toContain("try again later");

			const stored = await db.query.providerKey.findFirst({
				where: { provider: { eq: "aws-mantle" } },
			});
			expect(stored).toBeUndefined();
		});

		test("keeps the retryable wording for non-401 upstream errors", async () => {
			vi.mocked(validateProviderKey).mockResolvedValueOnce({
				valid: false,
				statusCode: 429,
				model: "gpt-4o-mini",
				error: "Rate limit exceeded",
			});

			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					provider: "inference.net",
					token: "inference-test-token",
					organizationId: "test-org-id",
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain("Rate limit exceeded");
			expect(json.message).toContain("status 429");
			expect(json.message).toContain("try again later");
		});

		// A host that does not resolve (a mistyped Azure resource name, a custom
		// base URL pointing nowhere) means the key was never judged at all, so
		// the response must not claim the provider rejected it.
		test("reports an unreachable endpoint as such", async () => {
			vi.mocked(validateProviderKey).mockResolvedValueOnce({
				valid: false,
				model: "gpt-5.6-sol",
				unreachable: true,
				error:
					"Could not resolve typo.openai.azure.com (DNS lookup failed: ENOTFOUND). Check the base URL / resource name configured for this credential.",
			});

			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					provider: "azure",
					token: "azure-test-token",
					organizationId: "test-org-id",
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain("Could not reach provider azure");
			expect(json.message).toContain("typo.openai.azure.com");
			expect(json.message).not.toContain("rejected the key");
			expect(json.message).not.toContain("Invalid API key");
			// "fetch failed" is exactly the useless wording this replaces.
			expect(json.message).not.toContain("fetch failed");

			const stored = await db.query.providerKey.findFirst({
				where: { provider: { eq: "azure" } },
			});
			expect(stored).toBeUndefined();
		});
	});

	test("POST /keys/provider rejects stealth providers", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "granite",
				token: "granite-test-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain("cannot be configured with a provider key");

		// Verify no key was created
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "granite",
				},
			},
		});
		expect(providerKey).toBeUndefined();
	});

	test("POST /keys/provider with duplicate provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: "test-provider-token-2",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);

		const providerKeys = await db.query.providerKey.findMany({
			where: {
				provider: {
					eq: "openai",
				},
			},
		});
		expect(providerKeys).toHaveLength(2);
	});

	test("POST /keys/provider rejects duplicate custom provider names", async () => {
		await db.insert(tables.providerKey).values({
			id: "test-custom-provider-key-id",
			token: "test-custom-provider-token",
			provider: "custom",
			name: "mycustomprovider",
			baseUrl: "https://example.com",
			organizationId: "test-org-id",
		});

		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "custom",
				token: "test-custom-provider-token-2",
				name: "mycustomprovider",
				baseUrl: "https://example-2.com",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("PATCH /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.status).toBe("inactive");

		// Verify the key was updated in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("inactive");
	});

	test("PATCH /keys/provider/{id} updates its description", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ description: "Batch jobs" }),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.providerKey.description).toBe("Batch jobs");

		const providerKey = await db.query.providerKey.findFirst({
			where: { id: { eq: "test-provider-key-id" } },
		});
		expect(providerKey?.description).toBe("Batch jobs");
	});

	describe("spend limits", () => {
		async function patchKey(body: Record<string, unknown>) {
			return await app.request("/keys/provider/test-provider-key-id", {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify(body),
			});
		}

		test("POST /keys/provider stores an optional spend limit", async () => {
			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({
					provider: "inference.net",
					token: "inference-test-token",
					organizationId: "test-org-id",
					usageLimit: "25.50",
				}),
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.providerKey.usageLimit).toBe("25.50");
			expect(Number(json.providerKey.usage)).toBe(0);
		});

		test("POST /keys/provider rejects a malformed spend limit", async () => {
			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({
					provider: "inference.net",
					token: "inference-test-token",
					organizationId: "test-org-id",
					usageLimit: "not-a-number",
				}),
			});
			expect(res.status).toBe(400);
		});

		test("PATCH sets and clears the spend limit", async () => {
			const set = await patchKey({ usageLimit: "10" });
			expect(set.status).toBe(200);
			expect((await set.json()).providerKey.usageLimit).toBe("10");

			const clear = await patchKey({ usageLimit: null });
			expect(clear.status).toBe(200);
			expect((await clear.json()).providerKey.usageLimit).toBeNull();
		});

		test("refuses to re-enable a key still at its spend limit", async () => {
			// Simulate the worker's auto-deactivation at the cap.
			await db
				.update(tables.providerKey)
				.set({ usageLimit: "5", usage: "5.10", status: "inactive" })
				.where(eq(tables.providerKey.id, "test-provider-key-id"));

			const rejected = await patchKey({ status: "active" });
			expect(rejected.status).toBe(400);
			expect(await rejected.text()).toContain("spend limit");

			// Raising the limit in the same request is the intended path back.
			const raised = await patchKey({ status: "active", usageLimit: "50" });
			expect(raised.status).toBe(200);
			const json = await raised.json();
			expect(json.providerKey.status).toBe("active");
			expect(json.providerKey.usageLimit).toBe("50");
		});
	});

	describe("allowed models", () => {
		// Taken from the catalogue rather than hardcoded so the assertions do not
		// rot when a model is retired.
		const openaiModels = getProviderModelIds("openai");

		async function createKey(body: Record<string, unknown>) {
			return await app.request("/keys/provider", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					provider: "openai",
					token: "sk-restricted",
					organizationId: "test-org-id",
					...body,
				}),
			});
		}

		async function patchKey(body: Record<string, unknown>) {
			return await app.request("/keys/provider/test-provider-key-id", {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify(body),
			});
		}

		test("stores a normalized list on create and returns it", async () => {
			const [first, second] = openaiModels;
			const res = await createKey({
				allowedModels: [` ${first} `, second, first, ""],
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.providerKey.allowedModels).toEqual([first, second]);

			const stored = await db.query.providerKey.findFirst({
				where: { id: { eq: json.providerKey.id } },
			});
			expect(stored?.allowedModels).toEqual([first, second]);
		});

		test("treats an empty list as no restriction", async () => {
			const res = await createKey({ allowedModels: [] });
			expect(res.status).toBe(200);
			expect((await res.json()).providerKey.allowedModels).toBeNull();
		});

		test("rejects a model the provider does not serve", async () => {
			const res = await createKey({
				allowedModels: ["definitely-not-a-model"],
			});
			expect(res.status).toBe(400);
			expect(await res.text()).toContain("definitely-not-a-model");
		});

		test("validates the key against one of its own allowed models", async () => {
			const validate = vi.mocked(validateProviderKey);
			validate.mockClear();

			const res = await createKey({ allowedModels: [openaiModels[0]] });
			expect(res.status).toBe(200);
			// Sixth argument is the pinned model: a restricted key must not be
			// probed with the provider's default validation model, which the
			// upstream account may not have.
			expect(validate.mock.calls[0]?.[5]).toBe(openaiModels[0]);
		});

		test("rejects allowed models on a custom provider key", async () => {
			const res = await createKey({
				provider: "custom",
				name: "myprovider",
				baseUrl: "https://api.example.com",
				allowedModels: [openaiModels[0]],
			});
			expect(res.status).toBe(400);
			expect(await res.text()).toContain("custom provider keys");
		});

		test("PATCH sets, lists and clears the restriction", async () => {
			const set = await patchKey({ allowedModels: [openaiModels[0]] });
			expect(set.status).toBe(200);
			expect((await set.json()).providerKey.allowedModels).toEqual([
				openaiModels[0],
			]);

			const listed = await app.request("/keys/provider", {
				headers: { Cookie: token },
			});
			const listJson = await listed.json();
			expect(
				listJson.providerKeys.find(
					(key: { id: string }) => key.id === "test-provider-key-id",
				).allowedModels,
			).toEqual([openaiModels[0]]);

			const clear = await patchKey({ allowedModels: null });
			expect(clear.status).toBe(200);
			expect((await clear.json()).providerKey.allowedModels).toBeNull();
		});

		test("PATCH rejects a model the provider does not serve", async () => {
			const res = await patchKey({ allowedModels: ["not-an-openai-model"] });
			expect(res.status).toBe(400);
			expect(await res.text()).toContain("not-an-openai-model");
		});

		test("PATCH audits the change", async () => {
			const res = await patchKey({ allowedModels: [openaiModels[0]] });
			expect(res.status).toBe(200);

			const entry = await db.query.auditLog.findFirst({
				where: {
					resourceId: { eq: "test-provider-key-id" },
					action: { eq: "provider_key.update" },
				},
			});
			expect(
				(
					entry?.metadata as {
						changes?: { allowedModels?: { new: string[] } };
					}
				)?.changes?.allowedModels?.new,
			).toEqual([openaiModels[0]]);
		});
	});

	test("DELETE /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json.message).toBe("Provider key deleted successfully");

		// Verify the key was soft-deleted in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("deleted");
	});

	describe("PATCH /keys/provider/{id} complianceAttestation", () => {
		async function seedCustomKey(plan: "pro" | "enterprise" = "enterprise") {
			await db
				.update(tables.organization)
				.set({ plan })
				.where(eq(tables.organization.id, "test-org-id"));
			await db.insert(tables.providerKey).values({
				id: "test-custom-key-id",
				token: "test-custom-token",
				provider: "custom",
				name: "mycustom",
				baseUrl: "https://example.com",
				organizationId: "test-org-id",
			});
		}

		async function patchAttestation(
			id: string,
			complianceAttestation: unknown,
		) {
			return await app.request(`/keys/provider/${id}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({ complianceAttestation }),
			});
		}

		test("rejects attestation on a non-custom key", async () => {
			await db
				.update(tables.organization)
				.set({ plan: "enterprise" })
				.where(eq(tables.organization.id, "test-org-id"));

			const res = await patchAttestation("test-provider-key-id", { soc2: 2 });
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain(
				"complianceAttestation can only be set on custom provider keys",
			);
		});

		test("rejects attestation for non-enterprise organizations", async () => {
			await seedCustomKey("pro");

			const res = await patchAttestation("test-custom-key-id", { soc2: 2 });
			expect(res.status).toBe(403);
			const json = await res.json();
			expect(json.message).toContain("enterprise plan");
		});

		test("stores server-side provenance and ignores client-supplied attestedByUserId", async () => {
			await seedCustomKey();

			const res = await patchAttestation("test-custom-key-id", {
				soc2: 2,
				apiTraining: false,
				headquarters: "US",
				attestedByUserId: "forged-user-id",
				attestedAt: "1999-01-01T00:00:00.000Z",
			});
			expect(res.status).toBe(200);

			const providerKey = await db.query.providerKey.findFirst({
				where: { id: { eq: "test-custom-key-id" } },
			});
			expect(providerKey?.complianceAttestation).toMatchObject({
				soc2: 2,
				apiTraining: false,
				headquarters: "US",
				attestedByUserId: "test-user-id",
			});
			expect(providerKey?.complianceAttestation?.attestedAt).not.toBe(
				"1999-01-01T00:00:00.000Z",
			);
			expect(
				new Date(providerKey!.complianceAttestation!.attestedAt!).getTime(),
			).toBeGreaterThan(Date.now() - 60_000);
		});

		test("null clears the attestation", async () => {
			await seedCustomKey();

			const set = await patchAttestation("test-custom-key-id", { soc2: 1 });
			expect(set.status).toBe(200);

			const clear = await patchAttestation("test-custom-key-id", null);
			expect(clear.status).toBe(200);

			const providerKey = await db.query.providerKey.findFirst({
				where: { id: { eq: "test-custom-key-id" } },
			});
			expect(providerKey?.complianceAttestation).toBeNull();
		});

		test("writes an audit log entry with old and new values", async () => {
			await seedCustomKey();

			const res = await patchAttestation("test-custom-key-id", { soc2: 2 });
			expect(res.status).toBe(200);

			const entries = await db.query.auditLog.findMany({
				where: {
					organizationId: { eq: "test-org-id" },
					action: { eq: "provider_key.update" },
				},
			});
			const entry = entries.find(
				(e) =>
					(
						e.metadata as {
							changes?: Record<string, { old: unknown; new: unknown }>;
						}
					)?.changes?.complianceAttestation,
			);
			expect(entry).toBeDefined();
			const change = (
				entry!.metadata as {
					changes: Record<string, { old: unknown; new: unknown }>;
				}
			).changes.complianceAttestation;
			expect(change.old).toBeNull();
			expect(change.new).toMatchObject({
				soc2: 2,
				attestedByUserId: "test-user-id",
			});
		});

		test("rejects invalid headquarters country codes", async () => {
			await seedCustomKey();

			for (const headquarters of ["USA", "us"]) {
				const res = await patchAttestation("test-custom-key-id", {
					headquarters,
				});
				expect(res.status).toBe(400);
			}
		});
	});

	describe("PATCH /keys/provider/{id} rename", () => {
		async function seedCustomKey(id = "test-custom-key-id", name = "mycustom") {
			await db.insert(tables.providerKey).values({
				id,
				token: "test-custom-token",
				provider: "custom",
				name,
				baseUrl: "https://example.com",
				organizationId: "test-org-id",
			});
		}

		async function patchName(id: string, name: string) {
			return await app.request(`/keys/provider/${id}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({ name }),
			});
		}

		test("renames a custom provider key", async () => {
			await seedCustomKey();

			const res = await patchName("test-custom-key-id", "renamed-provider");
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.providerKey.name).toBe("renamed-provider");

			const providerKey = await db.query.providerKey.findFirst({
				where: { id: { eq: "test-custom-key-id" } },
			});
			expect(providerKey?.name).toBe("renamed-provider");
		});

		test("rejects rename on a non-custom key", async () => {
			const res = await patchName("test-provider-key-id", "somename");
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain(
				"name can only be changed on custom provider keys",
			);
		});

		test("rejects a name already used by another custom provider", async () => {
			await seedCustomKey();
			await seedCustomKey("test-custom-key-id-two", "othercustom");

			const res = await patchName("test-custom-key-id", "othercustom");
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.message).toContain(
				"A custom provider named 'othercustom' already exists",
			);
		});

		test("allows resubmitting the current name", async () => {
			await seedCustomKey();

			const res = await patchName("test-custom-key-id", "mycustom");
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.providerKey.name).toBe("mycustom");
		});

		test("allows reusing the name of a soft-deleted custom provider", async () => {
			await seedCustomKey();
			await db.insert(tables.providerKey).values({
				id: "test-custom-key-deleted",
				token: "test-custom-token-two",
				provider: "custom",
				name: "freedname",
				baseUrl: "https://example.com",
				organizationId: "test-org-id",
				status: "deleted",
			});

			const res = await patchName("test-custom-key-id", "freedname");
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.providerKey.name).toBe("freedname");
		});

		test("rejects invalid name formats", async () => {
			await seedCustomKey();

			for (const name of ["My-Provider", "my_provider", "-my-provider", ""]) {
				const res = await patchName("test-custom-key-id", name);
				expect(res.status).toBe(400);
			}
		});

		test("writes an audit log entry with old and new name", async () => {
			await seedCustomKey();

			const res = await patchName("test-custom-key-id", "renamed-provider");
			expect(res.status).toBe(200);

			const entries = await db.query.auditLog.findMany({
				where: {
					organizationId: { eq: "test-org-id" },
					action: { eq: "provider_key.update" },
				},
			});
			const entry = entries.find(
				(e) =>
					(
						e.metadata as {
							changes?: Record<string, { old: unknown; new: unknown }>;
						}
					)?.changes?.name,
			);
			expect(entry).toBeDefined();
			const change = (
				entry!.metadata as {
					changes: Record<string, { old: unknown; new: unknown }>;
				}
			).changes.name;
			expect(change.old).toBe("mycustom");
			expect(change.new).toBe("renamed-provider");
		});
	});

	// The gateway resolves provider keys through a cached select (cdb) wrapped
	// in an SWR fallback mirror, both indexed by the provider_key table (see
	// apps/gateway/src/lib/cached-queries.ts). Mutations must go through cdb so
	// its onMutate busts both layers; otherwise the gateway serves stale keys
	// until the cache TTL expires.
	//
	// Each test uses its own org so the cache keys (SWR key and Drizzle query
	// hash, which includes the bind params) are unique per run — cached entries
	// in Redis outlive deleteAll() and would otherwise leak between runs.
	async function createCacheTestOrg() {
		const orgId = `cache-test-org-${crypto.randomUUID()}`;
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Cache Test Organization",
			billingEmail: "cache-test@example.com",
			plan: "pro",
		});
		await db.insert(tables.userOrganization).values({
			id: `${orgId}-membership`,
			userId: "test-user-id",
			organizationId: orgId,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: `${orgId}-project`,
			name: "Cache Test Project",
			organizationId: orgId,
		});
		return orgId;
	}

	async function readActiveProviderKeys(orgId: string, provider: string) {
		const keys = await swrWrap(
			`providerKey:${orgId}:${provider}`,
			[getTableName(tables.providerKey)],
			async () =>
				await cdb
					.select()
					.from(tables.providerKey)
					.where(
						and(
							eq(tables.providerKey.status, "active"),
							eq(tables.providerKey.organizationId, orgId),
							eq(tables.providerKey.provider, provider),
						),
					),
		);
		await waitForSwrMirrorWrites();
		return keys;
	}

	test("POST /keys/provider makes the new key visible to cached lookups", async () => {
		const orgId = await createCacheTestOrg();

		// Prime both cache layers with the "no key" result.
		expect(await readActiveProviderKeys(orgId, "anthropic")).toHaveLength(0);
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:anthropic`),
		).not.toBeNull();

		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "anthropic",
				token: "anthropic-test-token",
				organizationId: orgId,
			}),
		});
		expect(res.status).toBe(200);

		// The SWR mirror for the provider_key table must be gone...
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:anthropic`),
		).toBeNull();
		// ...and the cached select must serve the new key, not the stale miss.
		expect(await readActiveProviderKeys(orgId, "anthropic")).toHaveLength(1);
	});

	test("PATCH /keys/provider/{id} busts cached lookups of the key", async () => {
		const orgId = await createCacheTestOrg();
		await db.insert(tables.providerKey).values({
			id: `${orgId}-provider-key`,
			token: "cache-test-provider-token",
			provider: "openai",
			organizationId: orgId,
		});

		// Prime both cache layers with the key still active.
		expect(await readActiveProviderKeys(orgId, "openai")).toHaveLength(1);
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:openai`),
		).not.toBeNull();

		const res = await app.request(`/keys/provider/${orgId}-provider-key`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(200);

		// The SWR mirror for the provider_key table must be gone...
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:openai`),
		).toBeNull();
		// ...and the cached select must reflect the deactivation immediately.
		expect(await readActiveProviderKeys(orgId, "openai")).toHaveLength(0);
	});

	/**
	 * Order decides which key the gateway prefers: it tries index 0 first and
	 * only moves off it when that key is unhealthy.
	 */
	describe("PUT /keys/provider/order", () => {
		// The suite's beforeEach seeds "test-provider-key-id" for test-org-id, and
		// the endpoint requires the complete set for a scope, so cases against
		// that org drop it first rather than having to list it every time.
		async function seedKeys(orgId: string, ids: string[]) {
			if (orgId === "test-org-id") {
				await db
					.delete(tables.providerKey)
					.where(eq(tables.providerKey.id, "test-provider-key-id"));
			}
			for (const id of ids) {
				await db.insert(tables.providerKey).values({
					id,
					token: `token-${id}`,
					provider: "openai",
					organizationId: orgId,
					status: "active",
				});
			}
		}

		async function reorder(body: Record<string, unknown>, cookie = token) {
			return await app.request("/keys/provider/order", {
				method: "PUT",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		}

		// Mirrors the gateway's findProviderKey exactly — same SWR key, same
		// ORDER BY — so the assertion is about the order the gateway would
		// actually serve, not just about row presence.
		async function readGatewayOrder(orgId: string) {
			const keys = await swrWrap(
				`providerKey:${orgId}:openai`,
				[getTableName(tables.providerKey)],
				async () =>
					await cdb
						.select()
						.from(tables.providerKey)
						.where(
							and(
								eq(tables.providerKey.status, "active"),
								eq(tables.providerKey.organizationId, orgId),
								eq(tables.providerKey.provider, "openai"),
							),
						)
						.orderBy(
							asc(tables.providerKey.sortOrder),
							asc(tables.providerKey.createdAt),
							asc(tables.providerKey.id),
						),
			);
			await waitForSwrMirrorWrites();
			return keys.map((key) => key.id);
		}

		async function storedOrder(orgId: string) {
			const rows = await db.query.providerKey.findMany({
				where: { organizationId: { eq: orgId }, provider: { eq: "openai" } },
			});
			return (
				rows
					.slice()
					// id tiebreak: the rejection cases assert every key is still
					// unpositioned, so every sortOrder is null and the numeric compare
					// returns 0 for every pair. Without it the assertion depends on
					// Postgres heap order.
					.sort(
						(a, b) =>
							(a.sortOrder ?? 99) - (b.sortOrder ?? 99) ||
							a.id.localeCompare(b.id),
					)
					.map((row) => [row.id, row.sortOrder] as const)
			);
		}

		test("requires authentication", async () => {
			const res = await app.request("/keys/provider/order", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					organizationId: "test-org-id",
					provider: "openai",
					providerKeyIds: ["a"],
				}),
			});
			expect(res.status).toBe(401);
		});

		test("persists the submitted order and serves it from the list", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b", "key-c"]);

			const res = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-c", "key-a", "key-b"],
			});
			expect(res.status).toBe(200);

			expect(await storedOrder("test-org-id")).toEqual([
				["key-c", 0],
				["key-a", 1],
				["key-b", 2],
			]);

			const listed = await app.request("/keys/provider", {
				headers: { Cookie: token },
			});
			const json = (await listed.json()) as {
				providerKeys: { id: string; provider: string }[];
			};
			expect(
				json.providerKeys
					.filter((key) => key.provider === "openai")
					.map((key) => key.id),
			).toEqual(["key-c", "key-a", "key-b"]);
		});

		test("rejects duplicate ids without writing", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b"]);

			const res = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-a", "key-a"],
			});
			expect(res.status).toBe(400);
			expect(await storedOrder("test-org-id")).toEqual([
				["key-a", null],
				["key-b", null],
			]);
		});

		test("rejects an out-of-date list without writing", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b", "key-c"]);

			const res = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-b", "key-a"],
			});
			expect(res.status).toBe(409);
			// Validate-before-write: a rejection must leave every position alone.
			expect(await storedOrder("test-org-id")).toEqual([
				["key-a", null],
				["key-b", null],
				["key-c", null],
			]);
		});

		test("hides another organization's keys behind the same 404 as an unknown id", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b"]);
			await db.insert(tables.organization).values({
				id: "other-org-id",
				name: "Other Organization",
				billingEmail: "other@example.com",
				plan: "pro",
			});
			await db.insert(tables.providerKey).values({
				id: "other-org-key",
				token: "token-other",
				provider: "openai",
				organizationId: "other-org-id",
				status: "active",
			});

			const foreign = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-a", "other-org-key"],
			});
			const unknown = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-a", "does-not-exist"],
			});

			expect(foreign.status).toBe(404);
			expect(unknown.status).toBe(404);
			// Identical wording, so a probe cannot distinguish the two.
			expect(await foreign.text()).toBe(await unknown.text());

			const otherRow = await db.query.providerKey.findFirst({
				where: { id: { eq: "other-org-key" } },
			});
			expect(otherRow?.sortOrder).toBeNull();
		});

		test("refuses an organization the caller does not administer", async () => {
			await db.insert(tables.organization).values({
				id: "unrelated-org-id",
				name: "Unrelated Organization",
				billingEmail: "unrelated@example.com",
				plan: "pro",
			});
			await db.insert(tables.providerKey).values({
				id: "unrelated-key",
				token: "token-unrelated",
				provider: "openai",
				organizationId: "unrelated-org-id",
				status: "active",
			});

			const res = await reorder({
				organizationId: "unrelated-org-id",
				provider: "openai",
				providerKeyIds: ["unrelated-key"],
			});
			expect(res.status).toBe(404);
		});

		test("excludes deleted keys and keeps inactive ones orderable", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b"]);
			await db.insert(tables.providerKey).values({
				id: "key-gone",
				token: "token-gone",
				provider: "openai",
				organizationId: "test-org-id",
				status: "deleted",
			});
			await cdb
				.update(tables.providerKey)
				.set({ status: "inactive" })
				.where(eq(tables.providerKey.id, "key-b"));

			// A deleted key is neither required...
			const ok = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-b", "key-a"],
			});
			expect(ok.status).toBe(200);

			// ...nor accepted.
			const withDeleted = await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-b", "key-a", "key-gone"],
			});
			expect(withDeleted.status).toBe(404);
		});

		test("audits a real change once and skips a no-op resubmit", async () => {
			await seedKeys("test-org-id", ["key-a", "key-b"]);

			await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-b", "key-a"],
			});
			await reorder({
				organizationId: "test-org-id",
				provider: "openai",
				providerKeyIds: ["key-b", "key-a"],
			});

			const events = await db.query.auditLog.findMany({
				where: { action: { eq: "provider_key.reorder" } },
			});
			expect(events).toHaveLength(1);
			const changes = events[0].metadata?.changes as
				{ order?: { new?: string[] } } | undefined;
			expect(changes?.order?.new).toEqual(["key-b", "key-a"]);
		});

		test("busts the gateway's cached order", async () => {
			const orgId = await createCacheTestOrg();
			await seedKeys(orgId, ["cache-key-a", "cache-key-b"]);

			// Prime both cache layers with the pre-reorder order.
			expect(await readGatewayOrder(orgId)).toEqual([
				"cache-key-a",
				"cache-key-b",
			]);

			const res = await reorder({
				organizationId: orgId,
				provider: "openai",
				providerKeyIds: ["cache-key-b", "cache-key-a"],
			});
			expect(res.status).toBe(200);

			// Written through cdb, so both layers were invalidated and the gateway
			// sees the new primary immediately rather than after the cache TTL.
			expect(await readGatewayOrder(orgId)).toEqual([
				"cache-key-b",
				"cache-key-a",
			]);
		});
	});
});
