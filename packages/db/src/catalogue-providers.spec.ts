import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	getCatalogueProviderIds,
	invalidateProviderClaimCache,
} from "./catalogue-providers.js";
import { db } from "./db.js";
import { providerClaim, providerCompany } from "./schema.js";

const companyId = "catalogue-cache-test-company";
const carrierId = "catalogue-cache-test-carrier";

describe("getCatalogueProviderIds", () => {
	beforeAll(async () => {
		await db
			.insert(providerCompany)
			.values({ id: companyId, name: "Cache test company" });
	});

	afterAll(async () => {
		await db.delete(providerCompany).where(eq(providerCompany.id, companyId));
		await invalidateProviderClaimCache();
	});

	it("serves the cached carrier set until the claim cache is invalidated", async () => {
		await invalidateProviderClaimCache();
		expect((await getCatalogueProviderIds()).has(carrierId)).toBe(false);
		// The plain client skips cache eviction, like a read that raced an
		// uncommitted claim transaction and re-cached the old set.
		await db.insert(providerClaim).values({
			providerCompanyId: companyId,
			providerId: carrierId,
			kind: "custom",
			status: "active",
			matchedDomain: "example.com",
		});
		expect((await getCatalogueProviderIds()).has(carrierId)).toBe(false);
		await invalidateProviderClaimCache();
		expect((await getCatalogueProviderIds()).has(carrierId)).toBe(true);
	});
});
