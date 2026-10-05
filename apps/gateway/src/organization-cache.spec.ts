import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForSwrMirrorWrites } from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	getEffectiveDiscount,
	invalidateOrganizationsCache,
	tables,
} from "@llmgateway/db";

import {
	findOrganizationByIdFresh,
	findOrganizationCachedById,
} from "./lib/cached-queries.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("credit debit cache eviction", () => {
	createGatewayApiTestHarness();
	afterEach(() => vi.restoreAllMocks());

	it("invalidates routing discounts when admin mutations insert and delete through cdb", async () => {
		expect(
			(await getEffectiveDiscount("org-id", "openai", "gpt-4o-mini")).discount,
		).toBe("0");
		await waitForSwrMirrorWrites();
		const [discount] = await cdb
			.insert(tables.discount)
			.values({
				organizationId: "org-id",
				provider: "openai",
				model: "gpt-4o-mini",
				discountPercent: "0.25",
			})
			.returning();
		expect(
			(await getEffectiveDiscount("org-id", "openai", "gpt-4o-mini")).discount,
		).toBe("0.25");
		await waitForSwrMirrorWrites();
		await cdb
			.delete(tables.discount)
			.where(eq(tables.discount.id, discount!.id));
		expect(
			(await getEffectiveDiscount("org-id", "openai", "gpt-4o-mini")).discount,
		).toBe("0");
	});

	it("refreshes both gateway read paths' outage fallback after a debit", async () => {
		const readPaths = [findOrganizationCachedById, findOrganizationByIdFresh];
		for (const find of readPaths) {
			expect(Number((await find("org-id"))?.credits)).toBe(100);
		}
		await waitForSwrMirrorWrites();
		await db
			.update(tables.organization)
			.set({ credits: "0" })
			.where(eq(tables.organization.id, "org-id"));
		await invalidateOrganizationsCache(["org-id"]);
		for (const find of readPaths) {
			expect(Number((await find("org-id"))?.credits)).toBe(0);
		}
		await waitForSwrMirrorWrites();
		vi.spyOn(cdb, "select").mockImplementation(() => {
			throw new Error("database unavailable after debit");
		});
		for (const find of readPaths) {
			expect(Number((await find("org-id"))?.credits)).toBe(0);
		}
	});

	it("drops both read paths' fallback when the old row must not be served", async () => {
		const readPaths = [findOrganizationCachedById, findOrganizationByIdFresh];
		for (const find of readPaths) {
			await find("org-id");
		}
		await waitForSwrMirrorWrites();
		await invalidateOrganizationsCache(["org-id"], { dropFallback: true });
		vi.spyOn(cdb, "select").mockImplementation(() => {
			throw new Error("database unavailable after block");
		});
		for (const find of readPaths) {
			await expect(find("org-id")).rejects.toThrow(
				"database unavailable after block",
			);
		}
	});
});
