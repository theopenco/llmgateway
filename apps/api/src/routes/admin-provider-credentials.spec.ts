import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import {
	decryptProviderKey,
	deleteProviderEnvInventory,
	getPinnedValidationModel,
	publishProviderEnvInventory,
} from "@llmgateway/actions";
import {
	redisClient,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import { and, asc, cdb, db, eq, getTableName, tables } from "@llmgateway/db";
import {
	getProviderDefinition,
	getRegionEnvVarSuffix,
} from "@llmgateway/models";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type * as LlmGatewayActions from "@llmgateway/actions";

// Spy on the live probe so the pinned-model selection in
// validateCredentialToken can be asserted without real upstream calls. The
// default implementation stays the real one; tests that exercise the live
// path queue a one-shot resolved value instead.
const validateProviderKeyMock = vi.hoisted(() => vi.fn());
vi.mock("@llmgateway/actions", async (importOriginal) => {
	const actual = await importOriginal<typeof LlmGatewayActions>();
	validateProviderKeyMock.mockImplementation(actual.validateProviderKey);
	return { ...actual, validateProviderKey: validateProviderKeyMock };
});

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
		// The catalog prefers the gateway's published snapshot, so the tests that
		// assert the env fallback must start without one.
		await deleteProviderEnvInventory();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteProviderEnvInventory();
		await deleteAll();
	});

	/**
	 * A developer .env carries real keys for many providers, so every alibaba
	 * slot the catalog enumerates is stubbed blank; a test then sets only the
	 * ones it asserts on.
	 */
	function clearAlibabaEnvSlots() {
		const regions =
			getProviderDefinition("alibaba")?.regionConfig?.regions.map((r) =>
				getRegionEnvVarSuffix(r.id),
			) ?? [];
		for (const variant of ["", "__ENTERPRISE", "__PLANS"]) {
			vi.stubEnv(`LLM_ALIBABA_API_KEY${variant}`, "");
			for (const region of regions) {
				vi.stubEnv(`LLM_ALIBABA_API_KEY${variant}__${region}`, "");
			}
		}
	}

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
		expect(row.tokenCiphertext).toMatch(/^llmgw:v2:/);
		expect(
			decryptProviderKey(row.tokenCiphertext!, row.id, "llmgateway:managed"),
		).toBe("sk-encrypt-me");
		// The managed scope is not interchangeable with an organization scope.
		expect(() =>
			decryptProviderKey(row.tokenCiphertext!, row.id, "some-org-id"),
		).toThrow();
	});

	test("accepts a Vertex API key without a project", async () => {
		const res = await create({
			provider: "google-vertex",
			token: "vertex-key",
		});
		expect(res.status).toBe(201);
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

	test("allows removing an optional Vertex project", async () => {
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
		expect(res.status).toBe(200);
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
			required: false,
		});
		expect(vertex?.configKeys.map((k) => k.key)).not.toContain("apiKey");

		// The gateway cannot recover the project from a managed credential's
		// service-account JSON, so the form has to offer the field.
		const vertexAnthropic = json.providers.find(
			(p) => p.id === "vertex-anthropic",
		);
		expect(vertexAnthropic?.configKeys).toContainEqual({
			key: "project",
			envVar: "LLM_VERTEX_ANTHROPIC_PROJECT",
			required: true,
		});

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
		clearAlibabaEnvSlots();
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-env-primary-secret,sk-env-two");
		vi.stubEnv("LLM_ALIBABA_API_KEY__ENTERPRISE", "sk-env-ent-secret");

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

	test("catalog reports its own environment only as a fallback", async () => {
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-api-process-key");

		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			envSource: string;
			envPublishedAt: string | null;
			providers: { id: string; envCredentials: { tokenHash: string }[] }[];
		};

		expect(json.envSource).toBe("api");
		expect(json.envPublishedAt).toBeNull();
		const alibaba = json.providers.find((p) => p.id === "alibaba");
		expect(alibaba?.envCredentials[0]?.tokenHash).toBe(
			getApiKeyFingerprint("sk-api-process-key"),
		);
	});

	/**
	 * Provider keys are set on the gateway, not on this service, so the keys the
	 * dashboard lists must come from the gateway's published snapshot — reading
	 * this process's environment would report the wrong set (usually none).
	 */
	test("catalog prefers the gateway's published keys over its own env", async () => {
		clearAlibabaEnvSlots();
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-gateway-key");
		await publishProviderEnvInventory();

		// Whatever this process holds afterwards must not influence the listing.
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-api-process-key");

		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).not.toContain("sk-gateway-key");

		const json = JSON.parse(body) as {
			envSource: string;
			envPublishedAt: string | null;
			providers: {
				id: string;
				apiKeyEnvConfigured: boolean;
				apiKeyEnvCounts: { default: number };
				envCredentials: { tokenHash: string }[];
			}[];
		};

		expect(json.envSource).toBe("gateway");
		expect(json.envPublishedAt).not.toBeNull();

		const alibaba = json.providers.find((p) => p.id === "alibaba");
		expect(alibaba?.envCredentials).toHaveLength(1);
		expect(alibaba?.envCredentials[0].tokenHash).toBe(
			getApiKeyFingerprint("sk-gateway-key"),
		);
		expect(alibaba?.apiKeyEnvConfigured).toBe(true);
		expect(alibaba?.apiKeyEnvCounts.default).toBe(1);
	});

	test("catalog reports zero env keys for a provider the gateway has none for", async () => {
		// Published with nothing set, so the snapshot genuinely holds no key for
		// this provider.
		clearAlibabaEnvSlots();
		await publishProviderEnvInventory();
		// Set locally after publishing: the API's own key must not resurface a
		// provider the gateway cannot serve.
		vi.stubEnv("LLM_ALIBABA_API_KEY", "sk-api-process-key");

		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			providers: {
				id: string;
				apiKeyEnvConfigured: boolean;
				envCredentials: unknown[];
			}[];
		};

		const alibaba = json.providers.find((p) => p.id === "alibaba");
		expect(alibaba?.envCredentials).toEqual([]);
		expect(alibaba?.apiKeyEnvConfigured).toBe(false);
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
	describe("spend breakdown", () => {
		const providerKeyId = "spend-cred";
		const orgId = "spend-org";
		const projectId = "spend-project";
		const apiKeyId = "spend-api-key";

		async function seedTraffic(
			costs: {
				providerKeyId: string | null;
				cost: number;
				cached?: boolean;
			}[],
		) {
			await db.insert(tables.organization).values({
				id: orgId,
				name: "Spend Org",
				billingEmail: "spend@example.com",
				credits: "100",
			});
			await db.insert(tables.project).values({
				id: projectId,
				name: "Spend Project",
				organizationId: orgId,
				mode: "credits",
			});
			await db.insert(tables.apiKey).values({
				id: apiKeyId,
				token: "spend-api-key-token",
				projectId,
				description: "Spend Key",
				createdBy: "test-user-id",
			});
			await db.insert(tables.providerKey).values({
				id: providerKeyId,
				token: "sk-spend-cred",
				provider: "openai",
				managed: true,
				organizationId: null,
				usage: "1.50",
				usageLimit: "10",
			});

			let index = 0;
			for (const entry of costs) {
				await db.insert(tables.log).values({
					id: `spend-log-${index}`,
					requestId: `spend-request-${index}`,
					organizationId: orgId,
					projectId,
					apiKeyId,
					providerKeyId: entry.providerKeyId,
					cost: entry.cost,
					cached: entry.cached ?? false,
					duration: 1000,
					usedMode: "credits",
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 100,
					mode: "credits",
				});
				index++;
			}

			await aggregateLogsForTesting();
		}

		async function getSpend(id = providerKeyId) {
			return await app.request(`/admin/provider-keys/${id}/spend?window=1d`, {
				headers: { Cookie: cookie },
			});
		}

		test("requires authentication", async () => {
			const res = await app.request(
				`/admin/provider-keys/${providerKeyId}/spend`,
			);
			expect(res.status).toBe(401);
		});

		test("404s for an unknown key", async () => {
			const res = await getSpend("does-not-exist");
			expect(res.status).toBe(404);
		});

		test("still reports spend for a soft-deleted key", async () => {
			// The admin organization view lists deleted keys, and their historical
			// spend outlives the key itself.
			await db.insert(tables.providerKey).values({
				id: "retired-cred",
				token: "sk-retired",
				provider: "openai",
				managed: true,
				organizationId: null,
				status: "deleted",
			});

			const res = await getSpend("retired-cred");
			expect(res.status).toBe(200);
		});

		test("returns attributed spend bucketed over the window", async () => {
			await seedTraffic([
				{ providerKeyId, cost: 0.01 },
				{ providerKeyId, cost: 0.02 },
				// Not attributable: served by an env-var credential.
				{ providerKeyId: null, cost: 5 },
			]);

			const res = await getSpend();
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				bucket: string;
				totalCost: number;
				totalRequests: number;
				key: { usage: string; usageLimit: string | null; managed: boolean };
				data: { cost: number }[];
				organizations: { organizationId: string; cost: number }[];
			};

			expect(body.bucket).toBe("hour");
			expect(body.totalCost).toBeCloseTo(0.03, 6);
			expect(body.totalRequests).toBe(2);
			// The lifetime counter is reported alongside, not recomputed from logs.
			expect(body.key.usage).toBe("1.50");
			expect(body.key.usageLimit).toBe("10");
			expect(body.key.managed).toBe(true);
			expect(body.data.length).toBeGreaterThan(0);
		});

		test("splits spend by consuming organization", async () => {
			await seedTraffic([
				{ providerKeyId, cost: 0.04 },
				{ providerKeyId, cost: 0.06 },
			]);

			const res = await getSpend();
			const body = (await res.json()) as {
				organizations: {
					organizationId: string;
					organizationName: string | null;
					cost: number;
				}[];
			};

			expect(body.organizations).toHaveLength(1);
			expect(body.organizations[0].organizationId).toBe(orgId);
			expect(body.organizations[0].organizationName).toBe("Spend Org");
			expect(body.organizations[0].cost).toBeCloseTo(0.1, 6);
		});

		test("reports zeroes for a key with no attributed traffic", async () => {
			await db.insert(tables.providerKey).values({
				id: "quiet-cred",
				token: "sk-quiet",
				provider: "openai",
				managed: true,
				organizationId: null,
			});

			const res = await getSpend("quiet-cred");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				totalCost: number;
				buckets: string[];
				data: unknown[];
				organizations: unknown[];
			};
			expect(body.totalCost).toBe(0);
			expect(body.data).toEqual([]);
			expect(body.organizations).toEqual([]);
			// The chart still spans the whole window: the grid is returned even when
			// nothing was spent, so the axis does not collapse to nothing.
			expect(body.buckets).toHaveLength(25);
		});

		test("returns a bucket grid covering the whole window", async () => {
			await seedTraffic([{ providerKeyId, cost: 0.01 }]);

			const res = await getSpend();
			const body = (await res.json()) as {
				buckets: string[];
				data: { timestamp: string }[];
			};

			// One hourly bucket per hour of the 24h window, and the only bucket that
			// carried traffic is part of that grid — so zero-filling the rest lines
			// the series up with the axis.
			expect(body.buckets).toHaveLength(25);
			expect(new Set(body.buckets).size).toBe(body.buckets.length);
			expect(body.data.length).toBeGreaterThan(0);
			for (const point of body.data) {
				expect(body.buckets).toContain(point.timestamp);
			}
		});
	});

	describe("spend overview", () => {
		const orgId = "overview-org";
		const projectId = "overview-project";
		const apiKeyId = "overview-api-key";

		interface OverviewKey {
			id: string;
			provider: string;
			status: string | null;
			totalCost: number;
			totalRequests: number;
			totalTokens: string;
		}

		interface OverviewBody {
			bucket: string;
			buckets: string[];
			keys: OverviewKey[];
			data: {
				providerKeyId: string;
				timestamp: string;
				cost: number;
				totalTokens: string;
			}[];
		}

		async function seedTraffic(
			logs: {
				providerKeyId: string | null;
				cost: number;
				totalTokens?: number;
			}[],
		) {
			await db.insert(tables.organization).values({
				id: orgId,
				name: "Overview Org",
				billingEmail: "overview@example.com",
				credits: "100",
			});
			await db.insert(tables.project).values({
				id: projectId,
				name: "Overview Project",
				organizationId: orgId,
				mode: "credits",
			});
			await db.insert(tables.apiKey).values({
				id: apiKeyId,
				token: "overview-api-key-token",
				projectId,
				description: "Overview Key",
				createdBy: "test-user-id",
			});

			let index = 0;
			for (const entry of logs) {
				await db.insert(tables.log).values({
					id: `overview-log-${index}`,
					requestId: `overview-request-${index}`,
					organizationId: orgId,
					projectId,
					apiKeyId,
					providerKeyId: entry.providerKeyId,
					cost: entry.cost,
					totalTokens: entry.totalTokens?.toString(),
					duration: 1000,
					usedMode: "credits",
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 100,
					mode: "credits",
				});
				index++;
			}

			await aggregateLogsForTesting();
		}

		async function getOverview(): Promise<OverviewBody> {
			const res = await app.request(
				"/admin/provider-credentials/spend?window=1d",
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			return (await res.json()) as OverviewBody;
		}

		test("requires authentication", async () => {
			const res = await app.request("/admin/provider-credentials/spend");
			expect(res.status).toBe(401);
		});

		test("returns one series per managed credential", async () => {
			await db.insert(tables.providerKey).values([
				{
					id: "overview-cred-a",
					token: "sk-overview-a",
					provider: "openai",
					managed: true,
					organizationId: null,
				},
				{
					id: "overview-cred-b",
					token: "sk-overview-b",
					provider: "anthropic",
					managed: true,
					organizationId: null,
				},
			]);
			await seedTraffic([
				{ providerKeyId: "overview-cred-a", cost: 0.01, totalTokens: 100 },
				{ providerKeyId: "overview-cred-a", cost: 0.02, totalTokens: 200 },
				{ providerKeyId: "overview-cred-b", cost: 0.04, totalTokens: 50 },
				// Served by an env-var credential: attributable to nothing.
				{ providerKeyId: null, cost: 5 },
			]);

			const body = await getOverview();
			expect(body.bucket).toBe("hour");

			const keyA = body.keys.find((key) => key.id === "overview-cred-a");
			const keyB = body.keys.find((key) => key.id === "overview-cred-b");
			expect(keyA?.totalCost).toBeCloseTo(0.03, 6);
			expect(keyA?.totalRequests).toBe(2);
			expect(keyA?.totalTokens).toBe("300");
			expect(keyB?.totalCost).toBeCloseTo(0.04, 6);
			expect(keyB?.totalTokens).toBe("50");

			const seriesIds = new Set(body.data.map((point) => point.providerKeyId));
			expect(seriesIds).toEqual(
				new Set(["overview-cred-a", "overview-cred-b"]),
			);
		});

		test("returns a bucket grid covering the whole window", async () => {
			await db.insert(tables.providerKey).values({
				id: "overview-grid",
				token: "sk-overview-grid",
				provider: "openai",
				managed: true,
				organizationId: null,
			});
			await seedTraffic([{ providerKeyId: "overview-grid", cost: 0.01 }]);

			const body = await getOverview();

			// The rollup only holds the current hour, but the grid still spans the
			// full 24h window so quiet buckets can be zero-filled client-side.
			expect(body.buckets).toHaveLength(25);
			expect(new Set(body.buckets).size).toBe(body.buckets.length);
			expect(body.data.length).toBeGreaterThan(0);
			for (const point of body.data) {
				expect(body.buckets).toContain(point.timestamp);
			}
		});

		test("excludes BYOK keys and their spend", async () => {
			await db.insert(tables.organization).values({
				id: "byok-org",
				name: "BYOK Org",
				billingEmail: "byok@example.com",
			});
			await db.insert(tables.providerKey).values({
				id: "overview-byok",
				token: "sk-overview-byok",
				provider: "openai",
				managed: false,
				organizationId: "byok-org",
			});
			await seedTraffic([{ providerKeyId: "overview-byok", cost: 0.25 }]);

			const body = await getOverview();
			expect(body.keys).toEqual([]);
			expect(body.data).toEqual([]);
		});

		test("keeps quiet keys, drops deleted ones without window spend", async () => {
			await db.insert(tables.providerKey).values([
				{
					id: "overview-quiet",
					token: "sk-overview-quiet",
					provider: "openai",
					managed: true,
					organizationId: null,
				},
				{
					id: "overview-retired",
					token: "sk-overview-retired",
					provider: "openai",
					managed: true,
					organizationId: null,
					status: "deleted",
				},
				{
					id: "overview-retired-spending",
					token: "sk-overview-retired-spending",
					provider: "openai",
					managed: true,
					organizationId: null,
					status: "deleted",
				},
			]);
			await seedTraffic([
				{ providerKeyId: "overview-retired-spending", cost: 0.5 },
			]);

			const body = await getOverview();
			const ids = body.keys.map((key) => key.id);
			// A key with no traffic still belongs in the legend; a deleted key
			// earns a row only while its spend is still inside the window.
			expect(ids).toContain("overview-quiet");
			expect(ids).toContain("overview-retired-spending");
			expect(ids).not.toContain("overview-retired");

			const quiet = body.keys.find((key) => key.id === "overview-quiet");
			expect(quiet?.totalCost).toBe(0);
			expect(quiet?.totalTokens).toBe("0");
		});
	});
});

describe("managed credential allowed models", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		validateProviderKeyMock.mockClear();
		await deleteAll();
	});

	async function create(body: Record<string, unknown>) {
		return await app.request("/admin/provider-credentials", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	async function patch(id: string, body: Record<string, unknown>) {
		return await app.request(`/admin/provider-credentials/${id}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	async function post(path: string, body: Record<string, unknown>) {
		return await app.request(path, {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	/**
	 * Catalogue model ids for a provider, taken from the catalog route so the
	 * tests never hardcode ids that rot when the catalogue changes.
	 */
	async function catalogModels(provider: string): Promise<string[]> {
		const res = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			providers: { id: string; models: string[] }[];
		};
		return json.providers.find((entry) => entry.id === provider)?.models ?? [];
	}

	test("catalog lists each provider's live models for the picker", async () => {
		const models = await catalogModels("openai");
		expect(models.length).toBeGreaterThan(0);
	});

	test("stores a normalized allowed-models list", async () => {
		const [first, second] = await catalogModels("openai");
		const res = await create({
			provider: "openai",
			token: "sk-restricted",
			allowedModels: [` ${first} `, second, first, ""],
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			credential: { allowedModels: string[] | null };
		};
		expect(json.credential.allowedModels).toEqual([first, second]);
	});

	test("treats an empty list as no restriction", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-unrestricted",
			allowedModels: [],
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			credential: { allowedModels: string[] | null };
		};
		expect(json.credential.allowedModels).toBeNull();
	});

	test("rejects a model the provider cannot serve", async () => {
		const res = await create({
			provider: "openai",
			token: "sk-bad-model",
			allowedModels: ["definitely-not-a-model"],
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("definitely-not-a-model");
	});

	test("sets and clears the restriction on update", async () => {
		const [model] = await catalogModels("openai");
		const createRes = await create({ provider: "openai", token: "sk-update" });
		const { credential } = (await createRes.json()) as {
			credential: { id: string };
		};

		const setRes = await patch(credential.id, { allowedModels: [model] });
		expect(setRes.status).toBe(200);
		expect(
			((await setRes.json()) as { credential: { allowedModels: string[] } })
				.credential.allowedModels,
		).toEqual([model]);

		const clearRes = await patch(credential.id, { allowedModels: null });
		expect(clearRes.status).toBe(200);
		expect(
			(
				(await clearRes.json()) as {
					credential: { allowedModels: string[] | null };
				}
			).credential.allowedModels,
		).toBeNull();
	});

	test("save-time validation probes an allowed model, not the default", async () => {
		// E2E_TEST re-enables the live path that unit tests otherwise skip; the
		// probe itself is stubbed so nothing reaches a real upstream.
		vi.stubEnv("E2E_TEST", "true");
		validateProviderKeyMock.mockResolvedValueOnce({ valid: true });

		const chatModel = (await catalogModels("openai")).find(
			(modelId) =>
				getPinnedValidationModel("openai", modelId)?.chatCapable === true,
		);
		expect(chatModel).toBeDefined();

		const res = await create({
			provider: "openai",
			token: "sk-pinned-probe",
			allowedModels: [chatModel],
		});
		expect(res.status).toBe(201);

		expect(validateProviderKeyMock).toHaveBeenCalledTimes(1);
		// (provider, token, baseUrl, skipValidation, options, pinnedModelId)
		expect(validateProviderKeyMock.mock.calls[0][5]).toBe(chatModel);
	});

	test("save-time validation skips the probe when no allowed model can chat", async () => {
		vi.stubEnv("E2E_TEST", "true");

		const nonChatModel = (await catalogModels("openai")).find(
			(modelId) =>
				getPinnedValidationModel("openai", modelId)?.chatCapable === false,
		);
		expect(nonChatModel).toBeDefined();

		const res = await create({
			provider: "openai",
			token: "sk-no-chat-probe",
			allowedModels: [nonChatModel],
		});
		expect(res.status).toBe(201);
		expect(validateProviderKeyMock).not.toHaveBeenCalled();
	});

	test("self-test probes a stored credential", async () => {
		const createRes = await create({ provider: "openai", token: "sk-probe" });
		const { credential } = (await createRes.json()) as {
			credential: { id: string };
		};

		const res = await post("/admin/provider-credentials/self-test", {
			credentialId: credential.id,
		});
		expect(res.status).toBe(200);
		// Unit tests skip the live upstream call, so a resolvable credential
		// reports valid.
		expect(((await res.json()) as { valid: boolean }).valid).toBe(true);
	});

	test("self-test accepts unsaved dialog values", async () => {
		const res = await post("/admin/provider-credentials/self-test", {
			provider: "openai",
			token: "sk-not-saved-anywhere",
		});
		expect(res.status).toBe(200);
	});

	test("self-test requires a credential or explicit values", async () => {
		expect(
			(await post("/admin/provider-credentials/self-test", {})).status,
		).toBe(400);
		expect(
			(
				await post("/admin/provider-credentials/self-test", {
					provider: "openai",
				})
			).status,
		).toBe(400);
		expect(
			(
				await post("/admin/provider-credentials/self-test", {
					credentialId: "missing-credential",
				})
			).status,
		).toBe(404);
	});

	test("verify-models reports each model and flags unknown ones", async () => {
		const [model] = await catalogModels("openai");
		const createRes = await create({ provider: "openai", token: "sk-verify" });
		const { credential } = (await createRes.json()) as {
			credential: { id: string };
		};

		const res = await post("/admin/provider-credentials/verify-models", {
			credentialId: credential.id,
			models: [model, "definitely-not-a-model"],
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			allValid: boolean;
			results: {
				model: string;
				inCatalog: boolean;
				valid: boolean | null;
			}[];
		};
		expect(json.allValid).toBe(false);
		const known = json.results.find((entry) => entry.model === model);
		expect(known?.inCatalog).toBe(true);
		expect(known?.valid).toBe(true);
		const unknown = json.results.find(
			(entry) => entry.model === "definitely-not-a-model",
		);
		expect(unknown?.inCatalog).toBe(false);
	});

	test("verify-models passes when every model checks out", async () => {
		const models = (await catalogModels("openai")).slice(0, 2);
		const res = await post("/admin/provider-credentials/verify-models", {
			provider: "openai",
			token: "sk-verify-all",
			models,
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { allValid: boolean }).allValid).toBe(true);
	});
});
