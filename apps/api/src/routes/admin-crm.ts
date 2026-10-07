import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	type CrmAccountSummary,
	type CrmBookEntry,
	corporateDomain,
	loadActivityStats,
	loadCrmBook,
	loadOrgUsage,
	parseUserAgent,
	summarizeAccount,
} from "@/lib/crm.js";
import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	asc,
	count,
	CRM_ACTIVITY_KINDS,
	CRM_CONTACT_ROLES,
	CRM_STAGES,
	db,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Internal enterprise CRM: enterprise customers, enterprise trials and
 * inbound leads merged per company, with sales-owned fields, contacts,
 * activities and follow-up tasks layered on top.
 */
export const adminCrm = new OpenAPIHono<ServerTypes>();

adminCrm.use("/*", adminMiddleware);

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const SIXTY_DAYS_MS = 60 * DAY_MS;
const NINETY_DAYS_MS = 90 * DAY_MS;

const segmentSchema = z.enum(["customer", "trial", "lead", "prospect"]);
const stageSchema = z.enum(CRM_STAGES);
const prioritySchema = z.enum(["low", "medium", "high"]);

const scoreSchema = z.object({
	score: z.number(),
	label: z.enum(["healthy", "watch", "at_risk"]),
	reasons: z.array(z.string()),
});

const summarySchema = z.object({
	id: z.string(),
	name: z.string(),
	domain: z.string().nullable(),
	segment: segmentSchema,
	stage: stageSchema,
	stageOverridden: z.boolean(),
	priority: prioritySchema,
	ownerEmail: z.string().nullable(),
	dealValue: z.number().nullable(),
	closeDate: z.string().nullable(),
	tags: z.array(z.string()),
	orgs: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			plan: z.string(),
			isTrialActive: z.boolean(),
		}),
	),
	primaryContact: z
		.object({ name: z.string().nullable(), email: z.string() })
		.nullable(),
	memberCount: z.number(),
	leadCount: z.number(),
	country: z.string().nullable(),
	size: z.string().nullable(),
	spend30d: z.number(),
	spendPrev30d: z.number(),
	requests30d: z.number(),
	lastUsageAt: z.string().nullable(),
	lastTouchAt: z.string().nullable(),
	firstSeenAt: z.string(),
	openTasks: z.number(),
	overdueTasks: z.number(),
	nextTaskDueAt: z.string().nullable(),
	renewalAt: z.string().nullable(),
	trialEndsAt: z.string().nullable(),
	score: scoreSchema,
	scoreKind: z.enum(["health", "lead"]),
});

const kpisSchema = z.object({
	customers: z.number(),
	trials: z.number(),
	leads: z.number(),
	prospects: z.number(),
	contractedArr: z.number(),
	pipelineValue: z.number(),
	trialsEndingSoon: z.number(),
	renewalsSoon: z.number(),
	overdueTasks: z.number(),
	newLeads7d: z.number(),
	atRisk: z.number(),
	spend30d: z.number(),
});

async function loadSummaries(now: Date) {
	const book = await loadCrmBook(now);
	const entries = [...book.values()];
	const [usage, activity] = await Promise.all([
		loadOrgUsage(
			entries.flatMap((e) => e.orgs.map((o) => o.id)),
			now,
		),
		loadActivityStats(now),
	]);
	return {
		book,
		usage,
		summaries: entries.map((e) => summarizeAccount(e, usage, activity, now)),
	};
}

function computeKpis(
	summaries: CrmAccountSummary[],
	book: Map<string, CrmBookEntry>,
	now: Date,
): z.infer<typeof kpisSchema> {
	const within = (iso: string | null, days: number) => {
		if (!iso) {
			return false;
		}
		const delta = new Date(iso).getTime() - now.getTime();
		return delta <= daysBack(days) && delta >= -DAY_MS;
	};
	const open = (s: CrmAccountSummary) =>
		!["customer", "churned", "lost"].includes(s.stage);
	return {
		customers: summaries.filter((s) => s.segment === "customer").length,
		trials: summaries.filter((s) => s.segment === "trial").length,
		leads: summaries.filter((s) => s.segment === "lead").length,
		prospects: summaries.filter((s) => s.segment === "prospect").length,
		contractedArr: summaries
			.filter((s) => s.stage === "customer")
			.reduce((sum, s) => sum + (s.dealValue ?? 0), 0),
		pipelineValue: summaries
			.filter(open)
			.reduce((sum, s) => sum + (s.dealValue ?? 0), 0),
		trialsEndingSoon: summaries.filter(
			(s) => s.segment === "trial" && within(s.trialEndsAt, 14),
		).length,
		renewalsSoon: summaries.filter(
			(s) => s.segment === "customer" && within(s.renewalAt, 60),
		).length,
		overdueTasks: summaries.reduce((sum, s) => sum + s.overdueTasks, 0),
		newLeads7d: [...book.values()]
			.flatMap((e) => e.leads)
			.filter((l) => l.createdAt.getTime() >= now.getTime() - WEEK_MS).length,
		atRisk: summaries.filter(
			(s) => s.scoreKind === "health" && s.score.label === "at_risk",
		).length,
		spend30d: summaries.reduce((sum, s) => sum + s.spend30d, 0),
	};
}

const listAccounts = createRoute({
	method: "get",
	path: "/crm/accounts",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({ accounts: z.array(summarySchema), kpis: kpisSchema })
						.openapi({}),
				},
			},
			description: "Every enterprise customer, trial and lead, per company.",
		},
	},
});

adminCrm.openapi(listAccounts, async (c) => {
	const now = new Date();
	const { book, summaries } = await loadSummaries(now);
	summaries.sort(
		(a, b) =>
			new Date(b.lastTouchAt ?? b.firstSeenAt).getTime() -
			new Date(a.lastTouchAt ?? a.firstSeenAt).getTime(),
	);
	return c.json({
		accounts: summaries,
		kpis: computeKpis(summaries, book, now),
	});
});

const createAccount = createRoute({
	method: "post",
	path: "/crm/accounts",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						domain: z
							.string()
							.min(3)
							.regex(
								/^[a-z0-9.-]+\.[a-z]{2,}$/i,
								"Enter a domain like acme.com",
							),
						name: z.string().min(1),
						ownerEmail: z.string().email().optional(),
						dealValue: z.number().min(0).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ id: z.string() }).openapi({}),
				},
			},
			description: "Prospect account created (or existing one returned).",
		},
	},
});

adminCrm.openapi(createAccount, async (c) => {
	const body = c.req.valid("json");
	const id = body.domain.trim().toLowerCase();
	await db
		.insert(tables.crmAccount)
		.values({
			id,
			displayName: body.name,
			manual: true,
			ownerEmail: body.ownerEmail ?? c.get("user")?.email ?? null,
			dealValue: body.dealValue?.toString() ?? null,
			stage: "lead",
		})
		.onConflictDoUpdate({
			target: tables.crmAccount.id,
			set: { manual: true },
		});
	return c.json({ id });
});

const accountIdParam = z.object({ id: z.string().min(1) });

const activitySchema = z.object({
	id: z.string(),
	kind: z.enum(CRM_ACTIVITY_KINDS),
	subject: z.string(),
	body: z.string().nullable(),
	contactEmail: z.string().nullable(),
	authorEmail: z.string().nullable(),
	dueAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	createdAt: z.string(),
});

const personSchema = z.object({
	email: z.string(),
	name: z.string().nullable(),
	contactId: z.string().nullable(),
	title: z.string().nullable(),
	role: z.enum(CRM_CONTACT_ROLES).nullable(),
	phone: z.string().nullable(),
	linkedinUrl: z.string().nullable(),
	notes: z.string().nullable(),
	sources: z.array(z.enum(["lead", "member", "contact"])),
	corporateEmail: z.boolean(),
	memberships: z.array(
		z.object({
			orgId: z.string(),
			orgName: z.string(),
			plan: z.string(),
			role: z.string(),
			joinedAt: z.string(),
		}),
	),
	user: z
		.object({
			id: z.string(),
			createdAt: z.string(),
			emailVerified: z.boolean(),
			githubUsername: z.string().nullable(),
			xUsername: z.string().nullable(),
			lastSeenAt: z.string().nullable(),
			lastIp: z.string().nullable(),
			device: z.string().nullable(),
			sessionCount: z.number(),
		})
		.nullable(),
	submissionCount: z.number(),
	lastSubmissionAt: z.string().nullable(),
});

const detailSchema = z.object({
	account: summarySchema,
	profile: z.object({
		displayName: z.string().nullable(),
		website: z.string().nullable(),
		industry: z.string().nullable(),
		employeeCount: z.string().nullable(),
		headquarters: z.string().nullable(),
		linkedinUrl: z.string().nullable(),
		useCase: z.string().nullable(),
		competitors: z.string().nullable(),
		notes: z.string().nullable(),
		lostReason: z.string().nullable(),
	}),
	orgs: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			plan: z.string(),
			createdAt: z.string(),
			isTrialActive: z.boolean(),
			trialStartDate: z.string().nullable(),
			trialEndDate: z.string().nullable(),
			planStartedAt: z.string().nullable(),
			planExpiresAt: z.string().nullable(),
			credits: z.number(),
			seats: z.number().nullable(),
			billingEmail: z.string(),
			billingCompany: z.string().nullable(),
			billingAddress: z.string().nullable(),
			billingTaxId: z.string().nullable(),
			ssoAutoJoinDomain: z.string().nullable(),
			stripeCustomerId: z.string().nullable(),
			projectCount: z.number(),
			apiKeyCount: z.number(),
			memberCount: z.number(),
			spend30d: z.number(),
			requests30d: z.number(),
			lastUsageAt: z.string().nullable(),
		}),
	),
	people: z.array(personSchema),
	leads: z.array(
		z.object({
			id: z.string(),
			createdAt: z.string(),
			name: z.string(),
			email: z.string(),
			country: z.string(),
			size: z.string(),
			deployment: z.string().nullable(),
			message: z.string(),
			ipAddress: z.string().nullable(),
			device: z.string().nullable(),
			spamFilterStatus: z.string(),
		}),
	),
	usage: z.object({
		daily: z.array(
			z.object({ date: z.string(), cost: z.number(), requests: z.number() }),
		),
		topModels: z.array(
			z.object({
				model: z.string(),
				provider: z.string(),
				requests: z.number(),
				cost: z.number(),
			}),
		),
	}),
	revenue: z.object({
		lifetime: z.number(),
		last90d: z.number(),
		transactions: z.array(
			z.object({
				id: z.string(),
				createdAt: z.string(),
				type: z.string(),
				amount: z.number(),
				status: z.string(),
				description: z.string().nullable(),
			}),
		),
	}),
	activities: z.array(activitySchema),
	timeline: z.array(
		z.object({
			at: z.string(),
			kind: z.enum(["lead", "org", "trial", "plan", "member", "payment"]),
			title: z.string(),
			detail: z.string().nullable(),
		}),
	),
});

const getAccount = createRoute({
	method: "get",
	path: "/crm/accounts/{id}",
	request: { params: accountIdParam },
	responses: {
		200: {
			content: {
				"application/json": { schema: detailSchema.openapi({}) },
			},
			description: "Full CRM record for one company.",
		},
	},
});

const REVENUE_TYPES = [
	"credit_topup",
	"credit_manual_payment",
	"enterprise_license_fee",
	"subscription_start",
] as const;

function daysBack(days: number): number {
	return days * DAY_MS;
}

function iso(date: Date | null | undefined): string | null {
	return date ? date.toISOString() : null;
}

function serializeActivity(a: typeof tables.crmActivity.$inferSelect) {
	return {
		id: a.id,
		kind: a.kind,
		subject: a.subject,
		body: a.body,
		contactEmail: a.contactEmail,
		authorEmail: a.authorEmail,
		dueAt: iso(a.dueAt),
		completedAt: iso(a.completedAt),
		createdAt: a.createdAt.toISOString(),
	};
}

adminCrm.openapi(getAccount, async (c) => {
	const { id } = c.req.valid("param");
	const now = new Date();
	const { book, usage, summaries } = await loadSummaries(now);
	const entry = book.get(id);
	const account = summaries.find((s) => s.id === id);
	if (!entry || !account) {
		throw new HTTPException(404, { message: "Account not found" });
	}
	const orgIds = entry.orgs.map((o) => o.id);
	const crmContacts = await db
		.select()
		.from(tables.crmContact)
		.where(eq(tables.crmContact.accountId, id));
	const emails = [
		...new Set(
			[
				...entry.members.map((m) => m.email),
				...entry.leads.map((l) => l.email),
				...crmContacts.map((ct) => ct.email),
			].map((e) => e.toLowerCase()),
		),
	];
	const users = emails.length
		? await db
				.select({
					id: tables.user.id,
					email: tables.user.email,
					name: tables.user.name,
					createdAt: tables.user.createdAt,
					emailVerified: tables.user.emailVerified,
					githubUsername: tables.user.githubUsername,
					xUsername: tables.user.xUsername,
				})
				.from(tables.user)
				.where(inArray(sql`lower(${tables.user.email})`, emails))
		: [];
	const userIds = users.map((u) => u.id);
	const thirtyAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
	const sixtyAgo = new Date(now.getTime() - SIXTY_DAYS_MS);
	const ninetyAgo = now.getTime() - NINETY_DAYS_MS;

	const [
		lastSessions,
		sessionCounts,
		memberships,
		projectCounts,
		keyCounts,
		daily,
		topModels,
		transactions,
		activities,
	] = await Promise.all([
		userIds.length
			? db
					.selectDistinctOn([tables.session.userId], {
						userId: tables.session.userId,
						updatedAt: tables.session.updatedAt,
						ipAddress: tables.session.ipAddress,
						userAgent: tables.session.userAgent,
					})
					.from(tables.session)
					.where(inArray(tables.session.userId, userIds))
					.orderBy(tables.session.userId, desc(tables.session.updatedAt))
			: [],
		userIds.length
			? db
					.select({ userId: tables.session.userId, n: count() })
					.from(tables.session)
					.where(inArray(tables.session.userId, userIds))
					.groupBy(tables.session.userId)
			: [],
		userIds.length
			? db
					.select({
						userId: tables.userOrganization.userId,
						orgId: tables.organization.id,
						orgName: tables.organization.name,
						plan: tables.organization.plan,
						role: tables.userOrganization.role,
						joinedAt: tables.userOrganization.createdAt,
					})
					.from(tables.userOrganization)
					.innerJoin(
						tables.organization,
						eq(tables.organization.id, tables.userOrganization.organizationId),
					)
					.where(inArray(tables.userOrganization.userId, userIds))
			: [],
		orgIds.length
			? db
					.select({
						orgId: tables.project.organizationId,
						n: count(),
					})
					.from(tables.project)
					.where(
						and(
							inArray(tables.project.organizationId, orgIds),
							sql`${tables.project.status} <> 'deleted'`,
						),
					)
					.groupBy(tables.project.organizationId)
			: [],
		orgIds.length
			? db
					.select({ orgId: tables.project.organizationId, n: count() })
					.from(tables.apiKey)
					.innerJoin(
						tables.project,
						eq(tables.project.id, tables.apiKey.projectId),
					)
					.where(
						and(
							inArray(tables.project.organizationId, orgIds),
							sql`${tables.apiKey.status} <> 'deleted'`,
						),
					)
					.groupBy(tables.project.organizationId)
			: [],
		orgIds.length
			? db
					.select({
						day: sql<string>`to_char(date_trunc('day', ${tables.projectHourlyStats.hourTimestamp}), 'YYYY-MM-DD')`,
						cost: sql<number>`coalesce(sum(${tables.projectHourlyStats.cost}), 0)`,
						requests: sql<number>`coalesce(sum(${tables.projectHourlyStats.requestCount}), 0)`,
					})
					.from(tables.projectHourlyStats)
					.innerJoin(
						tables.project,
						eq(tables.project.id, tables.projectHourlyStats.projectId),
					)
					.where(
						and(
							inArray(tables.project.organizationId, orgIds),
							gte(tables.projectHourlyStats.hourTimestamp, sixtyAgo),
						),
					)
					.groupBy(sql`1`)
			: [],
		orgIds.length
			? db
					.select({
						model: tables.projectHourlyModelStats.usedModel,
						provider: tables.projectHourlyModelStats.usedProvider,
						requests: sql<number>`coalesce(sum(${tables.projectHourlyModelStats.requestCount}), 0)`,
						cost: sql<number>`coalesce(sum(${tables.projectHourlyModelStats.cost}), 0)`,
					})
					.from(tables.projectHourlyModelStats)
					.innerJoin(
						tables.project,
						eq(tables.project.id, tables.projectHourlyModelStats.projectId),
					)
					.where(
						and(
							inArray(tables.project.organizationId, orgIds),
							gte(tables.projectHourlyModelStats.hourTimestamp, thirtyAgo),
						),
					)
					.groupBy(
						tables.projectHourlyModelStats.usedModel,
						tables.projectHourlyModelStats.usedProvider,
					)
					.orderBy(desc(sql`4`))
					.limit(8)
			: [],
		orgIds.length
			? db
					.select()
					.from(tables.transaction)
					.where(
						and(
							inArray(tables.transaction.organizationId, orgIds),
							inArray(tables.transaction.type, [...REVENUE_TYPES]),
						),
					)
					.orderBy(desc(tables.transaction.createdAt))
			: [],
		db
			.select()
			.from(tables.crmActivity)
			.where(eq(tables.crmActivity.accountId, id))
			.orderBy(desc(tables.crmActivity.createdAt)),
	]);

	const dailyMap = new Map(daily.map((d) => [d.day, d]));
	const dailySeries = Array.from({ length: 60 }, (_, i) => {
		const day = new Date(now.getTime() - daysBack(59 - i))
			.toISOString()
			.slice(0, 10);
		const row = dailyMap.get(day);
		return {
			date: day,
			cost: Number(row?.cost ?? 0),
			requests: Number(row?.requests ?? 0),
		};
	});

	const completed = transactions.filter((t) => t.status === "completed");
	const amountOf = (t: (typeof transactions)[number]) => Number(t.amount ?? 0);

	const people = emails.map((email) => {
		const user = users.find((u) => u.email.toLowerCase() === email);
		const contact = crmContacts.find((ct) => ct.email.toLowerCase() === email);
		const leads = entry.leads.filter((l) => l.email.toLowerCase() === email);
		const member = entry.members.find((m) => m.email.toLowerCase() === email);
		const session = user
			? lastSessions.find((s) => s.userId === user.id)
			: undefined;
		const sources: ("lead" | "member" | "contact")[] = [];
		if (leads.length) {
			sources.push("lead");
		}
		if (member) {
			sources.push("member");
		}
		if (contact) {
			sources.push("contact");
		}
		return {
			email,
			name: contact?.name ?? leads[0]?.name ?? user?.name ?? null,
			contactId: contact?.id ?? null,
			title: contact?.title ?? null,
			role: contact?.role ?? null,
			phone: contact?.phone ?? null,
			linkedinUrl: contact?.linkedinUrl ?? null,
			notes: contact?.notes ?? null,
			sources,
			corporateEmail: corporateDomain(email) !== null,
			memberships: user
				? memberships
						.filter((m) => m.userId === user.id)
						.map((m) => ({
							orgId: m.orgId,
							orgName: m.orgName,
							plan: m.plan,
							role: m.role,
							joinedAt: m.joinedAt.toISOString(),
						}))
				: [],
			user: user
				? {
						id: user.id,
						createdAt: user.createdAt.toISOString(),
						emailVerified: user.emailVerified,
						githubUsername: user.githubUsername,
						xUsername: user.xUsername,
						lastSeenAt: iso(session?.updatedAt),
						lastIp: session?.ipAddress ?? null,
						device: parseUserAgent(session?.userAgent),
						sessionCount: Number(
							sessionCounts.find((s) => s.userId === user.id)?.n ?? 0,
						),
					}
				: null,
			submissionCount: leads.length,
			lastSubmissionAt: iso(leads[0]?.createdAt),
		};
	});
	const roleRank = (p: (typeof people)[number]) =>
		(p.role ? 0 : 1) + (p.sources.includes("lead") ? 0 : 1);
	people.sort((a, b) => roleRank(a) - roleRank(b));

	const timeline: z.infer<typeof detailSchema>["timeline"] = [];
	for (const l of entry.leads) {
		timeline.push({
			at: l.createdAt.toISOString(),
			kind: "lead",
			title: `${l.name} reached out via the enterprise form`,
			detail: l.message.slice(0, 180),
		});
	}
	for (const o of entry.orgs) {
		timeline.push({
			at: o.createdAt.toISOString(),
			kind: "org",
			title: `Organization “${o.name}” created`,
			detail: null,
		});
		if (o.trialStartDate) {
			timeline.push({
				at: o.trialStartDate.toISOString(),
				kind: "trial",
				title: "Enterprise trial started",
				detail: o.trialEndDate
					? `Runs until ${o.trialEndDate.toISOString().slice(0, 10)}`
					: null,
			});
		}
		if (o.planStartedAt && o.plan === "enterprise") {
			timeline.push({
				at: o.planStartedAt.toISOString(),
				kind: "plan",
				title: "Enterprise contract started",
				detail: o.planExpiresAt
					? `Term ends ${o.planExpiresAt.toISOString().slice(0, 10)}`
					: null,
			});
		}
	}
	for (const m of entry.members) {
		timeline.push({
			at: m.joinedAt.toISOString(),
			kind: "member",
			title: `${m.name ?? m.email} joined as ${m.role}`,
			detail: m.email,
		});
	}
	for (const t of completed.slice(0, 20)) {
		timeline.push({
			at: t.createdAt.toISOString(),
			kind: "payment",
			title: `${t.type.replaceAll("_", " ")} · $${amountOf(t).toLocaleString("en-US")}`,
			detail: t.description,
		});
	}
	timeline.sort((a, b) => b.at.localeCompare(a.at));

	return c.json({
		account,
		profile: {
			displayName: entry.crm?.displayName ?? null,
			website:
				entry.crm?.website ?? (entry.domain ? `https://${entry.domain}` : null),
			industry: entry.crm?.industry ?? null,
			employeeCount: entry.crm?.employeeCount ?? account.size,
			headquarters: entry.crm?.headquarters ?? account.country,
			linkedinUrl: entry.crm?.linkedinUrl ?? null,
			useCase: entry.crm?.useCase ?? null,
			competitors: entry.crm?.competitors ?? null,
			notes: entry.crm?.notes ?? null,
			lostReason: entry.crm?.lostReason ?? null,
		},
		orgs: entry.orgs.map((o) => {
			const u = usage.get(o.id);
			return {
				id: o.id,
				name: o.name,
				plan: o.plan,
				createdAt: o.createdAt.toISOString(),
				isTrialActive: o.isTrialActive,
				trialStartDate: iso(o.trialStartDate),
				trialEndDate: iso(o.trialEndDate),
				planStartedAt: iso(o.planStartedAt),
				planExpiresAt: iso(o.planExpiresAt),
				credits: Number(o.credits),
				seats: o.seats,
				billingEmail: o.billingEmail,
				billingCompany: o.billingCompany,
				billingAddress: o.billingAddress,
				billingTaxId: o.billingTaxId,
				ssoAutoJoinDomain: o.ssoAutoJoinDomain,
				stripeCustomerId: o.stripeCustomerId,
				projectCount: Number(
					projectCounts.find((p) => p.orgId === o.id)?.n ?? 0,
				),
				apiKeyCount: Number(keyCounts.find((k) => k.orgId === o.id)?.n ?? 0),
				memberCount: entry.members.filter((m) => m.organizationId === o.id)
					.length,
				spend30d: u?.spend30d ?? 0,
				requests30d: u?.requests30d ?? 0,
				lastUsageAt: iso(u?.lastUsageAt),
			};
		}),
		people,
		leads: entry.leads.map((l) => ({
			id: l.id,
			createdAt: l.createdAt.toISOString(),
			name: l.name,
			email: l.email,
			country: l.country,
			size: l.size,
			deployment: l.deployment,
			message: l.message,
			ipAddress: l.ipAddress,
			device: parseUserAgent(l.userAgent),
			spamFilterStatus: l.spamFilterStatus,
		})),
		usage: {
			daily: dailySeries,
			topModels: topModels.map((m) => ({
				model: m.model,
				provider: m.provider,
				requests: Number(m.requests),
				cost: Number(m.cost),
			})),
		},
		revenue: {
			lifetime: completed.reduce((s, t) => s + amountOf(t), 0),
			last90d: completed
				.filter((t) => t.createdAt.getTime() >= ninetyAgo)
				.reduce((s, t) => s + amountOf(t), 0),
			transactions: transactions.slice(0, 12).map((t) => ({
				id: t.id,
				createdAt: t.createdAt.toISOString(),
				type: t.type,
				amount: amountOf(t),
				status: t.status,
				description: t.description,
			})),
		},
		activities: activities.map(serializeActivity),
		timeline,
	});
});

async function assertAccount(id: string): Promise<void> {
	const book = await loadCrmBook();
	if (!book.has(id)) {
		throw new HTTPException(404, { message: "Account not found" });
	}
	await db.insert(tables.crmAccount).values({ id }).onConflictDoNothing();
}

const nullableText = z.string().nullable().optional();

const updateAccount = createRoute({
	method: "patch",
	path: "/crm/accounts/{id}",
	request: {
		params: accountIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						displayName: nullableText,
						stage: stageSchema.nullable().optional(),
						ownerEmail: nullableText,
						priority: prioritySchema.optional(),
						dealValue: z.number().min(0).nullable().optional(),
						closeDate: nullableText,
						website: nullableText,
						industry: nullableText,
						employeeCount: nullableText,
						headquarters: nullableText,
						linkedinUrl: nullableText,
						useCase: nullableText,
						competitors: nullableText,
						tags: z.array(z.string()).optional(),
						notes: nullableText,
						lostReason: nullableText,
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }).openapi({}),
				},
			},
			description: "Account updated.",
		},
	},
});

adminCrm.openapi(updateAccount, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await assertAccount(id);
	const { dealValue, closeDate, ...rest } = body;
	await db
		.update(tables.crmAccount)
		.set({
			...rest,
			...(dealValue !== undefined
				? { dealValue: dealValue === null ? null : dealValue.toString() }
				: {}),
			...(closeDate !== undefined
				? { closeDate: closeDate ? new Date(closeDate) : null }
				: {}),
		})
		.where(eq(tables.crmAccount.id, id));
	return c.json({ ok: true });
});

const createActivity = createRoute({
	method: "post",
	path: "/crm/accounts/{id}/activities",
	request: {
		params: accountIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						kind: z.enum(CRM_ACTIVITY_KINDS),
						subject: z.string().min(1),
						body: z.string().optional(),
						contactEmail: z.string().optional(),
						dueAt: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: activitySchema.openapi({}) },
			},
			description: "Activity logged.",
		},
	},
});

adminCrm.openapi(createActivity, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await assertAccount(id);
	const [row] = await db
		.insert(tables.crmActivity)
		.values({
			accountId: id,
			kind: body.kind,
			subject: body.subject,
			body: body.body || null,
			contactEmail: body.contactEmail || null,
			authorEmail: c.get("user")?.email ?? null,
			dueAt: body.kind === "task" && body.dueAt ? new Date(body.dueAt) : null,
		})
		.returning();
	return c.json(serializeActivity(row!));
});

const activityIdParam = z.object({ activityId: z.string() });

const updateActivity = createRoute({
	method: "patch",
	path: "/crm/activities/{activityId}",
	request: {
		params: activityIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						completed: z.boolean().optional(),
						dueAt: z.string().nullable().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }).openapi({}),
				},
			},
			description: "Activity updated.",
		},
	},
});

adminCrm.openapi(updateActivity, async (c) => {
	const { activityId } = c.req.valid("param");
	const body = c.req.valid("json");
	await db
		.update(tables.crmActivity)
		.set({
			...(body.completed !== undefined
				? { completedAt: body.completed ? new Date() : null }
				: {}),
			...(body.dueAt !== undefined
				? { dueAt: body.dueAt ? new Date(body.dueAt) : null }
				: {}),
		})
		.where(eq(tables.crmActivity.id, activityId));
	return c.json({ ok: true });
});

const deleteActivity = createRoute({
	method: "delete",
	path: "/crm/activities/{activityId}",
	request: { params: activityIdParam },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }).openapi({}),
				},
			},
			description: "Activity deleted.",
		},
	},
});

adminCrm.openapi(deleteActivity, async (c) => {
	const { activityId } = c.req.valid("param");
	await db
		.delete(tables.crmActivity)
		.where(eq(tables.crmActivity.id, activityId));
	return c.json({ ok: true });
});

const upsertContact = createRoute({
	method: "put",
	path: "/crm/accounts/{id}/contacts",
	request: {
		params: accountIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						email: z.string().email(),
						name: nullableText,
						title: nullableText,
						role: z.enum(CRM_CONTACT_ROLES).nullable().optional(),
						phone: nullableText,
						linkedinUrl: nullableText,
						notes: nullableText,
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ id: z.string() }).openapi({}),
				},
			},
			description: "Contact saved.",
		},
	},
});

adminCrm.openapi(upsertContact, async (c) => {
	const { id } = c.req.valid("param");
	const { email, ...fields } = c.req.valid("json");
	await assertAccount(id);
	const [row] = await db
		.insert(tables.crmContact)
		.values({ accountId: id, email: email.toLowerCase(), ...fields })
		.onConflictDoUpdate({
			target: [tables.crmContact.accountId, tables.crmContact.email],
			set: fields,
		})
		.returning({ id: tables.crmContact.id });
	return c.json({ id: row!.id });
});

const listTasks = createRoute({
	method: "get",
	path: "/crm/tasks",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							tasks: z.array(
								activitySchema.extend({
									accountId: z.string(),
									accountName: z.string(),
									segment: segmentSchema,
								}),
							),
						})
						.openapi({}),
				},
			},
			description: "Open follow-up tasks across every account.",
		},
	},
});

adminCrm.openapi(listTasks, async (c) => {
	const now = new Date();
	const [{ summaries }, rows] = await Promise.all([
		loadSummaries(now),
		db
			.select()
			.from(tables.crmActivity)
			.where(
				and(
					eq(tables.crmActivity.kind, "task"),
					isNull(tables.crmActivity.completedAt),
				),
			)
			.orderBy(
				sql`${tables.crmActivity.dueAt} asc nulls last`,
				asc(tables.crmActivity.createdAt),
			),
	]);
	const byId = new Map(summaries.map((s) => [s.id, s]));
	return c.json({
		tasks: rows.flatMap((r) => {
			const account = byId.get(r.accountId);
			return account
				? [
						{
							...serializeActivity(r),
							accountId: r.accountId,
							accountName: account.name,
							segment: account.segment,
						},
					]
				: [];
		}),
	});
});
