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

	it("nudges a shared recipient only once across multiple credit-less orgs", async () => {
		const [owner] = await db
			.insert(user)
			.values({
				email: "multi@example.com",
				name: "Multi Org User",
				emailVerified: true,
			})
			.returning();

		// Both orgs bill the same address, so the recipient must be nudged once.
		const [orgA] = await db
			.insert(organization)
			.values({
				name: "Org A",
				status: "active",
				devPlan: "none",
				billingEmail: "shared@example.com",
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		const [orgB] = await db
			.insert(organization)
			.values({
				name: "Org B",
				status: "active",
				devPlan: "none",
				billingEmail: "shared@example.com",
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values([
			{ userId: owner.id, organizationId: orgA.id, role: "owner" },
			{ userId: owner.id, organizationId: orgB.id, role: "owner" },
		]);

		await processNoPurchaseEmails();

		const sent = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sent).toHaveLength(1);
		expect([orgA.id, orgB.id]).toContain(sent[0].organizationId);
		expect(sent[0].sentTo).toBe("shared@example.com");

		// A subsequent run must not email the same recipient again via the other org.
		await processNoPurchaseEmails();

		const sentAfter = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sentAfter).toHaveLength(1);
	});

	it("nudges each distinct recipient even when orgs share an owner", async () => {
		const [owner] = await db
			.insert(user)
			.values({
				email: "distinct@example.com",
				name: "Distinct Recipient User",
				emailVerified: true,
			})
			.returning();

		// Same owner, but each org bills a different address — both addresses are
		// legitimate, never-nudged recipients and should each receive the email.
		const [orgA] = await db
			.insert(organization)
			.values({
				name: "Org A",
				status: "active",
				devPlan: "none",
				billingEmail: "billing-a@example.com",
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		const [orgB] = await db
			.insert(organization)
			.values({
				name: "Org B",
				status: "active",
				devPlan: "none",
				billingEmail: "billing-b@example.com",
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values([
			{ userId: owner.id, organizationId: orgA.id, role: "owner" },
			{ userId: owner.id, organizationId: orgB.id, role: "owner" },
		]);

		await processNoPurchaseEmails();

		const sent = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sent).toHaveLength(2);
		expect(sent.map((s) => s.sentTo).sort()).toEqual([
			"billing-a@example.com",
			"billing-b@example.com",
		]);
	});

	it("skips personal (DevPass) and chat orgs, only nudging the normal org", async () => {
		const [owner] = await db
			.insert(user)
			.values({
				email: "scoped@example.com",
				name: "Scoped User",
				emailVerified: true,
			})
			.returning();

		const [personalOrg] = await db
			.insert(organization)
			.values({
				name: "Personal",
				status: "active",
				isPersonal: true,
				devPlan: "none",
				billingEmail: owner.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		const [chatOrg] = await db
			.insert(organization)
			.values({
				name: "Chat",
				status: "active",
				isChat: true,
				devPlan: "none",
				billingEmail: owner.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		const [normalOrg] = await db
			.insert(organization)
			.values({
				name: "Default",
				status: "active",
				devPlan: "none",
				billingEmail: owner.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values([
			{ userId: owner.id, organizationId: personalOrg.id, role: "owner" },
			{ userId: owner.id, organizationId: chatOrg.id, role: "owner" },
			{ userId: owner.id, organizationId: normalOrg.id, role: "owner" },
		]);

		await processNoPurchaseEmails();

		const sent = await db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, "no_purchase"));
		expect(sent).toHaveLength(1);
		expect(sent[0].organizationId).toBe(normalOrg.id);
	});

	it("does not nudge an owner whose only orgs are personal or chat", async () => {
		const [owner] = await db
			.insert(user)
			.values({
				email: "chatonly@example.com",
				name: "Chat Only User",
				emailVerified: true,
			})
			.returning();

		const [chatOrg] = await db
			.insert(organization)
			.values({
				name: "Chat",
				status: "active",
				isChat: true,
				devPlan: "none",
				billingEmail: owner.email,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db.insert(userOrganization).values({
			userId: owner.id,
			organizationId: chatOrg.id,
			role: "owner",
		});

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
