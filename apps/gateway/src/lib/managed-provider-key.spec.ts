import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { redisClient, waitForSwrMirrorWrites } from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	findManagedProviderKeyById,
	organization,
	providerKey,
	type InferInsertModel,
} from "@llmgateway/db";

import {
	reportTrackedKeyError,
	reportTrackedKeySuccess,
	resetKeyHealth,
} from "./api-key-health.js";
import {
	findManagedProviderIds,
	findManagedProviderKey,
	findProviderKey,
} from "./cached-queries.js";

const ORG_ID = "test-org-managed-keys";

async function insertManaged(
	values: Partial<InferInsertModel<typeof providerKey>> & { id: string },
) {
	await db.insert(providerKey).values({
		provider: "openai",
		managed: true,
		organizationId: null,
		token: `token-${values.id}`,
		...values,
	});
}

describe("findManagedProviderKey", () => {
	beforeEach(async () => {
		resetKeyHealth();
		await waitForSwrMirrorWrites();
		await db.delete(providerKey);
		await db.delete(organization);
		// Managed-credential lookups are cached per provider, so start each case
		// from an empty cache rather than the previous case's rows.
		await redisClient.flushdb();
		await db.insert(organization).values({
			id: ORG_ID,
			name: "Managed Keys Org",
			billingEmail: "managed-keys@example.com",
			credits: "100",
		});
	});

	afterEach(async () => {
		await db.delete(providerKey);
		await db.delete(organization);
	});

	it("returns nothing when the provider has no managed credential", async () => {
		expect(await findManagedProviderKey("openai")).toBeUndefined();
	});

	it("never returns an organization-owned key", async () => {
		await db.insert(providerKey).values({
			id: "byok-key",
			provider: "openai",
			token: "sk-byok",
			organizationId: ORG_ID,
		});

		expect(await findManagedProviderKey("openai")).toBeUndefined();
	});

	it("is not returned to an organization's BYOK lookup", async () => {
		await insertManaged({ id: "managed-key" });

		expect(await findProviderKey(ORG_ID, "openai")).toBeUndefined();
	});

	it("skips inactive and deleted credentials", async () => {
		await insertManaged({ id: "inactive-key", status: "inactive" });
		await insertManaged({ id: "deleted-key", status: "deleted" });

		expect(await findManagedProviderKey("openai")).toBeUndefined();
	});

	it("prefers a credential for the organization's variant", async () => {
		await insertManaged({ id: "shared-key" });
		await insertManaged({ id: "enterprise-key", variant: "enterprise" });

		expect((await findManagedProviderKey("openai"))?.id).toBe("shared-key");
		expect(
			(await findManagedProviderKey("openai", { variant: "enterprise" }))?.id,
		).toBe("enterprise-key");
	});

	it("falls back to the shared credential when the variant has none", async () => {
		await insertManaged({ id: "shared-key" });

		expect(
			(await findManagedProviderKey("openai", { variant: "plans" }))?.id,
		).toBe("shared-key");
	});

	it("keeps each variant's credentials to itself", async () => {
		await insertManaged({ id: "enterprise-key", variant: "enterprise" });

		// A PAYG org must never be served the enterprise credential, exactly as
		// it never reads LLM_OPENAI_API_KEY__ENTERPRISE.
		expect(await findManagedProviderKey("openai")).toBeUndefined();
		expect(
			await findManagedProviderKey("openai", { variant: "plans" }),
		).toBeUndefined();
	});

	it("prefers a credential scoped to the requested region", async () => {
		await insertManaged({ id: "any-region-key" });
		await insertManaged({ id: "singapore-key", region: "singapore" });

		expect(
			(await findManagedProviderKey("openai", { region: "singapore" }))?.id,
		).toBe("singapore-key");
		expect(
			(await findManagedProviderKey("openai", { region: "us-virginia" }))?.id,
		).toBe("any-region-key");
	});

	it("never serves a region-scoped credential to another region", async () => {
		await insertManaged({ id: "singapore-key", region: "singapore" });

		expect(
			await findManagedProviderKey("openai", { region: "us-virginia" }),
		).toBeUndefined();
	});

	it("excludes credentials that already failed this request", async () => {
		await insertManaged({ id: "first-key" });
		await insertManaged({ id: "second-key" });

		expect(
			(
				await findManagedProviderKey("openai", {
					excludedKeyIds: new Set(["first-key"]),
				})
			)?.id,
		).toBe("second-key");
	});

	it("returns the credential's own settings", async () => {
		await insertManaged({
			id: "vertex-key",
			provider: "google-vertex",
			config: { project: "managed-project", region: "us-central1" },
			comment: "shared vertex quota",
		});

		const key = await findManagedProviderKey("google-vertex");
		expect(key?.config).toEqual({
			project: "managed-project",
			region: "us-central1",
		});
		expect(key?.comment).toBe("shared vertex quota");
	});
});

/**
 * Routing consults this to decide which providers can serve credits-mode
 * traffic. It must answer "does this org have a usable credential here?", not
 * merely "does any credential exist?": advertising a provider whose only
 * credential belongs to another audience makes routing pick it, find nothing,
 * and fall through to an env var that a migrated deployment no longer sets.
 */
describe("findManagedProviderIds", () => {
	beforeEach(async () => {
		resetKeyHealth();
		await waitForSwrMirrorWrites();
		await db.delete(providerKey);
		await db.delete(organization);
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await db.delete(providerKey);
	});

	it("offers a default credential to every audience", async () => {
		await insertManaged({ id: "default-key", variant: "default" });

		expect(await findManagedProviderIds()).toContain("openai");
		expect(await findManagedProviderIds("enterprise")).toContain("openai");
		expect(await findManagedProviderIds("plans")).toContain("openai");
	});

	it("hides a variant-scoped credential from other audiences", async () => {
		await insertManaged({ id: "enterprise-key", variant: "enterprise" });

		expect(await findManagedProviderIds("enterprise")).toContain("openai");
		// A PAYG org (no variant) and a plans org cannot use it.
		expect(await findManagedProviderIds()).not.toContain("openai");
		expect(await findManagedProviderIds("plans")).not.toContain("openai");
	});

	it("offers the provider once any audience-usable credential exists", async () => {
		await insertManaged({ id: "enterprise-key", variant: "enterprise" });
		await insertManaged({ id: "default-key", variant: "default" });

		expect(await findManagedProviderIds()).toContain("openai");
		expect(await findManagedProviderIds("enterprise")).toContain("openai");
	});

	it("ignores inactive credentials", async () => {
		await insertManaged({ id: "inactive-key", status: "inactive" });

		expect(await findManagedProviderIds()).not.toContain("openai");
	});

	/**
	 * Routing picks a provider before a region is known, so a provider whose
	 * only credentials are region-pinned cannot be guaranteed a match. Offering
	 * it anyway means findManagedProviderKey returns nothing and
	 * resolvePlatformCredential falls through to getProviderEnv, which 500s
	 * outside the provider-fallback loop.
	 */
	it("does not offer a provider whose only credential is region-pinned", async () => {
		await insertManaged({
			id: "region-pinned-only",
			provider: "aws-bedrock",
			region: "eu-central-1",
		});

		expect(await findManagedProviderIds()).not.toContain("aws-bedrock");
		// The credential is still unusable for a region-less request, which is
		// precisely why the provider must not be advertised.
		expect(await findManagedProviderKey("aws-bedrock")).toBeUndefined();
	});

	it("offers the provider once a region-agnostic credential exists", async () => {
		await insertManaged({
			id: "bedrock-regional",
			provider: "aws-bedrock",
			region: "eu-central-1",
		});
		await insertManaged({ id: "bedrock-any-region", provider: "aws-bedrock" });

		expect(await findManagedProviderIds()).toContain("aws-bedrock");
		expect((await findManagedProviderKey("aws-bedrock"))?.id).toBe(
			"bedrock-any-region",
		);
		// The pinned one still wins for its own region.
		expect(
			(await findManagedProviderKey("aws-bedrock", { region: "eu-central-1" }))
				?.id,
		).toBe("bedrock-regional");
	});

	it("does not let a region-agnostic default rescue a region-pinned variant", async () => {
		// An enterprise org resolves to the enterprise credentials and never
		// falls back to default once any enterprise credential exists, so a
		// region-pinned enterprise key leaves nothing selectable.
		await insertManaged({
			id: "ent-region-pinned",
			variant: "enterprise",
			region: "eu-central-1",
		});
		await insertManaged({ id: "default-any-region", variant: "default" });

		expect(await findManagedProviderIds("enterprise")).not.toContain("openai");
		expect(
			await findManagedProviderKey("openai", { variant: "enterprise" }),
		).toBeUndefined();
		// A PAYG org is unaffected: it uses the default credential.
		expect(await findManagedProviderIds()).toContain("openai");
	});
});

/**
 * A credential restricted via allowedModels can only serve the models it
 * lists, so routing must not advertise its provider for other models and
 * credential selection must skip it — otherwise auto-routing picks a provider
 * whose key the upstream account cannot use and the request fails upstream.
 */
describe("allowedModels restriction", () => {
	beforeEach(async () => {
		resetKeyHealth();
		await waitForSwrMirrorWrites();
		await db.delete(providerKey);
		await db.delete(organization);
		await redisClient.flushdb();
		await db.insert(organization).values({
			id: ORG_ID,
			name: "Managed Keys Org",
			billingEmail: "managed-keys@example.com",
			credits: "100",
		});
	});

	afterEach(async () => {
		await db.delete(providerKey);
		await db.delete(organization);
	});

	it("does not advertise a provider for a model its only credential excludes", async () => {
		await insertManaged({
			id: "restricted-key",
			allowedModels: ["gpt-5.2"],
		});

		expect(await findManagedProviderIds(undefined, "gpt-5.2")).toContain(
			"openai",
		);
		expect(
			await findManagedProviderIds(undefined, "some-other-model"),
		).not.toContain("openai");
		// Callers that do not know the model yet keep the unfiltered answer.
		expect(await findManagedProviderIds()).toContain("openai");
	});

	it("treats an unrestricted credential as serving every model", async () => {
		await insertManaged({ id: "unrestricted-key" });

		expect(await findManagedProviderIds(undefined, "any-model")).toContain(
			"openai",
		);
	});

	it("advertises the provider when any credential allows the model", async () => {
		await insertManaged({
			id: "restricted-key",
			allowedModels: ["gpt-5.2"],
		});
		await insertManaged({ id: "unrestricted-key" });

		expect(
			await findManagedProviderIds(undefined, "some-other-model"),
		).toContain("openai");
	});

	it("falls back to a default credential when the variant's keys exclude the model", async () => {
		// Model filtering runs before variant narrowing (mirroring how
		// findManagedProviderKey applies its filter), so an enterprise request
		// whose enterprise credential lacks the model uses the shared default —
		// same as when the enterprise variant has no credential at all.
		await insertManaged({
			id: "ent-restricted",
			variant: "enterprise",
			allowedModels: ["gpt-5.2"],
		});
		await insertManaged({ id: "default-unrestricted" });

		expect(
			await findManagedProviderIds("enterprise", "some-other-model"),
		).toContain("openai");
	});

	it("selection skips a credential whose allowedModels exclude the model", async () => {
		const { resolvePlatformCredential } =
			await import("../chat/tools/resolve-platform-credential.js");
		await insertManaged({
			id: "restricted-key",
			allowedModels: ["gpt-5.2"],
		});
		await insertManaged({ id: "fallback-key" });

		const allowed = await resolvePlatformCredential("openai", {
			selectionScope: "gpt-5.2",
			model: "gpt-5.2",
			variant: undefined,
			region: undefined,
			requiresServiceTier: false,
		});
		expect(allowed.managedKey?.id).toBe("restricted-key");

		const excluded = await resolvePlatformCredential("openai", {
			selectionScope: "some-other-model",
			model: "some-other-model",
			variant: undefined,
			region: undefined,
			requiresServiceTier: false,
		});
		expect(excluded.managedKey?.id).toBe("fallback-key");
	});

	it("falls through to the env credential when every managed key excludes the model", async () => {
		const { resolvePlatformCredential } =
			await import("../chat/tools/resolve-platform-credential.js");
		await insertManaged({
			id: "restricted-key",
			allowedModels: ["gpt-5.2"],
		});

		// With no selectable managed credential the env-var path takes over;
		// whether an env key exists depends on the local environment, so only
		// assert that no managed credential is chosen.
		const result = await resolvePlatformCredential("openai", {
			selectionScope: "some-other-model",
			model: "some-other-model",
			variant: undefined,
			region: undefined,
			requiresServiceTier: false,
		}).catch(() => undefined);
		expect(result?.managedKey).toBeUndefined();
	});

	it("BYOK lookups skip keys excluded by the caller's model filter", async () => {
		await db.insert(providerKey).values({
			id: "byok-restricted",
			provider: "openai",
			token: "sk-byok-restricted",
			organizationId: ORG_ID,
			allowedModels: ["gpt-5.2"],
		});
		await db.insert(providerKey).values({
			id: "byok-open",
			provider: "openai",
			token: "sk-byok-open",
			organizationId: ORG_ID,
		});

		// resolveProviderContext passes this exact filter shape.
		const { providerKeyAllowsModel } = await import("@llmgateway/db");
		expect(
			(
				await findProviderKey(
					ORG_ID,
					"openai",
					"some-other-model",
					undefined,
					(key) =>
						providerKeyAllowsModel(key.allowedModels, "some-other-model"),
				)
			)?.id,
		).toBe("byok-open");
		expect(
			(
				await findProviderKey(ORG_ID, "openai", "gpt-5.2", undefined, (key) =>
					providerKeyAllowsModel(key.allowedModels, "gpt-5.2"),
				)
			)?.id,
		).toBe("byok-restricted");
	});
});

/**
 * The gateway serves managed credentials from the SWR mirror, so a credential
 * added through the admin API has to appear without anyone flushing a cache.
 * `cdb` writes invalidate the Drizzle cache and the SWR mirrors centrally by
 * table; these cases prove the new provider_key keys are wired into that and
 * do not go stale. They deliberately never touch redisClient after the first
 * read — a manual flush would hide exactly the bug being guarded against.
 */
describe("managed credential cache invalidation", () => {
	beforeEach(async () => {
		resetKeyHealth();
		await waitForSwrMirrorWrites();
		await db.delete(providerKey);
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await db.delete(providerKey);
	});

	it("sees a credential written through cdb without a cache flush", async () => {
		// Prime the cache with the empty answer.
		expect(await findManagedProviderKey("openai")).toBeUndefined();
		expect(await findManagedProviderIds()).not.toContain("openai");

		await cdb.insert(providerKey).values({
			id: "cdb-written-key",
			provider: "openai",
			managed: true,
			organizationId: null,
			token: "sk-written-through-cdb",
		});
		await waitForSwrMirrorWrites();

		expect((await findManagedProviderKey("openai"))?.id).toBe(
			"cdb-written-key",
		);
		expect(await findManagedProviderIds()).toContain("openai");
		expect((await findManagedProviderKeyById("cdb-written-key"))?.token).toBe(
			"sk-written-through-cdb",
		);
	});

	it("stops serving a credential deactivated through cdb", async () => {
		await cdb.insert(providerKey).values({
			id: "to-deactivate",
			provider: "openai",
			managed: true,
			organizationId: null,
			token: "sk-deactivate-me",
		});
		await waitForSwrMirrorWrites();
		expect((await findManagedProviderKey("openai"))?.id).toBe("to-deactivate");

		await cdb
			.update(providerKey)
			.set({ status: "inactive" })
			.where(eq(providerKey.id, "to-deactivate"));
		await waitForSwrMirrorWrites();

		expect(await findManagedProviderKey("openai")).toBeUndefined();
		expect(await findManagedProviderIds()).not.toContain("openai");
	});
});

/**
 * Managed credentials are selected the same way BYOK keys are — index 0 of the
 * ordered array is the primary — so the admin's chosen order has to reach the
 * gateway, including through the variant and region narrowing that BYOK keys
 * never go through.
 */
describe("findManagedProviderKey - manual order", () => {
	beforeEach(async () => {
		resetKeyHealth();
		await waitForSwrMirrorWrites();
		await db.delete(providerKey);
		await redisClient.flushdb();
	});

	afterEach(async () => {
		await db.delete(providerKey);
	});

	async function setOrder(entries: Record<string, number | null>) {
		for (const [id, value] of Object.entries(entries)) {
			await cdb
				.update(providerKey)
				.set({ sortOrder: value })
				.where(eq(providerKey.id, id));
		}
	}

	it("prefers the manually ordered credential over the older one", async () => {
		await insertManaged({ id: "older" });
		await insertManaged({ id: "newer" });
		await setOrder({ newer: 0, older: 1 });

		expect((await findManagedProviderKey("openai"))?.id).toBe("newer");
	});

	it("falls back to createdAt order when nothing is positioned", async () => {
		await insertManaged({ id: "first-created" });
		await insertManaged({ id: "second-created" });

		expect((await findManagedProviderKey("openai"))?.id).toBe("first-created");
	});

	it("sorts an unpositioned credential after every positioned one", async () => {
		await insertManaged({ id: "positioned-a" });
		await insertManaged({ id: "positioned-b" });
		await insertManaged({ id: "unpositioned" });
		// Deliberately give the unpositioned credential the position that a
		// `default(0)` column would have handed it — it must still rank last.
		await setOrder({ "positioned-a": 0, "positioned-b": 1 });

		expect((await findManagedProviderKey("openai"))?.id).toBe("positioned-a");
		expect(
			(
				await findManagedProviderKey("openai", {
					excludedKeyIds: new Set(["positioned-a", "positioned-b"]),
				})
			)?.id,
		).toBe("unpositioned");
	});

	it("orders within the variant bucket a request resolves to", async () => {
		await insertManaged({ id: "ent-a", variant: "enterprise" });
		await insertManaged({ id: "ent-b", variant: "enterprise" });
		await insertManaged({ id: "def-a", variant: "default" });
		await setOrder({ "ent-b": 0, "def-a": 1, "ent-a": 2 });

		// Narrowing is order-preserving, so the enterprise request takes the
		// highest-ranked credential *it is allowed to use*, not the global first.
		expect(
			(await findManagedProviderKey("openai", { variant: "enterprise" }))?.id,
		).toBe("ent-b");
		expect((await findManagedProviderKey("openai"))?.id).toBe("def-a");
	});

	it("orders within the region bucket a request resolves to", async () => {
		await insertManaged({ id: "eu-a", region: "eu-central-1" });
		await insertManaged({ id: "eu-b", region: "eu-central-1" });
		await insertManaged({ id: "any-region" });
		await setOrder({ "eu-b": 0, "any-region": 1, "eu-a": 2 });

		expect(
			(await findManagedProviderKey("openai", { region: "eu-central-1" }))?.id,
		).toBe("eu-b");
		// A request with no region only ever sees the region-agnostic credential.
		expect((await findManagedProviderKey("openai"))?.id).toBe("any-region");
	});

	it("still fails over when the manual primary is unhealthy", async () => {
		await insertManaged({ id: "manual-primary" });
		await insertManaged({ id: "backup" });
		await setOrder({ "manual-primary": 0, backup: 1 });

		reportTrackedKeyError("manual-primary", 500);
		reportTrackedKeyError("manual-primary", 500);
		reportTrackedKeyError("manual-primary", 500);

		expect((await findManagedProviderKey("openai"))?.id).toBe("backup");
	});

	it("still fails over when a later credential has materially better uptime", async () => {
		// The uptime override is a product decision: manual order picks the
		// primary, health still wins.
		await insertManaged({ id: "flaky-primary" });
		await insertManaged({ id: "healthy-backup" });
		await setOrder({ "flaky-primary": 0, "healthy-backup": 1 });

		reportTrackedKeySuccess("flaky-primary");
		reportTrackedKeyError("flaky-primary", 500);
		reportTrackedKeySuccess("flaky-primary");
		reportTrackedKeyError("flaky-primary", 500);
		for (let i = 0; i < 4; i++) {
			reportTrackedKeySuccess("healthy-backup");
		}

		expect((await findManagedProviderKey("openai"))?.id).toBe("healthy-backup");
	});

	it("sees a reorder written through cdb with no cache flush", async () => {
		await insertManaged({ id: "was-primary" });
		await insertManaged({ id: "was-second" });

		// Prime the cache with the pre-reorder answer.
		expect((await findManagedProviderKey("openai"))?.id).toBe("was-primary");

		await setOrder({ "was-second": 0, "was-primary": 1 });
		await waitForSwrMirrorWrites();

		// Written through cdb, so the gateway picks up the new primary rather
		// than serving the cached one until the TTL expires.
		expect((await findManagedProviderKey("openai"))?.id).toBe("was-second");
	});
});
