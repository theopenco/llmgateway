import { randomBytes } from "node:crypto";

import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	type CrmIntegrationRow,
	calendlyMe,
	calendlyWebhookSchema,
	calendlyWebhookUrl,
	createCalendlyWebhook,
	createOAuthState,
	deleteCalendlyWebhook,
	exchangeGmailCode,
	getGmailThread,
	gmailAuthorizeUrl,
	gmailConfigured,
	hasCalendarAccess,
	listCalendlyEventTypes,
	listCalendlyMeetings,
	listGmailThreads,
	meetingFromEvent,
	openCalendlyCredentials,
	readOAuthState,
	sealCredentials,
	sendGmail,
	upsertMeetingActivity,
	verifyCalendlySignature,
} from "@/lib/crm-integrations.js";
import {
	isFreeMailDomain,
	loadAccountPeople,
	loadCrmBook,
	resolveAccountIdForEmail,
} from "@/lib/crm.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import {
	CRM_INTEGRATION_PROVIDERS,
	db,
	desc,
	eq,
	shortid,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

/**
 * Gmail and Calendly inside the enterprise CRM: admins connect a mailbox or a
 * Calendly user once, then read and answer the threads an account's people
 * are on, send new mail, see every booked call and hand out booking links,
 * all from the account page. Sent mail and booked meetings land in the
 * account's activity feed.
 */
export const adminCrmIntegrations = new OpenAPIHono<ServerTypes>();

adminCrmIntegrations.use("/*", adminMiddleware);

const adminUrl = () => process.env.ADMIN_URL ?? "http://localhost:3006";

const integrationSchema = z.object({
	id: z.string(),
	provider: z.enum(CRM_INTEGRATION_PROVIDERS),
	accountEmail: z.string(),
	displayName: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	mine: z.boolean(),
	shared: z.boolean(),
	webhook: z.boolean(),
	// Gmail connections made before calendar access was requested need a
	// reconnect to show up on the calls page.
	calendar: z.boolean(),
	schedulingUrl: z.string().nullable(),
	createdAt: z.string(),
});

type IntegrationWithOwner = CrmIntegrationRow & {
	ownerEmail: string | null;
};

async function loadIntegrations(): Promise<IntegrationWithOwner[]> {
	const rows = await db
		.select({
			integration: tables.crmIntegration,
			ownerEmail: tables.user.email,
		})
		.from(tables.crmIntegration)
		.leftJoin(tables.user, eq(tables.user.id, tables.crmIntegration.userId))
		.orderBy(desc(tables.crmIntegration.createdAt));
	return rows.map((r) => ({ ...r.integration, ownerEmail: r.ownerEmail }));
}

function serializeIntegration(
	row: IntegrationWithOwner,
	userId: string,
): z.infer<typeof integrationSchema> {
	let webhook = false;
	let schedulingUrl: string | null = null;
	if (row.provider === "calendly") {
		try {
			const credentials = openCalendlyCredentials(row);
			webhook = Boolean(credentials.webhookUri);
			schedulingUrl = credentials.schedulingUrl ?? null;
		} catch (error) {
			logger.warn("CRM integration credentials unreadable", {
				id: row.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return {
		id: row.id,
		provider: row.provider,
		accountEmail: row.accountEmail,
		displayName: row.displayName,
		ownerEmail: row.ownerEmail,
		mine: row.userId === userId,
		shared: row.shared,
		webhook,
		calendar: row.provider === "gmail" && hasCalendarAccess(row),
		schedulingUrl,
		createdAt: row.createdAt.toISOString(),
	};
}

function canUse(row: CrmIntegrationRow, userId: string): boolean {
	return row.shared || row.userId === userId;
}

const listIntegrations = createRoute({
	method: "get",
	path: "/crm/integrations",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							integrations: z.array(integrationSchema),
							gmailAvailable: z.boolean(),
							calendlyWebhookUrl: z.string(),
						})
						.openapi({}),
				},
			},
			description: "Connected mailboxes and Calendly users.",
		},
	},
});

adminCrmIntegrations.openapi(listIntegrations, async (c) => {
	const userId = c.get("user")!.id;
	const rows = await loadIntegrations();
	return c.json({
		integrations: rows.map((r) => serializeIntegration(r, userId)),
		gmailAvailable: gmailConfigured(),
		calendlyWebhookUrl: calendlyWebhookUrl(),
	});
});

const connectGmail = createRoute({
	method: "post",
	path: "/crm/integrations/gmail/connect",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ shared: z.boolean().optional() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ url: z.string() }).openapi({}),
				},
			},
			description: "Google consent URL to send the browser to.",
		},
	},
});

adminCrmIntegrations.openapi(connectGmail, async (c) => {
	const state = createOAuthState({
		userId: c.get("user")!.id,
		sessionId: c.get("session")!.id,
		shared: c.req.valid("json").shared ?? false,
	});
	c.header("Cache-Control", "no-store");
	return c.json({ url: gmailAuthorizeUrl(state) });
});

const gmailCallback = createRoute({
	method: "get",
	path: "/crm/integrations/gmail/callback",
	request: {
		query: z.object({
			code: z.string().optional(),
			state: z.string().optional(),
			error: z.string().optional(),
		}),
	},
	responses: {
		302: { description: "Back to the CRM integrations page." },
	},
});

adminCrmIntegrations.openapi(gmailCallback, async (c) => {
	const { code, state, error } = c.req.valid("query");
	const target = new URL("/crm/settings", adminUrl());
	target.searchParams.set("integration", "gmail");
	c.header("Cache-Control", "no-store");
	c.header("Referrer-Policy", "no-referrer");
	try {
		if (error || !code || !state) {
			throw new HTTPException(400, {
				message:
					error === "access_denied"
						? "Google access was declined."
						: "Google did not return an authorization code.",
			});
		}
		const { shared } = readOAuthState(state, {
			userId: c.get("user")!.id,
			sessionId: c.get("session")!.id,
		});
		const { credentials, email } = await exchangeGmailCode(code);
		const id = shortid();
		const userId = c.get("user")!.id;
		const existing = await db.query.crmIntegration.findFirst({
			where: { provider: "gmail", accountEmail: email },
		});
		if (existing) {
			await db
				.update(tables.crmIntegration)
				.set({
					userId,
					shared,
					credentials: sealCredentials(existing.id, credentials),
				})
				.where(eq(tables.crmIntegration.id, existing.id));
		} else {
			await db.insert(tables.crmIntegration).values({
				id,
				provider: "gmail",
				userId,
				accountEmail: email,
				displayName: null,
				externalId: null,
				credentials: sealCredentials(id, credentials),
				shared,
			});
		}
		target.searchParams.set("status", "connected");
		target.searchParams.set("account", email);
	} catch (err) {
		target.searchParams.set("status", "error");
		target.searchParams.set(
			"message",
			err instanceof HTTPException
				? err.message
				: "Connecting Gmail failed. Try again.",
		);
		if (!(err instanceof HTTPException)) {
			logger.error("CRM Gmail callback failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return c.redirect(target.toString(), 302);
});

const connectCalendly = createRoute({
	method: "post",
	path: "/crm/integrations/calendly",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						token: z.string().min(20),
						shared: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: integrationSchema.openapi({}) },
			},
			description: "Calendly user connected.",
		},
	},
});

adminCrmIntegrations.openapi(connectCalendly, async (c) => {
	const { token, shared } = c.req.valid("json");
	const userId = c.get("user")!.id;
	const me = await calendlyMe(token.trim());
	const email = me.email.toLowerCase();
	const existing = await db.query.crmIntegration.findFirst({
		where: { provider: "calendly", accountEmail: email },
	});
	const id = existing?.id ?? shortid();
	let previous: ReturnType<typeof openCalendlyCredentials> | undefined;
	if (existing) {
		try {
			previous = openCalendlyCredentials(existing);
		} catch (error) {
			// Keyring rotated past the sealing key or a corrupt row: reconnecting
			// is the repair path, so start a fresh subscription.
			logger.warn("CRM Calendly credentials unreadable; resubscribing", {
				id: existing.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	let webhookUri = previous?.webhookUri;
	let signingKey = previous?.signingKey;
	if (!webhookUri) {
		signingKey = randomBytes(32).toString("hex");
		webhookUri = await createCalendlyWebhook({
			token: token.trim(),
			userUri: me.uri,
			organizationUri: me.current_organization,
			signingKey,
		});
	}
	const credentials = sealCredentials(id, {
		token: token.trim(),
		organizationUri: me.current_organization,
		schedulingUrl: me.scheduling_url,
		webhookUri,
		signingKey: webhookUri ? signingKey : undefined,
	});
	const values = {
		userId,
		accountEmail: email,
		displayName: me.name,
		externalId: me.uri,
		credentials,
		shared: shared ?? false,
	};
	const [row] = existing
		? await db
				.update(tables.crmIntegration)
				.set(values)
				.where(eq(tables.crmIntegration.id, id))
				.returning()
		: await db
				.insert(tables.crmIntegration)
				.values({ id, provider: "calendly", ...values })
				.returning();
	return c.json(
		serializeIntegration({ ...row!, ownerEmail: c.get("user")!.email }, userId),
	);
});

const integrationIdParam = z.object({ integrationId: z.string().min(1) });

async function ownedIntegration(
	integrationId: string,
	userId: string,
): Promise<CrmIntegrationRow> {
	const row = await db.query.crmIntegration.findFirst({
		where: { id: integrationId },
	});
	if (!row) {
		throw new HTTPException(404, { message: "Integration not found" });
	}
	if (row.userId !== userId) {
		throw new HTTPException(403, {
			message: "Only the admin who connected this account can change it",
		});
	}
	return row;
}

const updateIntegration = createRoute({
	method: "patch",
	path: "/crm/integrations/{integrationId}",
	request: {
		params: integrationIdParam,
		body: {
			content: {
				"application/json": { schema: z.object({ shared: z.boolean() }) },
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
			description: "Integration updated.",
		},
	},
});

adminCrmIntegrations.openapi(updateIntegration, async (c) => {
	const { integrationId } = c.req.valid("param");
	const { shared } = c.req.valid("json");
	await ownedIntegration(integrationId, c.get("user")!.id);
	await db
		.update(tables.crmIntegration)
		.set({ shared })
		.where(eq(tables.crmIntegration.id, integrationId));
	return c.json({ ok: true });
});

const deleteIntegration = createRoute({
	method: "delete",
	path: "/crm/integrations/{integrationId}",
	request: { params: integrationIdParam },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }).openapi({}),
				},
			},
			description: "Integration disconnected.",
		},
	},
});

adminCrmIntegrations.openapi(deleteIntegration, async (c) => {
	const { integrationId } = c.req.valid("param");
	const row = await ownedIntegration(integrationId, c.get("user")!.id);
	if (row.provider === "calendly") {
		try {
			const credentials = openCalendlyCredentials(row);
			if (credentials.webhookUri) {
				await deleteCalendlyWebhook(credentials.token, credentials.webhookUri);
			}
		} catch (error) {
			logger.warn("CRM Calendly cleanup skipped", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	await db
		.delete(tables.crmIntegration)
		.where(eq(tables.crmIntegration.id, integrationId));
	return c.json({ ok: true });
});

// --- Account mail -----------------------------------------------------------

const accountIdParam = z.object({ id: z.string().min(1) });

const addressSchema = z.object({
	name: z.string().nullable(),
	email: z.string(),
});

const threadSummarySchema = z.object({
	integrationId: z.string(),
	mailbox: z.string(),
	threadId: z.string(),
	subject: z.string(),
	snippet: z.string(),
	lastAt: z.string(),
	lastFrom: addressSchema.nullable(),
	participants: z.array(addressSchema),
	messageCount: z.number(),
	unread: z.boolean(),
});

const mailboxSchema = z.object({
	id: z.string(),
	email: z.string(),
	canSend: z.boolean(),
});

async function accountContext(id: string) {
	const book = await loadCrmBook();
	const entry = book.get(id);
	if (!entry) {
		throw new HTTPException(404, { message: "Account not found" });
	}
	const people = await loadAccountPeople(entry);
	return {
		entry,
		people,
		emails: people.map((p) => p.email),
		// Only a corporate domain widens the search; "gmail.com" would match
		// every thread in the mailbox.
		domain:
			entry.domain && !isFreeMailDomain(entry.domain) ? entry.domain : null,
	};
}

const listAccountMail = createRoute({
	method: "get",
	path: "/crm/accounts/{id}/mail",
	request: { params: accountIdParam },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							threads: z.array(threadSummarySchema),
							mailboxes: z.array(mailboxSchema),
							errors: z.array(
								z.object({ mailbox: z.string(), message: z.string() }),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Gmail threads with the account's people across every connected mailbox.",
		},
	},
});

adminCrmIntegrations.openapi(listAccountMail, async (c) => {
	const { id } = c.req.valid("param");
	const userId = c.get("user")!.id;
	const [{ emails, domain }, integrations] = await Promise.all([
		accountContext(id),
		db.query.crmIntegration.findMany({ where: { provider: "gmail" } }),
	]);
	const errors: { mailbox: string; message: string }[] = [];
	const results = await Promise.all(
		integrations.map(async (row) => {
			try {
				return await listGmailThreads(row, emails, domain);
			} catch (error) {
				errors.push({
					mailbox: row.accountEmail,
					message:
						error instanceof HTTPException
							? error.message
							: "Gmail request failed",
				});
				return [];
			}
		}),
	);
	const threads = results
		.flat()
		.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
	return c.json({
		threads,
		mailboxes: integrations.map((row) => ({
			id: row.id,
			email: row.accountEmail,
			canSend: canUse(row, userId),
		})),
		errors,
	});
});

const messageSchema = z.object({
	id: z.string(),
	messageId: z.string(),
	from: addressSchema.nullable(),
	to: z.array(addressSchema),
	cc: z.array(addressSchema),
	subject: z.string(),
	date: z.string(),
	snippet: z.string(),
	text: z.string(),
	unread: z.boolean(),
	attachments: z.array(z.string()),
});

const getThread = createRoute({
	method: "get",
	path: "/crm/integrations/{integrationId}/threads/{threadId}",
	request: {
		params: integrationIdParam.extend({ threadId: z.string().min(1) }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({ mailbox: z.string(), messages: z.array(messageSchema) })
						.openapi({}),
				},
			},
			description: "Every message in a thread.",
		},
	},
});

adminCrmIntegrations.openapi(getThread, async (c) => {
	const { integrationId, threadId } = c.req.valid("param");
	const row = await db.query.crmIntegration.findFirst({
		where: { id: integrationId, provider: "gmail" },
	});
	if (!row) {
		throw new HTTPException(404, { message: "Mailbox not found" });
	}
	const messages = await getGmailThread(row, threadId);
	return c.json({ mailbox: row.accountEmail, messages });
});

const activitySchema = z.object({
	id: z.string(),
	kind: z.string(),
	subject: z.string(),
	createdAt: z.string(),
});

const sendMail = createRoute({
	method: "post",
	path: "/crm/accounts/{id}/mail",
	request: {
		params: accountIdParam,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						integrationId: z.string().min(1),
						to: z.array(z.string().email()).min(1).max(20),
						cc: z.array(z.string().email()).max(20).optional(),
						subject: z.string().min(1).max(500),
						text: z.string().min(1).max(50_000),
						threadId: z.string().max(64).optional(),
						inReplyTo: z
							.string()
							.max(2000)
							.regex(/^[^\r\n]*$/)
							.optional(),
						references: z
							.string()
							.max(8000)
							.regex(/^[^\r\n]*$/)
							.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							threadId: z.string(),
							messageId: z.string(),
							activity: activitySchema,
						})
						.openapi({}),
				},
			},
			description: "Mail sent and logged on the account.",
		},
	},
});

adminCrmIntegrations.openapi(sendMail, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = c.get("user")!;
	const [{ entry, people }, row] = await Promise.all([
		accountContext(id),
		db.query.crmIntegration.findFirst({
			where: { id: body.integrationId, provider: "gmail" },
		}),
	]);
	if (!row) {
		throw new HTTPException(404, { message: "Mailbox not found" });
	}
	if (!canUse(row, user.id)) {
		throw new HTTPException(403, {
			message: `${row.accountEmail} is a private mailbox. Ask its owner to share it or connect your own.`,
		});
	}
	const named = (email: string) => ({
		email: email.toLowerCase(),
		name: people.find((p) => p.email === email.toLowerCase())?.name ?? null,
	});
	const sent = await sendGmail(row, {
		from: { email: row.accountEmail, name: row.displayName },
		to: body.to.map(named),
		cc: (body.cc ?? []).map(named),
		subject: body.subject,
		text: body.text,
		threadId: body.threadId,
		inReplyTo: body.inReplyTo,
		references: body.references,
	});
	await db
		.insert(tables.crmAccount)
		.values({ id: entry.id })
		.onConflictDoNothing();
	const [activity] = await db
		.insert(tables.crmActivity)
		.values({
			accountId: entry.id,
			kind: "email",
			subject: body.subject,
			body: `${body.threadId ? "Replied" : "Sent"} from ${row.accountEmail} to ${body.to.join(", ")}\n\n${body.text}`,
			contactEmail: body.to[0]!.toLowerCase(),
			authorEmail: user.email,
			externalRef: `gmail:${sent.id}`,
		})
		.returning();
	return c.json({
		threadId: sent.threadId,
		messageId: sent.id,
		activity: {
			id: activity!.id,
			kind: activity!.kind,
			subject: activity!.subject,
			createdAt: activity!.createdAt.toISOString(),
		},
	});
});

// --- Account meetings -------------------------------------------------------

const meetingSchema = z.object({
	integrationId: z.string(),
	host: z.string(),
	eventUri: z.string(),
	name: z.string(),
	status: z.enum(["active", "canceled"]),
	startAt: z.string(),
	endAt: z.string(),
	location: z.string().nullable(),
	joinUrl: z.string().nullable(),
	inviteeEmail: z.string(),
});

const calendlyConnectionSchema = z.object({
	id: z.string(),
	host: z.string(),
	canBook: z.boolean(),
});

const bookingLinkSchema = z.object({
	integrationId: z.string(),
	owner: z.string(),
	name: z.string(),
	duration: z.number(),
	url: z.string(),
});

const listAccountMeetings = createRoute({
	method: "get",
	path: "/crm/accounts/{id}/meetings",
	request: { params: accountIdParam },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							meetings: z.array(meetingSchema),
							bookingLinks: z.array(bookingLinkSchema),
							connections: z.array(calendlyConnectionSchema),
							errors: z.array(
								z.object({ host: z.string(), message: z.string() }),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Calendly meetings with the account's people plus the booking links admins can offer.",
		},
	},
});

adminCrmIntegrations.openapi(listAccountMeetings, async (c) => {
	const { id } = c.req.valid("param");
	const userId = c.get("user")!.id;
	const [{ entry, people, emails }, integrations] = await Promise.all([
		accountContext(id),
		db.query.crmIntegration.findMany({ where: { provider: "calendly" } }),
	]);
	const errors: { host: string; message: string }[] = [];
	const guard = async <T>(row: CrmIntegrationRow, run: () => Promise<T[]>) => {
		try {
			return await run();
		} catch (error) {
			const host = row.displayName ?? row.accountEmail;
			const message =
				error instanceof HTTPException
					? error.message
					: "Calendly request failed";
			if (!errors.some((e) => e.host === host && e.message === message)) {
				errors.push({ host, message });
			}
			return [] as T[];
		}
	};
	const [meetingLists, linkLists] = await Promise.all([
		Promise.all(
			integrations.map((row) =>
				guard(row, () => listCalendlyMeetings(row, emails)),
			),
		),
		Promise.all(
			integrations
				.filter((row) => canUse(row, userId))
				.map((row) => guard(row, () => listCalendlyEventTypes(row))),
		),
	]);
	const meetings = meetingLists
		.flat()
		.sort((a, b) => b.startAt.localeCompare(a.startAt));
	if (meetings.length) {
		await db
			.insert(tables.crmAccount)
			.values({ id: entry.id })
			.onConflictDoNothing();
		for (const meeting of meetings) {
			await upsertMeetingActivity(
				entry.id,
				meeting,
				people.find((p) => p.email === meeting.inviteeEmail)?.name,
			);
		}
	}
	return c.json({
		meetings,
		bookingLinks: linkLists.flat(),
		connections: integrations.map((row) => ({
			id: row.id,
			host: row.displayName ?? row.accountEmail,
			canBook: canUse(row, userId),
		})),
		errors,
	});
});

// --- Calendly webhook (unauthenticated, signature-verified) ----------------

export const crmWebhooks = new OpenAPIHono<ServerTypes>();

const calendlyWebhook = createRoute({
	method: "post",
	path: "/calendly",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }).openapi({}),
				},
			},
			description: "Event recorded (or ignored when it matches no account).",
		},
		401: { description: "Signature did not verify." },
	},
});

crmWebhooks.openapi(calendlyWebhook, async (c) => {
	const rawBody = await c.req.text();
	const signature = c.req.header("Calendly-Webhook-Signature");
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(rawBody);
	} catch {
		throw new HTTPException(400, { message: "Invalid JSON" });
	}
	const parsed = calendlyWebhookSchema.safeParse(parsedBody);
	if (!parsed.success) {
		// Other Calendly event kinds are not subscribed to; accept and ignore.
		return c.json({ ok: true });
	}
	const integrations = await db.query.crmIntegration.findMany({
		where: { provider: "calendly" },
	});
	const matching = integrations.find((row) => {
		try {
			const credentials = openCalendlyCredentials(row);
			return (
				!!credentials.signingKey &&
				verifyCalendlySignature(rawBody, signature, credentials.signingKey)
			);
		} catch {
			return false;
		}
	});
	if (!matching) {
		throw new HTTPException(401, { message: "Invalid webhook signature" });
	}
	const { payload } = parsed.data;
	const book = await loadCrmBook();
	const accountId = await resolveAccountIdForEmail(payload.email, book);
	if (!accountId) {
		return c.json({ ok: true });
	}
	await db
		.insert(tables.crmAccount)
		.values({ id: accountId })
		.onConflictDoNothing();
	await upsertMeetingActivity(
		accountId,
		meetingFromEvent(matching, payload.scheduled_event, payload.email),
		payload.name,
	);
	return c.json({ ok: true });
});
