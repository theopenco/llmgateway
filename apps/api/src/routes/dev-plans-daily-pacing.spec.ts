import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import {
	DEV_PLAN_DAY_LENGTH_MS,
	getDevPlanDailyLimit,
} from "@llmgateway/shared";

const ORG_ID = "test-daily-pacing-org";

async function insertOrg(overrides: {
	devPlanDailyCreditsUsed?: string;
	devPlanDayStart?: Date | null;
}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		kind: "devpass",
		devPlan: "pro",
		devPlanCreditsUsed: "20",
		devPlanCreditsLimit: "158",
		devPlanStripeSubscriptionId: "sub_daily",
		devPlanCycle: "monthly",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function getStatus(token: string) {
	const res = await app.request("/dev-plans/status", {
		headers: { Cookie: token },
	});
	expect(res.status).toBe(200);
	return await res.json();
}

describe("dev-plan daily pacing status", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("reports the daily pacing allowance, usage and window reset", async () => {
		const threeHoursMs = 3 * 60 * 60 * 1000;
		const dayStart = new Date(Date.now() - threeHoursMs);
		await insertOrg({
			devPlanDailyCreditsUsed: "2.25",
			devPlanDayStart: dayStart,
		});

		const body = await getStatus(token);

		expect(body.devPlanDailyLimit).toBe(getDevPlanDailyLimit("pro").toFixed(2));
		expect(body.devPlanDailyCreditsUsed).toBe("2.25");
		expect(body.devPlanDayResetsAt).toBe(
			new Date(dayStart.getTime() + DEV_PLAN_DAY_LENGTH_MS).toISOString(),
		);
	});

	it("reports zero usage and no reset once the window has rolled over", async () => {
		await insertOrg({
			devPlanDailyCreditsUsed: "9",
			devPlanDayStart: new Date(Date.now() - DEV_PLAN_DAY_LENGTH_MS - 1000),
		});

		const body = await getStatus(token);

		expect(body.devPlanDailyCreditsUsed).toBe("0.00");
		expect(body.devPlanDayResetsAt).toBeNull();
	});
});
