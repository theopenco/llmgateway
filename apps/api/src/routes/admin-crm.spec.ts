import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { computeHealth, computeLeadScore } from "@/lib/crm.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const DAY = 86_400_000;

function shift(from: Date, days: number): Date {
	const offset = days * DAY;
	return new Date(from.getTime() + offset);
}

function daysFromNow(days: number): Date {
	return shift(new Date(), days);
}

interface Summary {
	id: string;
	segment: string;
	stage: string;
	leadCount: number;
	memberCount: number;
	overdueTasks: number;
	openTasks: number;
}

async function call(
	cookie: string,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<Response> {
	return await app.request(`/admin${path}`, {
		method: init.method ?? "GET",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
}

async function listAccounts(cookie: string) {
	const res = await call(cookie, "/crm/accounts");
	expect(res.status).toBe(200);
	return (await res.json()) as {
		accounts: Summary[];
		kpis: Record<string, number>;
	};
}

async function seedBook() {
	await db.insert(tables.organization).values([
		{
			id: "crm-customer",
			name: "Acme Corp",
			billingEmail: "ops@acme-corp.com",
			plan: "enterprise",
			planStartedAt: daysFromNow(-200),
			planExpiresAt: daysFromNow(165),
		},
		{
			id: "crm-lapsed",
			name: "Lapsed Inc",
			billingEmail: "ops@lapsed.io",
			plan: "enterprise",
			planStartedAt: daysFromNow(-400),
			planExpiresAt: daysFromNow(-10),
		},
		{
			id: "crm-trial",
			name: "TrialCo",
			billingEmail: "billing@trialco.io",
			isTrialActive: true,
			trialStartDate: daysFromNow(-10),
			trialEndDate: daysFromNow(5),
		},
		{
			id: "crm-ended-trial",
			name: "Old Trial",
			billingEmail: "billing@oldtrial.io",
			isTrialActive: false,
			trialStartDate: daysFromNow(-90),
			trialEndDate: daysFromNow(-60),
		},
		{
			id: "crm-stale-trial",
			name: "Stale Trial",
			billingEmail: "billing@staletrial.io",
			isTrialActive: true,
			trialStartDate: daysFromNow(-40),
			trialEndDate: daysFromNow(-1),
		},
		{
			id: "crm-free",
			name: "Free Org",
			billingEmail: "dev@nobody.io",
		},
	]);
	await db.insert(tables.user).values({
		id: "crm-trial-owner",
		name: "Tara Owner",
		email: "tara@trialco.io",
		emailVerified: true,
	});
	await db.insert(tables.userOrganization).values({
		userId: "crm-trial-owner",
		organizationId: "crm-trial",
		role: "owner",
	});
	const lead = {
		country: "Germany",
		size: "201-500",
		deployment: "cloud" as const,
		message: "We would like an enterprise plan with SSO.",
		spamFilterStatus: "delivered" as const,
	};
	await db.insert(tables.enterpriseContactSubmission).values([
		{
			...lead,
			id: "crm-l1",
			name: "Pia Prospect",
			email: "pia@prospectco.com",
		},
		{ ...lead, id: "crm-l2", name: "Sofia Trial", email: "Sofia@TrialCo.io" },
		{ ...lead, id: "crm-l3", name: "Tom Freelance", email: "tom@gmail.com" },
		{
			...lead,
			id: "crm-l4",
			name: "Spammer",
			email: "seo@spam.biz",
			spamFilterStatus: "rejected",
		},
		{
			...lead,
			id: "crm-l5",
			name: "Archie",
			email: "archie@archived.io",
			archivedAt: daysFromNow(-1),
		},
	]);
}

describe("admin enterprise CRM", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await seedBook();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("lists only current customers, running trials and inbound leads", async () => {
		const { accounts, kpis } = await listAccounts(cookie);
		const byId = new Map(accounts.map((a) => [a.id, a]));

		expect([...byId.keys()].sort()).toEqual([
			"acme-corp.com",
			"lead:tom@gmail.com",
			"prospectco.com",
			"trialco.io",
		]);
		expect(byId.get("acme-corp.com")?.segment).toBe("customer");
		expect(byId.get("prospectco.com")?.segment).toBe("lead");
		expect(byId.get("lead:tom@gmail.com")?.segment).toBe("lead");
		expect(kpis.customers).toBe(1);
		expect(kpis.trials).toBe(1);
		expect(kpis.leads).toBe(2);
		expect(kpis.trialsEndingSoon).toBe(1);
	});

	it("merges a lead into the trial org of the same company", async () => {
		const { accounts } = await listAccounts(cookie);
		const trial = accounts.find((a) => a.id === "trialco.io");
		expect(trial).toMatchObject({
			segment: "trial",
			stage: "trial",
			leadCount: 1,
			memberCount: 1,
		});

		const res = await call(cookie, "/crm/accounts/trialco.io");
		expect(res.status).toBe(200);
		const detail = (await res.json()) as {
			people: { email: string; sources: string[]; user: unknown }[];
			orgs: { id: string }[];
			leads: { id: string }[];
		};
		expect(detail.orgs.map((o) => o.id)).toEqual(["crm-trial"]);
		expect(detail.leads.map((l) => l.id)).toEqual(["crm-l2"]);
		const people = new Map(detail.people.map((p) => [p.email, p]));
		expect(people.get("sofia@trialco.io")?.sources).toEqual(["lead"]);
		expect(people.get("tara@trialco.io")?.sources).toEqual(["member"]);
		expect(people.get("tara@trialco.io")?.user).not.toBeNull();
	});

	it("drops a customer whose contract lapses, even after sales annotated it", async () => {
		const patch = await call(cookie, "/crm/accounts/acme-corp.com", {
			method: "PATCH",
			body: { stage: "negotiation", dealValue: 90000 },
		});
		expect(patch.status).toBe(200);

		await db
			.update(tables.organization)
			.set({ planExpiresAt: daysFromNow(-1) })
			.where(eq(tables.organization.id, "crm-customer"));

		const { accounts } = await listAccounts(cookie);
		expect(accounts.some((a) => a.id === "acme-corp.com")).toBe(false);
		expect((await call(cookie, "/crm/accounts/acme-corp.com")).status).toBe(
			404,
		);
		expect(
			(
				await call(cookie, "/crm/accounts/lapsed.io/activities", {
					method: "POST",
					body: { kind: "note", subject: "hello" },
				})
			).status,
		).toBe(404);
	});

	it("keeps prospects added by hand", async () => {
		const res = await call(cookie, "/crm/accounts", {
			method: "POST",
			body: { domain: "Initech.com", name: "Initech", dealValue: 75000 },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "initech.com" });

		const { accounts } = await listAccounts(cookie);
		expect(accounts.find((a) => a.id === "initech.com")).toMatchObject({
			segment: "prospect",
			stage: "lead",
		});
	});

	it("tracks follow-up tasks from creation to completion", async () => {
		const create = await call(
			cookie,
			"/crm/accounts/prospectco.com/activities",
			{
				method: "POST",
				body: {
					kind: "task",
					subject: "Send security pack",
					dueAt: daysFromNow(-1).toISOString(),
				},
			},
		);
		expect(create.status).toBe(200);
		const task = (await create.json()) as { id: string; authorEmail: string };
		expect(task.authorEmail).toBe("admin@example.com");

		const before = await listAccounts(cookie);
		expect(before.kpis.overdueTasks).toBe(1);
		expect(
			before.accounts.find((a) => a.id === "prospectco.com"),
		).toMatchObject({ openTasks: 1, overdueTasks: 1 });

		const open = (await (await call(cookie, "/crm/tasks")).json()) as {
			tasks: { id: string; accountName: string }[];
		};
		expect(open.tasks).toHaveLength(1);
		expect(open.tasks[0]?.accountName).toBe("Prospectco");

		const done = await call(cookie, `/crm/activities/${task.id}`, {
			method: "PATCH",
			body: { completed: true },
		});
		expect(done.status).toBe(200);
		const after = (await (await call(cookie, "/crm/tasks")).json()) as {
			tasks: unknown[];
		};
		expect(after.tasks).toHaveLength(0);
	});

	it("saves buying-committee contacts on an account", async () => {
		const res = await call(cookie, "/crm/accounts/trialco.io/contacts", {
			method: "PUT",
			body: {
				email: "Sofia@TrialCo.io",
				title: "Head of Platform",
				role: "champion",
			},
		});
		expect(res.status).toBe(200);
		const detail = (await (
			await call(cookie, "/crm/accounts/trialco.io")
		).json()) as {
			people: { email: string; role: string | null; sources: string[] }[];
		};
		expect(
			detail.people.find((p) => p.email === "sofia@trialco.io"),
		).toMatchObject({ role: "champion", sources: ["lead", "contact"] });
	});
});

describe("CRM scores", () => {
	const now = new Date("2026-10-06T12:00:00Z");

	it("flags a customer whose spend collapsed and who went quiet", () => {
		const score = computeHealth({
			segment: "customer",
			spend30d: 100,
			spendPrev30d: 1000,
			lastUsageAt: shift(now, -20),
			renewalAt: shift(now, 20),
			trialEndsAt: null,
			overdueTasks: 1,
			lastTouchAt: null,
			paymentFailures: 0,
			now,
		});
		expect(score.label).toBe("at_risk");
		expect(score.reasons).toEqual(
			expect.arrayContaining([
				"No traffic for 20 days",
				"Spend down 90% vs prior 30d",
				"Renewal in 20 days",
			]),
		);
	});

	it("rates a large self-host lead from a corporate domain above a free-mail one", () => {
		const strong = computeLeadScore({
			size: "1000+",
			deployment: "self_host",
			corporateEmail: true,
			messageLength: 400,
			hasPlatformAccount: false,
			submissions: 1,
		});
		const weak = computeLeadScore({
			size: "1-10",
			deployment: "not_sure",
			corporateEmail: false,
			messageLength: 40,
			hasPlatformAccount: false,
			submissions: 1,
		});
		expect(strong.score).toBeGreaterThan(weak.score);
		expect(strong.label).toBe("healthy");
		expect(weak.label).toBe("at_risk");
	});
});
