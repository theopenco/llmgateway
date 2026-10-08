import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	db,
	emailUnsubscribe,
	eq,
	followUpEmail,
	organization,
	project,
	projectHourlyStats,
	transaction,
	user,
	userOrganization,
} from "@llmgateway/db";

import {
	processLowUsageEmails,
	processNoPurchaseEmails,
	processNoRepurchaseEmails,
} from "./follow-up-emails.js";

import type * as EmailModule from "@llmgateway/shared/email";

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@llmgateway/shared/email", async (importOriginal) => ({
	...(await importOriginal<typeof EmailModule>()),
	getResendClient: () => ({ emails: { send: sendEmail } }),
}));

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
				name: "DevPass",
				status: "active",
				kind: "devpass",
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
				name: "DevPass",
				status: "active",
				kind: "devpass",
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
				kind: "chat",
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
				kind: "chat",
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

describe("processNoPurchaseEmails opt-outs", () => {
	beforeEach(async () => {
		await db.delete(followUpEmail);
		await db.delete(emailUnsubscribe);
		await db.delete(transaction);
		await db.delete(project);
		await db.delete(userOrganization);
		await db.delete(organization);
		await db.delete(user);
	});

	async function seedEligibleOrg(billingEmail: string) {
		const [owner] = await db
			.insert(user)
			.values({ email: billingEmail, name: "Owner", emailVerified: true })
			.returning();

		const [org] = await db
			.insert(organization)
			.values({
				name: "Eligible",
				status: "active",
				devPlan: "none",
				billingEmail,
				createdAt: TWO_DAYS_AGO,
			})
			.returning();

		await db
			.insert(userOrganization)
			.values({ userId: owner.id, organizationId: org.id, role: "owner" });

		return org;
	}

	it("skips a recipient who unsubscribed and leaves the ledger untouched", async () => {
		await seedEligibleOrg("optout@example.com");
		await db
			.insert(emailUnsubscribe)
			.values({ email: "optout@example.com", category: "marketing" });

		await processNoPurchaseEmails();

		// No ledger row: recording one would burn this org's once-ever slot, so a
		// later resubscribe could never be honoured.
		expect(await db.select().from(followUpEmail)).toHaveLength(0);
	});

	it("retries a failed send without retaining a sent ledger entry", async () => {
		await seedEligibleOrg("retry@example.com");
		vi.stubEnv("EMAIL_FOLLOW_UPS", "true");
		try {
			sendEmail.mockResolvedValueOnce({
				error: { message: "Temporary failure" },
				data: null,
			});
			await processNoPurchaseEmails();
			expect(await db.select().from(followUpEmail)).toHaveLength(0);
			sendEmail.mockResolvedValueOnce({
				error: null,
				data: { id: "test-email" },
			});
			await processNoPurchaseEmails();
			expect(await db.select().from(followUpEmail)).toHaveLength(1);
			expect(sendEmail).toHaveBeenCalledTimes(2);
		} finally {
			vi.unstubAllEnvs();
			sendEmail.mockReset();
		}
	});

	it("resumes nudging after the recipient resubscribes", async () => {
		await seedEligibleOrg("resub@example.com");
		await db
			.insert(emailUnsubscribe)
			.values({ email: "resub@example.com", category: "marketing" });

		await processNoPurchaseEmails();
		expect(await db.select().from(followUpEmail)).toHaveLength(0);

		await db.delete(emailUnsubscribe);
		await processNoPurchaseEmails();

		const sent = await db.select().from(followUpEmail);
		expect(sent).toHaveLength(1);
		expect(sent[0].sentTo).toBe("resub@example.com");
	});

	it("ignores a suppression recorded for the other category", async () => {
		await seedEligibleOrg("othercat@example.com");
		await db
			.insert(emailUnsubscribe)
			.values({ email: "othercat@example.com", category: "credit_alerts" });

		await processNoPurchaseEmails();

		expect(await db.select().from(followUpEmail)).toHaveLength(1);
	});
});

describe("usage-based follow-ups", () => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	const daysAgo = (days: number) => {
		const offsetMs = days * DAY_MS;
		return new Date(Date.now() - offsetMs);
	};

	beforeEach(async () => {
		await db.delete(followUpEmail);
		await db.delete(transaction);
		await db.delete(projectHourlyStats);
		await db.delete(project);
		await db.delete(userOrganization);
		await db.delete(organization);
		await db.delete(user);
	});

	async function seedOrg(opts: {
		email: string;
		topups: { daysAgo: number; credits: number }[];
		spent: number;
	}) {
		const [owner] = await db
			.insert(user)
			.values({ email: opts.email, name: opts.email, emailVerified: true })
			.returning();
		const [org] = await db
			.insert(organization)
			.values({
				name: opts.email,
				status: "active",
				devPlan: "none",
				billingEmail: opts.email,
				createdAt: daysAgo(40),
			})
			.returning();
		await db.insert(userOrganization).values({
			userId: owner.id,
			organizationId: org.id,
			role: "owner",
		});
		await db.insert(transaction).values(
			opts.topups.map((topup) => ({
				organizationId: org.id,
				type: "credit_topup" as const,
				status: "completed" as const,
				amount: String(topup.credits),
				creditAmount: String(topup.credits),
				createdAt: daysAgo(topup.daysAgo),
			})),
		);
		const [proj] = await db
			.insert(project)
			.values({ organizationId: org.id, name: "default" })
			.returning();
		if (opts.spent > 0) {
			await db.insert(projectHourlyStats).values({
				projectId: proj.id,
				hourTimestamp: daysAgo(1),
				cost: opts.spent,
			});
		}
		return org;
	}

	const sentTo = (emailType: "low_usage" | "no_repurchase") =>
		db
			.select()
			.from(followUpEmail)
			.where(eq(followUpEmail.emailType, emailType));

	it("nudges low usage only for orgs whose first topup falls in the window", async () => {
		const idle = await seedOrg({
			email: "idle@example.com",
			topups: [{ daysAgo: 5, credits: 100 }],
			spent: 1,
		});
		await seedOrg({
			email: "busy@example.com",
			topups: [{ daysAgo: 5, credits: 100 }],
			spent: 50,
		});
		// First topup predates the window: not a fresh customer any more.
		await seedOrg({
			email: "old@example.com",
			topups: [
				{ daysAgo: 60, credits: 100 },
				{ daysAgo: 5, credits: 100 },
			],
			spent: 0,
		});
		// Too recent to judge.
		await seedOrg({
			email: "new@example.com",
			topups: [{ daysAgo: 1, credits: 100 }],
			spent: 0,
		});

		await processLowUsageEmails();

		const sent = await sentTo("low_usage");
		expect(sent.map((row) => row.organizationId)).toEqual([idle.id]);
	});

	it("nudges a repurchase only for orgs whose last topup is stale and mostly consumed", async () => {
		const consumed = await seedOrg({
			email: "consumed@example.com",
			topups: [
				{ daysAgo: 60, credits: 100 },
				{ daysAgo: 20, credits: 100 },
			],
			spent: 150,
		});
		await seedOrg({
			email: "fresh@example.com",
			topups: [{ daysAgo: 3, credits: 100 }],
			spent: 90,
		});
		await seedOrg({
			email: "unused@example.com",
			topups: [{ daysAgo: 20, credits: 100 }],
			spent: 10,
		});
		// Last topup predates the window entirely.
		await seedOrg({
			email: "lapsed@example.com",
			topups: [{ daysAgo: 60, credits: 100 }],
			spent: 100,
		});

		await processNoRepurchaseEmails();

		const sent = await sentTo("no_repurchase");
		expect(sent.map((row) => row.organizationId)).toEqual([consumed.id]);
	});
});
