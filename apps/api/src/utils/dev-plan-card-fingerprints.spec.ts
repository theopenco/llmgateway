import { afterEach, describe, expect, it } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import { claimDevPlanCardFingerprint } from "./dev-plan-card-fingerprints.js";

describe("dev plan card fingerprint claims", () => {
	afterEach(async () => {
		await deleteAll();
	});

	it("allows only one organization to claim a fingerprint", async () => {
		await db.insert(tables.organization).values([
			{
				id: "fingerprint-org-a",
				name: "Fingerprint Org A",
				billingEmail: "admin@example.com",
			},
			{
				id: "fingerprint-org-b",
				name: "Fingerprint Org B",
				billingEmail: "admin@example.com",
			},
		]);

		const results = await Promise.all([
			claimDevPlanCardFingerprint("fingerprint-org-a", "shared-fingerprint"),
			claimDevPlanCardFingerprint("fingerprint-org-b", "shared-fingerprint"),
		]);
		const history = await db.query.devPlanCardFingerprintHistory.findMany();

		expect(history).toHaveLength(1);
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(results[0]).toEqual(
			history[0]?.organizationId === "fingerprint-org-a"
				? null
				: { id: "fingerprint-org-b" },
		);
		expect(results[1]).toEqual(
			history[0]?.organizationId === "fingerprint-org-b"
				? null
				: { id: "fingerprint-org-a" },
		);
	});
});
