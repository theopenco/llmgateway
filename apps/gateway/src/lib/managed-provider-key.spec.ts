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

import { resetKeyHealth } from "./api-key-health.js";
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
