import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	type CrmCalendarEvent,
	type CrmIntegrationRow,
	getCalendarEvent,
	hasCalendarAccess,
	listCalendarEvents,
	researchConfigured,
	researchModel,
	runWebResearch,
} from "@/lib/crm-integrations.js";
import {
	type CrmAccountSummary,
	type CrmBookEntry,
	corporateDomain,
	emailDomain,
	isFreeMailDomain,
	loadAccountPeople,
	loadSummaries,
	resolveAccountIdForEmail,
} from "@/lib/crm.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import { db, desc, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Upcoming calls from the connected Google calendars, matched to CRM accounts
 * through their outside attendees, plus the per-call briefing and the
 * web-search research that prepares it.
 */
export const adminCrmCalls = new OpenAPIHono<ServerTypes>();

adminCrmCalls.use("/*", adminMiddleware);

const DAY_MS = 86_400_000;

const attendeeSchema = z.object({
	email: z.string(),
	name: z.string().nullable(),
	responseStatus: z.string(),
	organizer: z.boolean(),
	self: z.boolean(),
	internal: z.boolean(),
	accountId: z.string().nullable(),
});

const accountRefSchema = z.object({
	id: z.string(),
	name: z.string(),
	segment: z.enum(["customer", "trial", "lead", "prospect"]),
	stage: z.string(),
	dealValue: z.number().nullable(),
	lastTouchAt: z.string().nullable(),
	openTasks: z.number(),
});

const callSchema = z.object({
	integrationId: z.string(),
	calendar: z.string(),
	eventId: z.string(),
	summary: z.string(),
	description: z.string().nullable(),
	startAt: z.string(),
	endAt: z.string(),
	allDay: z.boolean(),
	joinUrl: z.string().nullable(),
	location: z.string().nullable(),
	htmlLink: z.string().nullable(),
	organizerEmail: z.string().nullable(),
	attendees: z.array(attendeeSchema),
	account: accountRefSchema.nullable(),
	// Corporate domain of the outside attendees when no account exists yet.
	suggestedDomain: z.string().nullable(),
});

type Call = z.infer<typeof callSchema>;

function accountRef(summary: CrmAccountSummary): Call["account"] {
	return {
		id: summary.id,
		name: summary.name,
		segment: summary.segment,
		stage: summary.stage,
		dealValue: summary.dealValue,
		lastTouchAt: summary.lastTouchAt,
		openTasks: summary.openTasks,
	};
}

async function enrichCall(
	event: CrmCalendarEvent,
	book: Map<string, CrmBookEntry>,
	summaries: Map<string, CrmAccountSummary>,
): Promise<Call> {
	const calendarDomain = emailDomain(event.calendar);
	const attendees = await Promise.all(
		event.attendees.map(async (a) => {
			const domain = emailDomain(a.email);
			const internal = a.self || (!!domain && domain === calendarDomain);
			const accountId = internal
				? null
				: await resolveAccountIdForEmail(a.email, book);
			return { ...a, internal, accountId };
		}),
	);
	const matched = attendees.find((a) => a.accountId)?.accountId ?? null;
	const summary = matched ? summaries.get(matched) : undefined;
	const suggestedDomain = summary
		? null
		: (attendees
				.filter((a) => !a.internal)
				.map((a) => corporateDomain(a.email))
				.find((d): d is string => !!d) ?? null);
	return {
		...event,
		attendees,
		account: summary ? accountRef(summary) : null,
		suggestedDomain,
	};
}

async function calendarIntegrations(): Promise<CrmIntegrationRow[]> {
	const rows = await db.query.crmIntegration.findMany({
		where: { provider: "gmail" },
		orderBy: { createdAt: "asc" },
	});
	return rows.filter(hasCalendarAccess);
}

const listCalls = createRoute({
	method: "get",
	path: "/crm/calls",
	request: {
		query: z.object({
			days: z.coerce.number().int().min(1).max(60).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							calls: z.array(callSchema),
							calendars: z.array(
								z.object({
									integrationId: z.string(),
									email: z.string(),
									calendar: z.boolean(),
								}),
							),
							errors: z.array(
								z.object({ calendar: z.string(), message: z.string() }),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Upcoming meetings with people outside the company, from every connected Google calendar.",
		},
	},
});

adminCrmCalls.openapi(listCalls, async (c) => {
	const days = c.req.valid("query").days ?? 14;
	const now = new Date();
	const [gmailRows, { book, summaries }] = await Promise.all([
		db.query.crmIntegration.findMany({
			where: { provider: "gmail" },
			orderBy: { createdAt: "asc" },
		}),
		loadSummaries(now),
	]);
	const byId = new Map(summaries.map((s) => [s.id, s]));
	const lookback = 2 * 3_600_000;
	const horizon = days * DAY_MS;
	const range = {
		from: new Date(now.getTime() - lookback),
		to: new Date(now.getTime() + horizon),
	};
	const errors: { calendar: string; message: string }[] = [];
	const lists = await Promise.all(
		gmailRows.filter(hasCalendarAccess).map(async (row) => {
			try {
				return await listCalendarEvents(row, range);
			} catch (error) {
				errors.push({
					calendar: row.accountEmail,
					message:
						error instanceof HTTPException
							? error.message
							: "Calendar request failed",
				});
				return [];
			}
		}),
	);
	const seen = new Set<string>();
	const external = lists.flat().filter((e) => {
		const key = `${e.summary}|${e.startAt}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		const calendarDomain = emailDomain(e.calendar);
		return e.attendees.some(
			(a) => !a.self && emailDomain(a.email) !== calendarDomain,
		);
	});
	const calls = await Promise.all(
		external.map((e) => enrichCall(e, book, byId)),
	);
	calls.sort((a, b) => a.startAt.localeCompare(b.startAt));
	return c.json({
		calls,
		calendars: gmailRows.map((row) => ({
			integrationId: row.id,
			email: row.accountEmail,
			calendar: hasCalendarAccess(row),
		})),
		errors,
	});
});

const getCall = createRoute({
	method: "get",
	path: "/crm/calls/{integrationId}/{eventId}",
	request: {
		params: z.object({
			integrationId: z.string().min(1),
			eventId: z.string().min(1),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ call: callSchema }).openapi({}),
				},
			},
			description: "One calendar event with its CRM matches.",
		},
	},
});

adminCrmCalls.openapi(getCall, async (c) => {
	const { integrationId, eventId } = c.req.valid("param");
	const row = (await calendarIntegrations()).find(
		(r) => r.id === integrationId,
	);
	if (!row) {
		throw new HTTPException(404, { message: "Calendar not connected" });
	}
	const [event, { book, summaries }] = await Promise.all([
		getCalendarEvent(row, eventId),
		loadSummaries(),
	]);
	const call = await enrichCall(
		event,
		book,
		new Map(summaries.map((s) => [s.id, s])),
	);
	return c.json({ call });
});

// --- AI research --------------------------------------------------------------

const RESEARCH_SYSTEM = `You prepare a sales rep for a call. Search the web, then answer in plain text (no markdown symbols, no tables): short titled sections, one fact per line, each line starting with "- ". Prefer recent, specific, verifiable facts; say "unknown" instead of guessing; never invent names, numbers or quotes. Keep it under 350 words.`;

const researchInput = z.object({
	accountId: z.string().min(1),
	kind: z.enum(["company", "person"]),
	// Required for a person brief.
	email: z.string().email().optional(),
	question: z.string().max(500).optional(),
});

const researchSchema = z.object({
	activityId: z.string(),
	subject: z.string(),
	text: z.string(),
	sources: z.array(z.string()),
	model: z.string(),
	createdAt: z.string(),
});

const research = createRoute({
	method: "post",
	path: "/crm/research",
	request: {
		body: { content: { "application/json": { schema: researchInput } } },
	},
	responses: {
		200: {
			content: { "application/json": { schema: researchSchema.openapi({}) } },
			description:
				"Web-search brief about the company or person, saved as a note on the account.",
		},
	},
});

adminCrmCalls.openapi(research, async (c) => {
	const body = c.req.valid("json");
	const user = c.get("user")!;
	const { book, summaries } = await loadSummaries();
	const entry = book.get(body.accountId);
	const summary = summaries.find((s) => s.id === body.accountId);
	if (!entry || !summary) {
		throw new HTTPException(404, { message: "Account not found" });
	}
	if (!researchConfigured()) {
		throw new HTTPException(503, {
			message:
				"AI research is not configured: set CRM_RESEARCH_GATEWAY_API_KEY on the API.",
		});
	}
	const people = await loadAccountPeople(entry);
	const profile = entry.crm;
	const companyFacts = [
		`Company: ${summary.name}`,
		entry.domain ? `Website domain: ${entry.domain}` : null,
		profile?.website ? `Website: ${profile.website}` : null,
		profile?.industry ? `Industry (CRM): ${profile.industry}` : null,
		(profile?.headquarters ?? summary.country)
			? `Location (CRM): ${profile?.headquarters ?? summary.country}`
			: null,
		(profile?.employeeCount ?? summary.size)
			? `Size (CRM): ${profile?.employeeCount ?? summary.size}`
			: null,
		profile?.linkedinUrl ? `LinkedIn: ${profile.linkedinUrl}` : null,
		profile?.useCase ? `Known use case: ${profile.useCase}` : null,
		`Relationship with LLM Gateway: ${summary.segment} (stage ${summary.stage})`,
	].filter(Boolean);

	let subject: string;
	let prompt: string;
	let contactEmail: string | null = null;
	if (body.kind === "company") {
		subject = `AI research: ${summary.name}`;
		prompt = [
			"Research this company for an upcoming sales call about LLM Gateway (an LLM API gateway/router).",
			...companyFacts,
			"",
			"Cover: what they do and who their customers are; size, funding and recent news (last 12 months); their AI/LLM usage or products and likely needs for an LLM gateway; key decision makers in engineering/AI; anything a rep should avoid or be aware of; 3 tailored talking points.",
			body.question ? `Also answer: ${body.question}` : "",
		].join("\n");
	} else {
		if (!body.email) {
			throw new HTTPException(400, {
				message: "A person brief needs the attendee's email",
			});
		}
		const email = body.email.toLowerCase();
		const person = people.find((p) => p.email === email);
		const contact = await db.query.crmContact.findFirst({
			where: { accountId: body.accountId, email },
		});
		contactEmail = email;
		const name = contact?.name ?? person?.name ?? null;
		subject = `AI research: ${name ?? email}`;
		const domain = emailDomain(email);
		prompt = [
			"Research this person for an upcoming sales call about LLM Gateway (an LLM API gateway/router).",
			`Name: ${name ?? "unknown"}`,
			`Email: ${email}`,
			domain && !isFreeMailDomain(domain)
				? `Works at (email domain): ${domain}`
				: null,
			contact?.title ? `Title (CRM): ${contact.title}` : null,
			contact?.role ? `Role in the deal (CRM): ${contact.role}` : null,
			contact?.linkedinUrl ? `LinkedIn: ${contact.linkedinUrl}` : null,
			"",
			...companyFacts,
			"",
			"Cover: current role and tenure, background and previous companies, public talks/posts/open-source about AI or infrastructure, what they likely care about in this conversation, 3 personal conversation openers. If you cannot identify the person with confidence, say so and give only what is certain.",
			body.question ? `Also answer: ${body.question}` : "",
		]
			.filter((line) => line !== null)
			.join("\n");
	}

	const result = await runWebResearch({ system: RESEARCH_SYSTEM, prompt });
	const text = result.sources.length
		? `${result.text}\n\nSources:\n${result.sources.map((s) => `- ${s}`).join("\n")}`
		: result.text;
	await db
		.insert(tables.crmAccount)
		.values({ id: body.accountId })
		.onConflictDoNothing();
	const [activity] = await db
		.insert(tables.crmActivity)
		.values({
			accountId: body.accountId,
			kind: "note",
			subject,
			body: `${text}\n\n(${result.model}, web search)`,
			contactEmail,
			authorEmail: user.email,
		})
		.returning();
	return c.json({
		activityId: activity!.id,
		subject,
		text,
		sources: result.sources,
		model: result.model,
		createdAt: activity!.createdAt.toISOString(),
	});
});

const researchStatus = createRoute({
	method: "get",
	path: "/crm/research/status",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({ available: z.boolean(), model: z.string() })
						.openapi({}),
				},
			},
			description: "Whether AI research is configured and which model runs it.",
		},
	},
});

adminCrmCalls.openapi(researchStatus, async (c) => {
	return c.json({ available: researchConfigured(), model: researchModel() });
});

// Latest research notes for an account, newest first.
const listResearch = createRoute({
	method: "get",
	path: "/crm/accounts/{id}/research",
	request: { params: z.object({ id: z.string().min(1) }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							notes: z.array(
								z.object({
									id: z.string(),
									subject: z.string(),
									body: z.string(),
									contactEmail: z.string().nullable(),
									authorEmail: z.string().nullable(),
									createdAt: z.string(),
								}),
							),
						})
						.openapi({}),
				},
			},
			description: "Saved AI research notes for the account.",
		},
	},
});

adminCrmCalls.openapi(listResearch, async (c) => {
	const { id } = c.req.valid("param");
	const rows = await db
		.select()
		.from(tables.crmActivity)
		.where(eq(tables.crmActivity.accountId, id))
		.orderBy(desc(tables.crmActivity.createdAt))
		.limit(50);
	return c.json({
		notes: rows
			.filter((r) => r.kind === "note" && r.subject.startsWith("AI research: "))
			.slice(0, 10)
			.map((r) => ({
				id: r.id,
				subject: r.subject,
				body: r.body ?? "",
				contactEmail: r.contactEmail,
				authorEmail: r.authorEmail,
				createdAt: r.createdAt.toISOString(),
			})),
	});
});
