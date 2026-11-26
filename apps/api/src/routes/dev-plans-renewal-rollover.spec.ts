import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import {
	DEV_PLAN_RENEWAL_ROLLOVER_PERCENT,
	getDevPlanCreditsLimit,
} from "@llmgateway/shared";

const ORG_ID = "test-renewal-rollover-org";
const PRO_ALLOTMENT = getDevPlanCreditsLimit("pro");

async function insertOrg(overrides: {
	devPlan?: "none" | "pro";
	devPlanCreditsUsed: string;
	devPlanPendingTier?: "lite";
}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		kind: "devpass",
		devPlan: "pro",
		devPlanCreditsLimit: String(PRO_ALLOTMENT),
		devPlanStripeSubscriptionId: "sub_rollover",
		devPlanCycle: "monthly",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function getRenewalRollover(token: string) {
	const res = await app.request("/dev-plans/status", {
		headers: { Cookie: token },
	});
	expect(res.status).toBe(200);
	const body = await res.json();
	return body.devPlanRenewalRollover;
}

describe("dev-plan status renewal carry-over", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("reports what is left of the allowance while it is under the cap", async () => {
		await insertOrg({ devPlanCreditsUsed: String(PRO_ALLOTMENT - 20.25) });

		expect(await getRenewalRollover(token)).toBe("20.25");
	});

	it("caps a lightly used cycle at the plan's share", async () => {
		await insertOrg({ devPlanCreditsUsed: "1" });

		expect(await getRenewalRollover(token)).toBe(
			(PRO_ALLOTMENT * DEV_PLAN_RENEWAL_ROLLOVER_PERCENT).toFixed(2),
		);
	});

	it("uses the cap of the tier scheduled for the renewal", async () => {
		await insertOrg({ devPlanCreditsUsed: "1", devPlanPendingTier: "lite" });

		expect(await getRenewalRollover(token)).toBe(
			(
				getDevPlanCreditsLimit("lite") * DEV_PLAN_RENEWAL_ROLLOVER_PERCENT
			).toFixed(2),
		);
	});

	it("reports nothing for an overspent cycle or an ended plan", async () => {
		await insertOrg({ devPlanCreditsUsed: String(PRO_ALLOTMENT + 5) });
		expect(await getRenewalRollover(token)).toBe("0.00");

		await deleteAll();
		token = await createTestUser();
		await insertOrg({ devPlan: "none", devPlanCreditsUsed: "0" });
		expect(await getRenewalRollover(token)).toBe("0.00");
	});
});
