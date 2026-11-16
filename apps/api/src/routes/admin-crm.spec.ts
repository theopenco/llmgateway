import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import {
	computeHealth,
	computeLeadScore,
	leadFollowUpDueAt,
} from "@/lib/crm.js";
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
	ownerEmail: string | null;
	lastTouchAt: string | null;
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

interface TaskRow {
	id: string;
	subject: string;
	accountId: string;
	accountName: string;
	contactEmail: string | null;
	dueAt: string | null;
}

async function listTasks(cookie: string): Promise<TaskRow[]> {
	const res = await call(cookie, "/crm/tasks");
	expect(res.status).toBe(200);
	return ((await res.json()) as { tasks: TaskRow[] }).tasks;
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
			id: "crm-l6",
			name: "Una Unconfirmed",
			email: "una@unconfirmed.io",
			spamFilterStatus: "unconfirmed",
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

		// The inquiry's own follow-up is the account's second open task.
		const before = await listAccounts(cookie);
		expect(before.kpis.overdueTasks).toBe(1);
		expect(
			before.accounts.find((a) => a.id === "prospectco.com"),
		).toMatchObject({ openTasks: 2, overdueTasks: 1 });

		const open = await listTasks(cookie);
		const own = open.filter((t) => t.accountId === "prospectco.com");
		expect(own.map((t) => t.subject)).toEqual([
			"Send security pack",
			"Reply to Pia Prospect's enterprise inquiry",
		]);
		expect(own[0]?.accountName).toBe("Prospectco");

		const done = await call(cookie, `/crm/activities/${task.id}`, {
			method: "PATCH",
			body: { completed: true },
		});
		expect(done.status).toBe(200);
		const after = await listTasks(cookie);
		expect(
			after
				.filter((t) => t.accountId === "prospectco.com")
				.map((t) => t.subject),
		).toEqual(["Reply to Pia Prospect's enterprise inquiry"]);
	});

	// Ways a new inquiry ends up forgotten or the list ends up wrong: it gets no
	// follow-up or no owner, the follow-up lands on a weekend, loading the desk
	// twice doubles it or fails, other tasks or activity on the account hide
	// it, it counts as a sales touch before anyone replied, spam, archived or
	// stale inquiries get one, it stays behind on an account its sender left,
	// it outlives the inquiry it was for, or deleting it brings it back.
	describe("follow-ups for new inquiries", () => {
		const reply = (name: string) => `Reply to ${name}'s enterprise inquiry`;

		async function leadTasks() {
			return (
				await db
					.select()
					.from(tables.crmActivity)
					.orderBy(tables.crmActivity.externalRef)
			).filter((row) => row.externalRef?.startsWith("lead:"));
		}

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("are created when the desk loads, due the next working day, with the default owner on lead accounts", async () => {
			vi.stubEnv("CRM_DEFAULT_OWNER_EMAIL", "owner@example.com");
			const [pia] = await db
				.select()
				.from(tables.enterpriseContactSubmission)
				.where(eq(tables.enterpriseContactSubmission.id, "crm-l1"));

			const tasks = await listTasks(cookie);

			expect(
				tasks.map((t) => [t.subject, t.accountId, t.contactEmail]).sort(),
			).toEqual([
				[reply("Pia Prospect"), "prospectco.com", "pia@prospectco.com"],
				[reply("Sofia Trial"), "trialco.io", "sofia@trialco.io"],
				[reply("Tom Freelance"), "lead:tom@gmail.com", "tom@gmail.com"],
			]);
			expect(tasks.find((t) => t.accountId === "prospectco.com")?.dueAt).toBe(
				leadFollowUpDueAt(pia!.createdAt).toISOString(),
			);
			const { accounts } = await listAccounts(cookie);
			const owners = Object.fromEntries(
				accounts.map((a) => [a.id, a.ownerEmail]),
			);
			expect(owners).toMatchObject({
				"prospectco.com": "owner@example.com",
				"lead:tom@gmail.com": "owner@example.com",
				"trialco.io": null,
			});
		});

		it("stay one per inquiry however often, or at once, the desk loads", async () => {
			const loads = await Promise.all([
				call(cookie, "/crm/tasks"),
				call(cookie, "/crm/accounts"),
				call(cookie, "/crm/tasks"),
			]);
			expect(loads.map((res) => res.status)).toEqual([200, 200, 200]);
			await listTasks(cookie);

			expect((await leadTasks()).map((row) => row.externalRef)).toEqual([
				"lead:crm-l1",
				"lead:crm-l2",
				"lead:crm-l3",
			]);
		});

		it("keep an owner someone already chose", async () => {
			vi.stubEnv("CRM_DEFAULT_OWNER_EMAIL", "owner@example.com");
			await db
				.insert(tables.crmAccount)
				.values({ id: "prospectco.com", ownerEmail: "ae@example.com" });

			const { accounts } = await listAccounts(cookie);

			expect(accounts.find((a) => a.id === "prospectco.com")).toMatchObject({
				ownerEmail: "ae@example.com",
				openTasks: 1,
			});
		});

		it("are not hidden by an older open task on the account", async () => {
			await db.insert(tables.crmAccount).values({ id: "trialco.io" });
			await db.insert(tables.crmActivity).values({
				accountId: "trialco.io",
				kind: "task",
				subject: "Plan the renewal",
				createdAt: daysFromNow(-20),
				dueAt: daysFromNow(60),
			});

			const tasks = await listTasks(cookie);

			expect(
				tasks
					.filter((t) => t.accountId === "trialco.io")
					.map((t) => t.subject)
					.sort(),
			).toEqual(["Plan the renewal", reply("Sofia Trial")]);
		});

		it("are not replaced by other activity on the account", async () => {
			const note = await call(
				cookie,
				"/crm/accounts/prospectco.com/activities",
				{ method: "POST", body: { kind: "note", subject: "Called the CTO" } },
			);
			expect(note.status).toBe(200);

			await listTasks(cookie);

			expect((await leadTasks()).map((row) => row.externalRef)).toEqual([
				"lead:crm-l1",
				"lead:crm-l2",
				"lead:crm-l3",
			]);
		});

		it("follow the inquiry when its sender moves to another account", async () => {
			await listTasks(cookie);
			await db.insert(tables.user).values({
				id: "crm-tom",
				name: "Tom Freelance",
				email: "tom@gmail.com",
				emailVerified: true,
			});
			await db.insert(tables.userOrganization).values({
				userId: "crm-tom",
				organizationId: "crm-trial",
				role: "developer",
			});

			const tasks = await listTasks(cookie);

			expect(
				tasks
					.filter((t) => t.subject === reply("Tom Freelance"))
					.map((t) => t.accountId),
			).toEqual(["trialco.io"]);
			expect(await leadTasks()).toHaveLength(3);
		});

		it("cannot be deleted, which would only bring them back", async () => {
			const tasks = await listTasks(cookie);
			const task = tasks.find((t) => t.accountId === "prospectco.com");

			const res = await call(cookie, `/crm/activities/${task?.id}`, {
				method: "DELETE",
			});

			expect(res.status).toBe(400);
			expect(await leadTasks()).toHaveLength(3);
		});

		it("count as a sales touch only once they are done", async () => {
			const tasks = await listTasks(cookie);
			const touched = async () =>
				(await listAccounts(cookie)).accounts.find(
					(a) => a.id === "prospectco.com",
				)?.lastTouchAt;
			expect(await touched()).toBeNull();

			const task = tasks.find((t) => t.accountId === "prospectco.com");
			await call(cookie, `/crm/activities/${task?.id}`, {
				method: "PATCH",
				body: { completed: true },
			});

			expect(await touched()).toEqual(expect.any(String));
			expect(
				(await listTasks(cookie)).filter(
					(t) => t.accountId === "prospectco.com",
				),
			).toEqual([]);
		});

		it("are not created for inquiries older than two weeks", async () => {
			await db
				.update(tables.enterpriseContactSubmission)
				.set({ createdAt: daysFromNow(-15) })
				.where(eq(tables.enterpriseContactSubmission.id, "crm-l1"));

			await listTasks(cookie);

			expect((await leadTasks()).map((row) => row.externalRef)).toEqual([
				"lead:crm-l2",
				"lead:crm-l3",
			]);
		});

		it("go away with their inquiry unless they were already done", async () => {
			const tasks = await listTasks(cookie);
			const toms = tasks.find((t) => t.accountId === "lead:tom@gmail.com");
			await call(cookie, `/crm/activities/${toms?.id}`, {
				method: "PATCH",
				body: { completed: true },
			});
			await db
				.update(tables.enterpriseContactSubmission)
				.set({ archivedAt: new Date() });

			await listTasks(cookie);

			expect(
				(await leadTasks()).map((row) => [row.externalRef, !!row.completedAt]),
			).toEqual([["lead:crm-l3", true]]);
		});

		it("are due by the end of the next working day", () => {
			const due = (iso: string) =>
				leadFollowUpDueAt(new Date(iso)).toISOString();

			// 2026-11-12 is a Thursday.
			expect(due("2026-11-12T22:30:00Z")).toBe("2026-11-13T17:00:00.000Z");
			expect(due("2026-11-12T02:00:00Z")).toBe("2026-11-13T17:00:00.000Z");
			expect(due("2026-11-13T15:00:00Z")).toBe("2026-11-16T17:00:00.000Z");
			expect(due("2026-11-14T09:00:00Z")).toBe("2026-11-16T17:00:00.000Z");
			expect(due("2026-11-15T23:59:00Z")).toBe("2026-11-16T17:00:00.000Z");
		});
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

describe("admin enterprise CRM input and time zones", () => {
	let cookie: string;
	const originalTz = process.env.TZ;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await seedBook();
	});

	afterEach(async () => {
		process.env.TZ = originalTz;
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("rejects unparseable dates with 400", async () => {
		const close = await call(cookie, "/crm/accounts/prospectco.com", {
			method: "PATCH",
			body: { closeDate: "next tuesday" },
		});
		expect(close.status).toBe(400);
		const task = await call(cookie, "/crm/accounts/prospectco.com/activities", {
			method: "POST",
			body: { kind: "task", subject: "Call", dueAt: "soon" },
		});
		expect(task.status).toBe(400);
	});

	it("accepts a date-only close date", async () => {
		const res = await call(cookie, "/crm/accounts/prospectco.com", {
			method: "PATCH",
			body: { closeDate: "2026-12-01" },
		});
		expect(res.status).toBe(200);
		const { accounts } = await listAccounts(cookie);
		const account = accounts.find((a) => a.id === "prospectco.com") as
			(Summary & { closeDate: string | null }) | undefined;
		expect(account?.closeDate).toBe("2026-12-01T00:00:00.000Z");
	});

	it("reports task due dates in UTC whatever the server time zone", async () => {
		process.env.TZ = "America/Los_Angeles";
		// Earlier than the inquiry's own follow-up, so it is the next one due.
		const dueAt = shift(new Date(), -1);
		dueAt.setUTCMilliseconds(0);
		const res = await call(cookie, "/crm/accounts/prospectco.com/activities", {
			method: "POST",
			body: { kind: "task", subject: "Follow up", dueAt: dueAt.toISOString() },
		});
		expect(res.status).toBe(200);
		const { accounts } = await listAccounts(cookie);
		const account = accounts.find((a) => a.id === "prospectco.com") as
			(Summary & { nextTaskDueAt: string | null }) | undefined;
		expect(account?.nextTaskDueAt).toBe(dueAt.toISOString());
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
