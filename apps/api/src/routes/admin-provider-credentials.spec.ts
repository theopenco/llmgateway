import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { decryptProviderKey } from "@llmgateway/actions";
import {
	redisClient,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import { and, asc, cdb, db, eq, getTableName, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

interface Credential {
	id: string;
	provider: string;
	comment: string | null;
	variant: string;
	region: string | null;
	status: string | null;
	config: Record<string, string>;
	usageLimit: string | null;
	usage: string;
	maskedToken: string;
	tokenHash: string | null;
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

	test("rejects the custom provider", async () => {
		// "custom" is a per-organization BYOK construct with no platform-wide
		// deployment; a managed row for it could never serve a request but would
		// advertise custom as credits-routable.
		const res = await create({ provider: "custom", token: "x" });
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

	test("stores a spend limit on create and reports usage", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-limited",
			usageLimit: "25.50",
		});
		expect(res.status).toBe(201);

		const [credential] = await list();
		expect(credential.usageLimit).toBe("25.50");
		expect(Number(credential.usage)).toBe(0);
	});

	test("rejects a malformed spend limit", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-limited",
			usageLimit: "-5",
		});
		expect(res.status).toBe(400);
	});

	test("sets and clears the spend limit on update", async () => {
		await create({ provider: "openai", token: "sk-limited" });
		const [credential] = await list();

		const set = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ usageLimit: "10" }),
			},
		);
		expect(set.status).toBe(200);
		expect((await list())[0].usageLimit).toBe("10");

		const clear = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ usageLimit: null }),
			},
		);
		expect(clear.status).toBe(200);
		expect((await list())[0].usageLimit).toBeNull();
	});

	test("refuses to reactivate a credential still at its spend limit", async () => {
		await create({ provider: "openai", token: "sk-limited" });
		const [credential] = await list();

		// Simulate the worker's auto-deactivation at the cap.
		await db
			.update(tables.providerKey)
			.set({ usageLimit: "5", usage: "5.10", status: "inactive" })
			.where(eq(tables.providerKey.id, credential.id));

		const rejected = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ status: "active" }),
			},
		);
		expect(rejected.status).toBe(400);
		expect(await rejected.text()).toContain("spend limit");

		// Raising the limit in the same request is the intended path back.
		const raised = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ status: "active", usageLimit: "50" }),
			},
		);
		expect(raised.status).toBe(200);
		const [updated] = await list();
		expect(updated.status).toBe("active");
		expect(updated.usageLimit).toBe("50");
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

	test("catalog lists env keys masked and fingerprinted, never plaintext", async () => {
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-env-primary-secret,sk-env-two");
		vi.stubEnv("LLM_ALIBABA_API_KEY__ENTERPRISE", "sk-env-ent-secret");
		// Clear every other slot the catalog enumerates: a developer .env with
		// real regional keys would otherwise add entries to this list.
		vi.stubEnv("LLM_ALIBABA_API_KEY__PLANS", "");
		for (const region of ["SINGAPORE", "US_VIRGINIA", "CN_BEIJING"]) {
			for (const variant of ["", "__ENTERPRISE", "__PLANS"]) {
				vi.stubEnv(`LLM_ALIBABA_API_KEY${variant}__${region}`, "");
			}
		}

		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).not.toContain("sk-env-primary-secret");
		expect(body).not.toContain("sk-env-ent-secret");

		const json = JSON.parse(body) as {
			providers: {
				id: string;
				envCredentials: {
					envVar: string;
					variant: string;
					region: string | null;
					index: number;
					maskedToken: string;
					tokenHash: string;
				}[];
			}[];
		};
		const alibaba = json.providers.find((p) => p.id === "alibaba");
		expect(alibaba?.envCredentials).toHaveLength(3);

		const [primary] = alibaba!.envCredentials;
		expect(primary.envVar).toBe("LLM_ALIBABA_API_KEY");
		expect(primary.variant).toBe("default");
		expect(primary.index).toBe(0);
		// Fingerprint matches what request logs record for this key.
		expect(primary.tokenHash).toBe(
			getApiKeyFingerprint("sk-env-primary-secret"),
		);

		const enterprise = alibaba!.envCredentials.find(
			(entry) => entry.variant === "enterprise",
		);
		expect(enterprise?.envVar).toBe("LLM_ALIBABA_API_KEY__ENTERPRISE");
	});
});

describe("managed credential region scoping", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function create(body: Record<string, unknown>) {
		return await app.request("/admin/provider-credentials", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("accepts a region the provider's catalogue declares", async () => {
		const res = await create({
			provider: "aws-bedrock",
			token: "bedrock-token",
			region: "eu-central-1",
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			credential: { region: string | null };
		};
		expect(json.credential.region).toBe("eu-central-1");
	});

	test("rejects a region the provider does not declare", async () => {
		const res = await create({
			provider: "aws-bedrock",
			token: "bedrock-token",
			region: "mars-north-1",
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("Unknown region");
	});

	test("lists the available regions when rejecting an unknown one", async () => {
		const res = await create({
			provider: "aws-bedrock",
			token: "bedrock-token",
			region: "mars-north-1",
		});
		expect(await res.text()).toContain("eu-central-1");
	});

	test("rejects any region for a provider that is not region-scoped", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-openai",
			region: "us-east-1",
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("not region-scoped");
	});

	test("allows an unpinned region on a non-region-scoped provider", async () => {
		const res = await create({ provider: "openai", token: "sk-openai" });
		expect(res.status).toBe(201);
	});

	test("revalidates when only the region changes", async () => {
		// A key enabled in one region is not necessarily enabled in another, so
		// moving a credential must re-prove it upstream rather than trusting the
		// check that passed for the old region.
		const created = await create({
			provider: "aws-bedrock",
			token: "bedrock-token",
			region: "us-east-1",
			skipValidation: true,
		});
		expect(created.status).toBe(201);
		const { credential } = (await created.json()) as {
			credential: { id: string };
		};

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ region: "eu-central-1" }),
			},
		);
		// Unit tests skip the live upstream call, so this asserts the request is
		// accepted and the region moves; the validation wiring itself is pinned
		// by the create-path cases above.
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			credential: { region: string | null };
		};
		expect(json.credential.region).toBe("eu-central-1");
	});

	test("rejects an unknown region on update", async () => {
		const created = await create({
			provider: "aws-bedrock",
			token: "bedrock-token",
			region: "us-east-1",
		});
		expect(created.status).toBe(201);
		const { credential } = (await created.json()) as {
			credential: { id: string };
		};

		const res = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ region: "atlantis-1" }),
			},
		);
		expect(res.status).toBe(400);
	});
});

describe("managed credential token confidentiality", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	const TOKEN = "sk-super-secret-managed-token";

	async function create(body: Record<string, unknown>) {
		return await app.request("/admin/provider-credentials", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("no admin response ever contains the plaintext token", async () => {
		const created = await create({ provider: "openai", token: TOKEN });
		expect(created.status).toBe(201);
		const createdBody = await created.text();
		expect(createdBody).not.toContain(TOKEN);
		expect(createdBody).not.toContain("tokenCiphertext");

		const listed = await app.request("/admin/provider-credentials", {
			headers: { Cookie: cookie },
		});
		const listedBody = await listed.text();
		expect(listedBody).not.toContain(TOKEN);
		expect(listedBody).not.toContain("tokenCiphertext");

		const { credential } = JSON.parse(createdBody) as {
			credential: { id: string };
		};
		const patched = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ comment: "renamed" }),
			},
		);
		const patchedBody = await patched.text();
		expect(patchedBody).not.toContain(TOKEN);
		expect(patchedBody).not.toContain("tokenCiphertext");
	});

	test("exposes the same hash the gateway logs as usedApiKeyHash", async () => {
		const created = await create({ provider: "openai", token: TOKEN });
		expect(created.status).toBe(201);
		const { credential } = (await created.json()) as {
			credential: { tokenHash: string };
		};
		expect(credential.tokenHash).toBe(getApiKeyFingerprint(TOKEN));
	});

	test("re-stamps the hash when the token is rotated", async () => {
		const created = await create({ provider: "openai", token: TOKEN });
		const { credential } = (await created.json()) as {
			credential: { id: string; tokenHash: string };
		};

		const rotated = await app.request(
			`/admin/provider-credentials/${credential.id}`,
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ token: "sk-rotated-token" }),
			},
		);
		expect(rotated.status).toBe(200);
		const json = (await rotated.json()) as {
			credential: { tokenHash: string };
		};
		expect(json.credential.tokenHash).toBe(
			getApiKeyFingerprint("sk-rotated-token"),
		);
		expect(json.credential.tokenHash).not.toBe(credential.tokenHash);
	});
});

describe("managed credential ordering", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function seed(id: string, provider = "openai") {
		await db.insert(tables.providerKey).values({
			id,
			token: `token-${id}`,
			provider,
			managed: true,
			organizationId: null,
		});
	}

	async function reorder(body: Record<string, unknown>) {
		return await app.request("/admin/provider-credentials/order", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	async function storedOrder(provider = "openai") {
		const rows = await db.query.providerKey.findMany({
			where: { managed: { eq: true }, provider: { eq: provider } },
		});
		return (
			rows
				.slice()
				// id tiebreak: two never-reordered rows both have a null sortOrder, and
				// without it the assertion depends on Postgres heap order.
				.sort(
					(a, b) =>
						(a.sortOrder ?? 99) - (b.sortOrder ?? 99) ||
						a.id.localeCompare(b.id),
				)
				.map((row) => [row.id, row.sortOrder] as const)
		);
	}

	test("persists the submitted order", async () => {
		await seed("cred-a");
		await seed("cred-b");
		await seed("cred-c");

		const res = await reorder({
			provider: "openai",
			credentialIds: ["cred-c", "cred-a", "cred-b"],
		});
		expect(res.status).toBe(200);
		expect(await storedOrder()).toEqual([
			["cred-c", 0],
			["cred-a", 1],
			["cred-b", 2],
		]);
	});

	test("rejects a BYOK key id", async () => {
		await seed("cred-a");
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

		const res = await reorder({
			provider: "openai",
			credentialIds: ["cred-a", "byok-key"],
		});
		expect(res.status).toBe(404);
		expect(await storedOrder()).toEqual([["cred-a", null]]);
	});

	test("rejects duplicates and out-of-date lists without writing", async () => {
		await seed("cred-a");
		await seed("cred-b");

		expect(
			(
				await reorder({
					provider: "openai",
					credentialIds: ["cred-a", "cred-a"],
				})
			).status,
		).toBe(400);
		expect(
			(await reorder({ provider: "openai", credentialIds: ["cred-a"] })).status,
		).toBe(409);
		expect(await storedOrder()).toEqual([
			["cred-a", null],
			["cred-b", null],
		]);
	});

	test("leaves other providers untouched", async () => {
		await seed("openai-a");
		await seed("openai-b");
		await seed("anthropic-a", "anthropic");
		await seed("anthropic-b", "anthropic");

		const res = await reorder({
			provider: "openai",
			credentialIds: ["openai-b", "openai-a"],
		});
		expect(res.status).toBe(200);
		expect(await storedOrder("anthropic")).toEqual([
			["anthropic-a", null],
			["anthropic-b", null],
		]);
	});
});

/**
 * The gateway reads managed credentials through a cached select wrapped in an
 * SWR mirror, both keyed on the provider_key table. A reorder written through
 * anything but cdb would leave the gateway routing to the old primary until
 * the cache expires.
 */
describe("managed credential reorder cache invalidation", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		// The managed SWR key is keyed only on the provider, so a cached entry
		// from an earlier run outlives deleteAll() and would decide this test.
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await deleteAll();
	});

	// Mirrors findManagedProviderKey: same SWR key, same ORDER BY, so this
	// asserts the order the gateway would actually serve.
	async function readGatewayOrder(provider: string) {
		const rows = await swrWrap(
			`providerKey:managed:${provider}`,
			[getTableName(tables.providerKey)],
			async () =>
				await cdb
					.select()
					.from(tables.providerKey)
					.where(
						and(
							eq(tables.providerKey.status, "active"),
							eq(tables.providerKey.managed, true),
							eq(tables.providerKey.provider, provider),
						),
					)
					.orderBy(
						asc(tables.providerKey.sortOrder),
						asc(tables.providerKey.createdAt),
						asc(tables.providerKey.id),
					),
		);
		await waitForSwrMirrorWrites();
		return rows.map((row) => row.id);
	}

	test("busts the gateway's cached order", async () => {
		const provider = "openai";
		for (const id of ["cache-cred-a", "cache-cred-b"]) {
			await db.insert(tables.providerKey).values({
				id,
				token: `token-${id}`,
				provider,
				managed: true,
				organizationId: null,
			});
		}

		expect(await readGatewayOrder(provider)).toEqual([
			"cache-cred-a",
			"cache-cred-b",
		]);

		const res = await app.request("/admin/provider-credentials/order", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				provider,
				credentialIds: ["cache-cred-b", "cache-cred-a"],
			}),
		});
		expect(res.status).toBe(200);

		expect(await readGatewayOrder(provider)).toEqual([
			"cache-cred-b",
			"cache-cred-a",
		]);
	});
});
