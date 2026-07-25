import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { redisClient, waitForSwrMirrorWrites } from "@llmgateway/cache";
import {
	db,
	organization,
	providerKey,
	type InferInsertModel,
} from "@llmgateway/db";

import { resetKeyHealth } from "./api-key-health.js";
import { findManagedProviderKey, findProviderKey } from "./cached-queries.js";

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
