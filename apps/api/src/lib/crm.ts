import {
	and,
	db,
	desc,
	eq,
	gte,
	gt,
	inArray,
	isNull,
	ne,
	or,
	sql,
	tables,
	type CrmStage,
} from "@llmgateway/db";

export type CrmSegment = "customer" | "trial" | "lead" | "prospect";

const FREE_MAIL_DOMAINS = new Set([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"yahoo.co.uk",
	"yahoo.fr",
	"hotmail.com",
	"hotmail.co.uk",
	"outlook.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"gmx.com",
	"gmx.de",
	"web.de",
	"mail.com",
	"yandex.com",
	"yandex.ru",
	"zoho.com",
	"qq.com",
	"163.com",
	"126.com",
	"hey.com",
	"fastmail.com",
	"tutanota.com",
]);

export function emailDomain(email: string): string | null {
	const at = email.lastIndexOf("@");
	if (at < 0) {
		return null;
	}
	return (
		email
			.slice(at + 1)
			.trim()
			.toLowerCase() || null
	);
}

export function isFreeMailDomain(domain: string): boolean {
	return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

export function corporateDomain(
	email: string | null | undefined,
): string | null {
	if (!email) {
		return null;
	}
	const domain = emailDomain(email);
	return domain && !isFreeMailDomain(domain) ? domain : null;
}

export function companyNameFromDomain(domain: string): string {
	const label = domain.split(".")[0] ?? domain;
	return label
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function parseUserAgent(ua: string | null | undefined): string | null {
	if (!ua) {
		return null;
	}
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /Chrome\//.test(ua)
			? "Chrome"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Safari\//.test(ua)
					? "Safari"
					: /curl|python|node|axios/i.test(ua)
						? "Script"
						: "Browser";
	const os = /iPhone|iPad/.test(ua)
		? "iOS"
		: /Android/.test(ua)
			? "Android"
			: /Mac OS X/.test(ua)
				? "macOS"
				: /Windows/.test(ua)
					? "Windows"
					: /Linux/.test(ua)
						? "Linux"
						: null;
	return os ? `${browser} on ${os}` : browser;
}

const DAY_MS = 86_400_000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const SIXTY_DAYS_MS = 60 * DAY_MS;

function daysUntil(date: Date | null, now: Date): number | null {
	return date ? Math.ceil((date.getTime() - now.getTime()) / DAY_MS) : null;
}

export interface HealthInput {
	segment: CrmSegment;
	spend30d: number;
	spendPrev30d: number;
	lastUsageAt: Date | null;
	renewalAt: Date | null;
	trialEndsAt: Date | null;
	overdueTasks: number;
	lastTouchAt: Date | null;
	paymentFailures: number;
	now: Date;
}

export interface CrmScore {
	score: number;
	label: "healthy" | "watch" | "at_risk";
	reasons: string[];
}

function scoreLabel(score: number): CrmScore["label"] {
	return score >= 70 ? "healthy" : score >= 45 ? "watch" : "at_risk";
}

/**
 * Account health for customers and trials: usage recency and trend, upcoming
 * renewal or trial end, payment trouble and how recently sales touched it.
 */
export function computeHealth(input: HealthInput): CrmScore {
	const reasons: string[] = [];
	let score = 70;
	const idleDays = input.lastUsageAt
		? Math.floor((input.now.getTime() - input.lastUsageAt.getTime()) / DAY_MS)
		: null;
	if (idleDays === null) {
		score -= 35;
		reasons.push("No gateway traffic yet");
	} else if (idleDays > 14) {
		score -= 30;
		reasons.push(`No traffic for ${idleDays} days`);
	} else if (idleDays <= 2) {
		score += 5;
		reasons.push("Active in the last 48h");
	}
	if (input.spendPrev30d > 0) {
		const ratio = input.spend30d / input.spendPrev30d;
		const change = ratio - 1;
		const pct = Math.round(change * 100);
		if (change >= 0.2) {
			score += 15;
			reasons.push(`Spend up ${pct}% vs prior 30d`);
		} else if (change <= -0.3) {
			score -= 20;
			reasons.push(`Spend down ${Math.abs(pct)}% vs prior 30d`);
		}
	} else if (input.spend30d > 0) {
		score += 10;
		reasons.push("Ramping up: first month of spend");
	}
	const renewalIn = daysUntil(input.renewalAt, input.now);
	if (renewalIn !== null && renewalIn <= 45) {
		score -= renewalIn < 0 ? 25 : 10;
		reasons.push(
			renewalIn < 0
				? `Contract lapsed ${Math.abs(renewalIn)} days ago`
				: `Renewal in ${renewalIn} days`,
		);
	}
	const trialIn = daysUntil(input.trialEndsAt, input.now);
	if (input.segment === "trial" && trialIn !== null && trialIn <= 7) {
		score -= 10;
		reasons.push(
			trialIn < 0 ? "Trial has ended" : `Trial ends in ${trialIn} days`,
		);
	}
	if (input.paymentFailures > 0) {
		score -= 15;
		reasons.push(`${input.paymentFailures} failed payments`);
	}
	if (input.overdueTasks > 0) {
		score -= Math.min(20, input.overdueTasks * 10);
		reasons.push(`${input.overdueTasks} overdue follow-ups`);
	}
	const touchDays = input.lastTouchAt
		? Math.floor((input.now.getTime() - input.lastTouchAt.getTime()) / DAY_MS)
		: null;
	if (touchDays === null || touchDays > 30) {
		score -= 10;
		reasons.push(
			touchDays === null
				? "Never contacted by sales"
				: `No sales touch for ${touchDays} days`,
		);
	}
	score = Math.max(0, Math.min(100, score));
	return { score, label: scoreLabel(score), reasons };
}

const SIZE_POINTS: Record<string, number> = {
	"1-10": 0,
	"11-25": 5,
	"26-50": 10,
	"51-200": 20,
	"201-500": 28,
	"501-1000": 34,
	"1000+": 40,
};

export interface LeadScoreInput {
	size: string | null;
	deployment: string | null;
	corporateEmail: boolean;
	messageLength: number;
	hasPlatformAccount: boolean;
	submissions: number;
}

/** Fit + intent score for an inbound lead that is not on the platform yet. */
export function computeLeadScore(input: LeadScoreInput): CrmScore {
	const reasons: string[] = [];
	let score = 20;
	const sizePoints = input.size ? (SIZE_POINTS[input.size] ?? 10) : 0;
	if (sizePoints > 0) {
		score += sizePoints;
		reasons.push(`${input.size} employees`);
	}
	if (input.corporateEmail) {
		score += 15;
		reasons.push("Corporate email domain");
	} else {
		score -= 10;
		reasons.push("Free-mail address");
	}
	if (input.deployment === "self_host") {
		score += 10;
		reasons.push("Wants self-hosting (license deal)");
	} else if (input.deployment === "cloud") {
		score += 5;
		reasons.push("Wants managed cloud");
	}
	if (input.messageLength >= 200) {
		score += 10;
		reasons.push("Detailed requirements in message");
	}
	if (input.hasPlatformAccount) {
		score += 10;
		reasons.push("Already signed up on the platform");
	}
	if (input.submissions > 1) {
		score += 5;
		reasons.push(`Reached out ${input.submissions} times`);
	}
	score = Math.max(0, Math.min(100, score));
	return {
		score,
		label: score >= 60 ? "healthy" : score >= 40 ? "watch" : "at_risk",
		reasons,
	};
}

export interface CrmOrgRow {
	id: string;
	name: string;
	createdAt: Date;
	plan: "free" | "pro" | "enterprise";
	isTrialActive: boolean;
	trialStartDate: Date | null;
	trialEndDate: Date | null;
	planStartedAt: Date | null;
	planExpiresAt: Date | null;
	credits: string;
	billingEmail: string;
	billingCompany: string | null;
	billingAddress: string | null;
	billingTaxId: string | null;
	ssoAutoJoinDomain: string | null;
	stripeCustomerId: string | null;
	seats: number | null;
	status: string | null;
	paymentFailureCount: number;
}

export interface CrmMemberRow {
	organizationId: string;
	userId: string;
	email: string;
	name: string | null;
	role: string;
	joinedAt: Date;
}

export type CrmLeadRow = typeof tables.enterpriseContactSubmission.$inferSelect;
export type CrmAccountRow = typeof tables.crmAccount.$inferSelect;

export interface CrmBookEntry {
	id: string;
	domain: string | null;
	orgs: CrmOrgRow[];
	members: CrmMemberRow[];
	leads: CrmLeadRow[];
	crm: CrmAccountRow | null;
}

export function orgAccountKey(
	org: Pick<CrmOrgRow, "id" | "ssoAutoJoinDomain" | "billingEmail">,
	members: CrmMemberRow[],
): string {
	const owner = members.find((m) => m.role === "owner");
	return (
		org.ssoAutoJoinDomain?.toLowerCase() ??
		corporateDomain(org.billingEmail) ??
		corporateDomain(owner?.email) ??
		members.map((m) => corporateDomain(m.email)).find(Boolean) ??
		`org:${org.id}`
	);
}

export function leadAccountKey(
	email: string,
	memberKeys: Map<string, string>,
): string {
	const normalized = email.trim().toLowerCase();
	return (
		memberKeys.get(normalized) ??
		corporateDomain(normalized) ??
		`lead:${normalized}`
	);
}

function isDomainKey(key: string): boolean {
	return !key.startsWith("org:") && !key.startsWith("lead:");
}

const orgColumns = {
	id: tables.organization.id,
	name: tables.organization.name,
	createdAt: tables.organization.createdAt,
	plan: tables.organization.plan,
	isTrialActive: tables.organization.isTrialActive,
	trialStartDate: tables.organization.trialStartDate,
	trialEndDate: tables.organization.trialEndDate,
	planStartedAt: tables.organization.planStartedAt,
	planExpiresAt: tables.organization.planExpiresAt,
	credits: tables.organization.credits,
	billingEmail: tables.organization.billingEmail,
	billingCompany: tables.organization.billingCompany,
	billingAddress: tables.organization.billingAddress,
	billingTaxId: tables.organization.billingTaxId,
	ssoAutoJoinDomain: tables.organization.ssoAutoJoinDomain,
	stripeCustomerId: tables.organization.stripeCustomerId,
	seats: tables.organization.seats,
	status: tables.organization.status,
	paymentFailureCount: tables.organization.paymentFailureCount,
};

/**
 * Every company sales cares about, merged by company key: enterprise orgs
 * whose contract is current, orgs on a running enterprise trial, inbound
 * contact-form leads (not archived, not spam) and prospects added by hand.
 * Lapsed contracts and ended trials drop out; their CRM rows are kept but
 * only resurface if the company comes back in scope.
 */
export async function loadCrmBook(
	now: Date = new Date(),
): Promise<Map<string, CrmBookEntry>> {
	const org = tables.organization;
	const lead = tables.enterpriseContactSubmission;
	const [orgs, leads, crmRows] = await Promise.all([
		db
			.select(orgColumns)
			.from(org)
			.where(
				and(
					or(
						and(
							eq(org.plan, "enterprise"),
							or(isNull(org.planExpiresAt), gt(org.planExpiresAt, now)),
						),
						and(
							eq(org.isTrialActive, true),
							or(isNull(org.trialEndDate), gt(org.trialEndDate, now)),
						),
					),
					or(isNull(org.status), ne(org.status, "deleted")),
				),
			),
		db
			.select()
			.from(lead)
			.where(
				and(isNull(lead.archivedAt), ne(lead.spamFilterStatus, "rejected")),
			)
			.orderBy(desc(lead.createdAt)),
		db.select().from(tables.crmAccount),
	]);

	const orgIds = orgs.map((o) => o.id);
	const members = orgIds.length
		? await db
				.select({
					organizationId: tables.userOrganization.organizationId,
					userId: tables.user.id,
					email: tables.user.email,
					name: tables.user.name,
					role: tables.userOrganization.role,
					joinedAt: tables.userOrganization.createdAt,
				})
				.from(tables.userOrganization)
				.innerJoin(
					tables.user,
					eq(tables.user.id, tables.userOrganization.userId),
				)
				.where(inArray(tables.userOrganization.organizationId, orgIds))
		: [];

	const book = new Map<string, CrmBookEntry>();
	const entry = (id: string): CrmBookEntry => {
		let existing = book.get(id);
		if (!existing) {
			existing = {
				id,
				domain: isDomainKey(id) ? id : null,
				orgs: [],
				members: [],
				leads: [],
				crm: null,
			};
			book.set(id, existing);
		}
		return existing;
	};

	const memberKeys = new Map<string, string>();
	for (const o of orgs) {
		const orgMembers = members.filter((m) => m.organizationId === o.id);
		const key = orgAccountKey(o, orgMembers);
		const e = entry(key);
		e.orgs.push(o);
		e.members.push(...orgMembers);
		for (const m of orgMembers) {
			memberKeys.set(m.email.toLowerCase(), key);
		}
	}
	for (const l of leads) {
		entry(leadAccountKey(l.email, memberKeys)).leads.push(l);
	}
	for (const row of crmRows) {
		const existing = book.get(row.id);
		if (existing) {
			existing.crm = row;
		} else if (row.manual) {
			entry(row.id).crm = row;
		}
	}
	return book;
}

export function segmentOf(entry: CrmBookEntry, now: Date): CrmSegment {
	if (
		entry.orgs.some(
			(o) =>
				o.plan === "enterprise" &&
				(!o.planExpiresAt || o.planExpiresAt.getTime() > now.getTime()),
		)
	) {
		return "customer";
	}
	if (entry.orgs.length > 0) {
		return "trial";
	}
	return entry.leads.length > 0 ? "lead" : "prospect";
}

export function derivedStage(segment: CrmSegment): CrmStage {
	return segment === "customer"
		? "customer"
		: segment === "trial"
			? "trial"
			: "lead";
}

export interface OrgUsage {
	spend30d: number;
	spendPrev30d: number;
	requests30d: number;
	lastUsageAt: Date | null;
}

export async function loadOrgUsage(
	orgIds: string[],
	now: Date,
): Promise<Map<string, OrgUsage>> {
	const usage = new Map<string, OrgUsage>();
	if (orgIds.length === 0) {
		return usage;
	}
	const stats = tables.projectHourlyStats;
	const d30 = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
	const d60 = new Date(now.getTime() - SIXTY_DAYS_MS);
	const rows = await db
		.select({
			organizationId: tables.project.organizationId,
			spend30d: sql<number>`coalesce(sum(case when ${stats.hourTimestamp} >= ${d30}::timestamp then ${stats.cost} else 0 end), 0)`,
			spendPrev30d: sql<number>`coalesce(sum(case when ${stats.hourTimestamp} < ${d30}::timestamp then ${stats.cost} else 0 end), 0)`,
			requests30d: sql<number>`coalesce(sum(case when ${stats.hourTimestamp} >= ${d30}::timestamp then ${stats.requestCount} else 0 end), 0)`,
			lastUsageAt: sql<string | null>`max(${stats.hourTimestamp})`,
		})
		.from(stats)
		.innerJoin(tables.project, eq(tables.project.id, stats.projectId))
		.where(
			and(
				inArray(tables.project.organizationId, orgIds),
				gte(stats.hourTimestamp, d60),
			),
		)
		.groupBy(tables.project.organizationId);
	for (const r of rows) {
		usage.set(r.organizationId, {
			spend30d: Number(r.spend30d),
			spendPrev30d: Number(r.spendPrev30d),
			requests30d: Number(r.requests30d),
			lastUsageAt: r.lastUsageAt ? new Date(r.lastUsageAt) : null,
		});
	}
	return usage;
}

export interface ActivityStats {
	lastActivityAt: Date | null;
	openTasks: number;
	overdueTasks: number;
	nextTaskDueAt: Date | null;
}

export async function loadActivityStats(
	now: Date,
): Promise<Map<string, ActivityStats>> {
	const a = tables.crmActivity;
	const nowIso = now.toISOString();
	const rows = await db
		.select({
			accountId: a.accountId,
			lastActivityAt: sql<
				string | null
			>`max(coalesce(${a.completedAt}, ${a.createdAt}))`,
			openTasks: sql<number>`count(*) filter (where ${a.kind} = 'task' and ${a.completedAt} is null)`,
			overdueTasks: sql<number>`count(*) filter (where ${a.kind} = 'task' and ${a.completedAt} is null and ${a.dueAt} < ${nowIso}::timestamp)`,
			nextTaskDueAt: sql<
				string | null
			>`min(${a.dueAt}) filter (where ${a.kind} = 'task' and ${a.completedAt} is null)`,
		})
		.from(a)
		.groupBy(a.accountId);
	return new Map(
		rows.map((r) => [
			r.accountId,
			{
				lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt) : null,
				openTasks: Number(r.openTasks),
				overdueTasks: Number(r.overdueTasks),
				nextTaskDueAt: r.nextTaskDueAt ? new Date(r.nextTaskDueAt) : null,
			},
		]),
	);
}

function maxDate(...dates: (Date | null | undefined)[]): Date | null {
	const valid = dates.filter((d): d is Date => !!d);
	return valid.length
		? new Date(Math.max(...valid.map((d) => d.getTime())))
		: null;
}

function minDate(...dates: (Date | null | undefined)[]): Date | null {
	const valid = dates.filter((d): d is Date => !!d);
	return valid.length
		? new Date(Math.min(...valid.map((d) => d.getTime())))
		: null;
}

export interface CrmAccountSummary {
	id: string;
	name: string;
	domain: string | null;
	segment: CrmSegment;
	stage: CrmStage;
	stageOverridden: boolean;
	priority: "low" | "medium" | "high";
	ownerEmail: string | null;
	dealValue: number | null;
	closeDate: string | null;
	tags: string[];
	orgs: {
		id: string;
		name: string;
		plan: string;
		isTrialActive: boolean;
	}[];
	primaryContact: { name: string | null; email: string } | null;
	memberCount: number;
	leadCount: number;
	country: string | null;
	size: string | null;
	spend30d: number;
	spendPrev30d: number;
	requests30d: number;
	lastUsageAt: string | null;
	lastTouchAt: string | null;
	firstSeenAt: string;
	openTasks: number;
	overdueTasks: number;
	nextTaskDueAt: string | null;
	renewalAt: string | null;
	trialEndsAt: string | null;
	score: CrmScore;
	scoreKind: "health" | "lead";
}

export function summarizeAccount(
	e: CrmBookEntry,
	usage: Map<string, OrgUsage>,
	activity: Map<string, ActivityStats>,
	now: Date,
): CrmAccountSummary {
	const segment = segmentOf(e, now);
	const acts = activity.get(e.id);
	const orgUsage = e.orgs.map((o) => usage.get(o.id));
	const spend30d = orgUsage.reduce((s, u) => s + (u?.spend30d ?? 0), 0);
	const spendPrev30d = orgUsage.reduce((s, u) => s + (u?.spendPrev30d ?? 0), 0);
	const requests30d = orgUsage.reduce((s, u) => s + (u?.requests30d ?? 0), 0);
	const lastUsageAt = maxDate(...orgUsage.map((u) => u?.lastUsageAt));
	const renewalAt = maxDate(
		...e.orgs
			.filter((o) => o.plan === "enterprise")
			.map((o) => o.planExpiresAt),
	);
	const trialEndsAt = maxDate(
		...e.orgs.filter((o) => o.isTrialActive).map((o) => o.trialEndDate),
	);
	const latestLead = e.leads[0];
	const owner = e.members.find((m) => m.role === "owner") ?? e.members[0];
	const primaryContact = latestLead
		? { name: latestLead.name, email: latestLead.email }
		: owner
			? { name: owner.name, email: owner.email }
			: null;
	const score =
		segment === "lead" || segment === "prospect"
			? computeLeadScore({
					size: latestLead?.size ?? e.crm?.employeeCount ?? null,
					deployment: latestLead?.deployment ?? null,
					corporateEmail: e.domain !== null,
					messageLength: latestLead?.message.length ?? 0,
					hasPlatformAccount: e.members.length > 0,
					submissions: e.leads.length,
				})
			: computeHealth({
					segment,
					spend30d,
					spendPrev30d,
					lastUsageAt,
					renewalAt,
					trialEndsAt,
					overdueTasks: acts?.overdueTasks ?? 0,
					lastTouchAt: acts?.lastActivityAt ?? null,
					paymentFailures: e.orgs.reduce(
						(s, o) => s + o.paymentFailureCount,
						0,
					),
					now,
				});
	const name =
		e.crm?.displayName ??
		e.orgs.find((o) => o.billingCompany)?.billingCompany ??
		e.orgs[0]?.name ??
		(e.domain ? companyNameFromDomain(e.domain) : null) ??
		latestLead?.name ??
		e.id;
	const firstSeenAt =
		minDate(
			e.crm?.createdAt,
			...e.orgs.map((o) => o.createdAt),
			...e.leads.map((l) => l.createdAt),
		) ?? now;
	return {
		id: e.id,
		name,
		domain: e.domain,
		segment,
		stage: e.crm?.stage ?? derivedStage(segment),
		stageOverridden: !!e.crm?.stage,
		priority: e.crm?.priority ?? "medium",
		ownerEmail: e.crm?.ownerEmail ?? null,
		dealValue: e.crm?.dealValue ? Number(e.crm.dealValue) : null,
		closeDate: e.crm?.closeDate?.toISOString() ?? null,
		tags: e.crm?.tags ?? [],
		orgs: e.orgs.map((o) => ({
			id: o.id,
			name: o.name,
			plan: o.plan,
			isTrialActive: o.isTrialActive,
		})),
		primaryContact,
		memberCount: new Set(e.members.map((m) => m.userId)).size,
		leadCount: e.leads.length,
		country: latestLead?.country ?? e.crm?.headquarters ?? null,
		size: latestLead?.size ?? e.crm?.employeeCount ?? null,
		spend30d,
		spendPrev30d,
		requests30d,
		lastUsageAt: lastUsageAt?.toISOString() ?? null,
		lastTouchAt: acts?.lastActivityAt?.toISOString() ?? null,
		firstSeenAt: firstSeenAt.toISOString(),
		openTasks: acts?.openTasks ?? 0,
		overdueTasks: acts?.overdueTasks ?? 0,
		nextTaskDueAt: acts?.nextTaskDueAt?.toISOString() ?? null,
		renewalAt: renewalAt?.toISOString() ?? null,
		trialEndsAt: trialEndsAt?.toISOString() ?? null,
		score,
		scoreKind: segment === "lead" || segment === "prospect" ? "lead" : "health",
	};
}
