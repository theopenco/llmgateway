import { beforeEach, describe, expect, it } from "vitest";

import {
	db,
	eq,
	followUpEmail,
	organization,
	project,
	transaction,
	user,
	userOrganization,
} from "@llmgateway/db";

import { processNoPurchaseEmails } from "./follow-up-emails.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const TWO_DAYS_AGO = new Date(Date.now() - TWO_DAYS_MS);

describe("processNoPurchaseEmails DevPass exclusion", () => {
	beforeEach(async () => {
		await db.delete(followUpEmail);
		await db.delete(transaction);
		await db.delete(project);
		await db.delete(userOrganization);
		await db.delete(organization);
		await db.delete(user);
	});

	it("skips the no_purchase email when the owner has a DevPass on another org", async () => {
		const [devpassUser] = await db
			.insert(user)
			.values({
				email: "devpass@example.com",
				name: "DevPass User",
				emailVerified: true,
			})
			.returning();

		// Personal org carrying the active DevPass subscription.
		const [personalOrg] = await db
			.insert(organization)
			.values({
				name: "Personal",
				status: "active",
				isPersonal: true,
				devPlan: "lite",
				billingEmail: devpassUser.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		// Separate org with no credits purchased — eligible on its own merits.
		const [regularOrg] = await db
			.insert(organization)
			.values({
				name: "Regular",
				status: "active",
				devPlan: "none",
				billingEmail: devpassUser.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values([
			{ userId: devpassUser.id, organizationId: personalOrg.id, role: "owner" },
			{ userId: devpassUser.id, organizationId: regularOrg.id, role: "owner" },
		]);

		await processNoPurchaseEmails();

		const sent = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sent).toHaveLength(0);
	});

	it("sends the no_purchase email when the owner has no DevPass", async () => {
		const [freeUser] = await db
			.insert(user)
			.values({
				email: "free@example.com",
				name: "Free User",
				emailVerified: true,
			})
			.returning();

		const [regularOrg] = await db
			.insert(organization)
			.values({
				name: "Regular",
				status: "active",
				devPlan: "none",
				billingEmail: freeUser.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values({
			userId: freeUser.id,
			organizationId: regularOrg.id,
			role: "owner",
		});

		await processNoPurchaseEmails();

		const sent = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sent).toHaveLength(1);
		expect(sent[0].organizationId).toBe(regularOrg.id);
	});
});
