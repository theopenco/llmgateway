import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
	db,
	followUpEmail,
	organization,
	project,
	user,
	userOrganization,
} from "@llmgateway/db";
import { uniqueId } from "@llmgateway/shared/random";

import { checkLowBalanceAlerts } from "./worker.js";

import type * as FollowUpEmailsModule from "./services/follow-up-emails.js";

type FollowUpEmails = typeof FollowUpEmailsModule;

const sendLowBalanceEmail = vi.hoisted(() => vi.fn());

vi.mock("./services/follow-up-emails.js", async (importOriginal) => ({
	...(await importOriginal<FollowUpEmails>()),
	sendLowBalanceEmail,
}));

const previousEmailFollowUps = process.env.EMAIL_FOLLOW_UPS;

describe("checkLowBalanceAlerts", () => {
	beforeEach(async () => {
		process.env.EMAIL_FOLLOW_UPS = "true";
		sendLowBalanceEmail.mockReset();
		await db.delete(followUpEmail);
		await db.delete(project);
		await db.delete(userOrganization);
		await db.delete(organization);
		await db.delete(user);
	});

	afterAll(() => {
		if (previousEmailFollowUps === undefined) {
			delete process.env.EMAIL_FOLLOW_UPS;
		} else {
			process.env.EMAIL_FOLLOW_UPS = previousEmailFollowUps;
		}
	});

	async function seedOrg(
		values: Partial<typeof organization.$inferInsert> = {},
	) {
		const [owner] = await db
			.insert(user)
			.values({
				email: `owner-${uniqueId()}@example.com`,
				name: "Owner",
				emailVerified: true,
			})
			.returning();

		const orgValues: typeof organization.$inferInsert = {
			name: "Low Balance Org",
			status: "active",
			billingEmail: owner.email,
			credits: "1.00",
			lastTopUpAmount: "100.00",
			...values,
		};

		const [org] = await db.insert(organization).values(orgValues).returning();

		await db.insert(userOrganization).values({
			userId: owner.id,
			organizationId: org.id,
			role: "owner",
		});

		return org;
	}

	it("alerts an organization without auto top-up", async () => {
		const org = await seedOrg();

		await checkLowBalanceAlerts([org.id]);

		expect(sendLowBalanceEmail).toHaveBeenCalledTimes(2);
		const sent = await db.select().from(followUpEmail);
		expect(sent.map((row) => row.emailType).sort()).toEqual([
			"low_balance_20",
			"low_balance_5",
		]);
	});

	it("stays silent when auto top-up will refill the balance", async () => {
		const org = await seedOrg({ autoTopUpEnabled: true });

		await checkLowBalanceAlerts([org.id]);

		expect(sendLowBalanceEmail).not.toHaveBeenCalled();
		expect(await db.select().from(followUpEmail)).toHaveLength(0);
	});

	it("alerts when auto top-up is enabled but stuck on payment failures", async () => {
		const org = await seedOrg({
			autoTopUpEnabled: true,
			paymentFailureStartedAt: new Date(),
		});

		await checkLowBalanceAlerts([org.id]);

		expect(sendLowBalanceEmail).toHaveBeenCalled();
	});

	it("alerts a risk-flagged organization despite auto top-up", async () => {
		const org = await seedOrg({ autoTopUpEnabled: true, riskFlagged: true });

		await checkLowBalanceAlerts([org.id]);

		expect(sendLowBalanceEmail).toHaveBeenCalled();
	});

	it("alerts a DevPass organization without pay-as-you-go", async () => {
		const org = await seedOrg({
			autoTopUpEnabled: true,
			kind: "devpass",
			devPlanPaygEnabled: false,
		});

		await checkLowBalanceAlerts([org.id]);

		expect(sendLowBalanceEmail).toHaveBeenCalled();
	});
});
