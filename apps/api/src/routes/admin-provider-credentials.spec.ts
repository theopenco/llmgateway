import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { decryptProviderKey } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";

interface Credential {
	id: string;
	provider: string;
	comment: string | null;
	variant: string;
	region: string | null;
	status: string | null;
	config: Record<string, string>;
	maskedToken: string;
}

describe("admin provider credentials", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	async function create(body: Record<string, unknown>) {
		return await app.request("/admin/provider-credentials", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	async function list(): Promise<Credential[]> {
		const res = await app.request("/admin/provider-credentials", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { credentials: Credential[] };
		return json.credentials;
	}

	test("requires authentication", async () => {
		const res = await app.request("/admin/provider-credentials");
		expect(res.status).toBe(401);
	});

	test("creates a managed credential with no owning organization", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-managed-token-value",
			comment: "primary billing account",
		});
		expect(res.status).toBe(201);

		const credentials = await list();
		expect(credentials).toHaveLength(1);
		expect(credentials[0].provider).toBe("openai");
		expect(credentials[0].comment).toBe("primary billing account");
		expect(credentials[0].variant).toBe("default");

		const row = await db.query.providerKey.findFirst({
			where: { id: { eq: credentials[0].id } },
		});
		expect(row?.managed).toBe(true);
		expect(row?.organizationId).toBeNull();
		expect(row?.token).toBeNull();
	});

	test("never returns the plaintext token", async () => {
		await create({ provider: "openai", token: "sk-secret-value-here" });

		const res = await app.request("/admin/provider-credentials", {
			headers: { Cookie: cookie },
		});
		const body = await res.text();
		expect(body).not.toContain("sk-secret-value-here");
	});

	test("encrypts the token under the managed scope", async () => {
		await create({ provider: "openai", token: "sk-encrypt-me" });

		const [row] = await db.query.providerKey.findMany({
			where: { managed: { eq: true } },
		});
		expect(row.tokenCiphertext).toMatch(/^llmgw:v1:/);
		expect(
			decryptProviderKey(row.tokenCiphertext!, row.id, "llmgateway:managed"),
		).toBe("sk-encrypt-me");
		// The managed scope is not interchangeable with an organization scope.
		expect(() =>
			decryptProviderKey(row.tokenCiphertext!, row.id, "some-org-id"),
		).toThrow();
	});

	test("rejects a provider whose required settings are missing", async () => {
		const res = await create({
			provider: "google-vertex",
			token: "vertex-key",
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("project");
	});

	test("accepts a provider once its required settings are supplied", async () => {
		const res = await create({
			provider: "google-vertex",
			token: "vertex-key",
			config: { project: "my-gcp-project", region: "us-central1" },
		});
		expect(res.status).toBe(201);

		const credentials = await list();
		expect(credentials[0].config).toEqual({
			project: "my-gcp-project",
			region: "us-central1",
		});
	});

	test("rejects settings the provider does not declare", async () => {
		const res = await create({
			provider: "anthropic",
			token: "anthropic-key",
			config: { projeckt: "typo" },
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("projeckt");
	});

	test("rejects an unknown provider", async () => {
		const res = await create({ provider: "not-a-provider", token: "x" });
		expect(res.status).toBe(400);
	});

	test("supports several credentials for the same provider", async () => {
		await create({
			provider: "openai",
			token: "sk-one",
			comment: "account one",
		});
		await create({
			provider: "openai",
			token: "sk-two",
			comment: "account two",
			variant: "enterprise",
		});

		const credentials = await list();
		expect(credentials).toHaveLength(2);
		expect(credentials.map((c) => c.comment).sort()).toEqual([
			"account one",
			"account two",
		]);
	});

	test("updates the note, variant and settings", async () => {
		await create({
			provider: "google-vertex",
			token: "vertex-key",
			config: { project: "old-project" },
		});
		const [credential] = await list();

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					comment: "moved to the new project",
					variant: "plans",
					config: { project: "new-project" },
				}),
			},
		);
		expect(res.status).toBe(200);

		const [updated] = await list();
		expect(updated.comment).toBe("moved to the new project");
		expect(updated.variant).toBe("plans");
		expect(updated.config).toEqual({ project: "new-project" });
	});

	test("rotates the token without touching the rest", async () => {
		await create({ provider: "openai", token: "sk-old", comment: "keep me" });
		const [credential] = await list();

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ token: "sk-new-rotated" }),
			},
		);
		expect(res.status).toBe(200);

		const row = await db.query.providerKey.findFirst({
			where: { id: { eq: credential.id } },
		});
		expect(
			decryptProviderKey(row!.tokenCiphertext!, row!.id, "llmgateway:managed"),
		).toBe("sk-new-rotated");
		expect(row?.comment).toBe("keep me");
	});

	test("rejects an update that would leave a required setting unset", async () => {
		await create({
			provider: "google-vertex",
			token: "vertex-key",
			config: { project: "my-project" },
		});
		const [credential] = await list();

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ config: {} }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("soft-deletes so log attribution survives", async () => {
		await create({ provider: "openai", token: "sk-delete-me" });
		const [credential] = await list();

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{ method: "DELETE", headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);

		expect(await list()).toHaveLength(0);
		const row = await db.query.providerKey.findFirst({
			where: { id: { eq: credential.id } },
		});
		expect(row?.status).toBe("deleted");
	});

	test("does not manage organization-owned provider keys", async () => {
		await db.insert(tables.organization).values({
			id: "byok-org",
			name: "BYOK Org",
			billingEmail: "byok@example.com",
			plan: "pro",
		});
		await db.insert(tables.providerKey).values({
			id: "byok-key",
			token: "sk-byok",
			provider: "openai",
			organizationId: "byok-org",
		});

		expect(await list()).toHaveLength(0);

		const res = await app.request("/admin/provider-credentials/byok-key", {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(404);
	});

	test("catalog exposes each provider's settings", async () => {
		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			providers: {
				id: string;
				apiKeyEnvCounts: {
					default: number;
					enterprise: number;
					plans: number;
				};
				configKeys: { key: string; envVar: string; required: boolean }[];
			}[];
		};

		const vertex = json.providers.find((p) => p.id === "google-vertex");
		expect(vertex?.configKeys).toContainEqual({
			key: "project",
			envVar: "LLM_GOOGLE_CLOUD_PROJECT",
			required: true,
		});
		expect(vertex?.configKeys.map((k) => k.key)).not.toContain("apiKey");
		expect(json.providers.some((p) => p.id === "custom")).toBe(false);
	});

	test("catalog reports env-var key counts per audience", async () => {
		vi.stubEnv("LLM_ALIBABA_API_KEY", "key-a,key-b");
		vi.stubEnv("LLM_ALIBABA_API_KEY__ENTERPRISE", "ent-key");
		vi.stubEnv("LLM_ALIBABA_API_KEY__PLANS", "");

		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			providers: {
				id: string;
				apiKeyEnvCounts: {
					default: number;
					enterprise: number;
					plans: number;
				};
			}[];
		};

		const alibaba = json.providers.find((p) => p.id === "alibaba");
		expect(alibaba?.apiKeyEnvCounts).toEqual({
			default: 2,
			enterprise: 1,
			plans: 0,
		});
	});
});
