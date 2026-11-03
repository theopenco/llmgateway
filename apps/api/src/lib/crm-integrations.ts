import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, eq, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";

import { openConnector, sealConnector } from "./connectors/crypto.js";

export type CrmIntegrationRow = typeof tables.crmIntegration.$inferSelect;

const CREDENTIAL_OWNER = "crm";
const REQUEST_TIMEOUT_MS = 20_000;

export const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
];
export const CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.events.readonly";
export const GOOGLE_SCOPES = [...GMAIL_SCOPES, CALENDAR_SCOPE];

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDLY_API = "https://api.calendly.com";

export function googleClient() {
	return {
		clientId:
			process.env.CRM_GOOGLE_CLIENT_ID?.trim() ||
			process.env.LOUNGE_GOOGLE_CLIENT_ID?.trim(),
		clientSecret:
			process.env.CRM_GOOGLE_CLIENT_SECRET?.trim() ||
			process.env.LOUNGE_GOOGLE_CLIENT_SECRET?.trim(),
	};
}

export function gmailConfigured(): boolean {
	const { clientId, clientSecret } = googleClient();
	return Boolean(clientId && clientSecret);
}

export function gmailCallbackUrl(): string {
	return new URL(
		"/admin/crm/integrations/gmail/callback",
		process.env.API_URL ?? "http://localhost:4002",
	).toString();
}

export function calendlyWebhookUrl(): string {
	return new URL(
		"/public/crm-webhooks/calendly",
		process.env.API_URL ?? "http://localhost:4002",
	).toString();
}

const gmailCredentialsSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresAt: z.number(),
	// Space-separated scopes Google granted; absent on connections made
	// before calendar access was requested.
	scope: z.string().optional(),
});
type GmailCredentials = z.infer<typeof gmailCredentialsSchema>;

const calendlyCredentialsSchema = z.object({
	token: z.string(),
	organizationUri: z.string(),
	schedulingUrl: z.string().optional(),
	webhookUri: z.string().optional(),
	signingKey: z.string().optional(),
});
type CalendlyCredentials = z.infer<typeof calendlyCredentialsSchema>;

export function sealCredentials(id: string, value: unknown): string {
	return sealConnector(value, CREDENTIAL_OWNER, id);
}

function openGmailCredentials(row: CrmIntegrationRow): GmailCredentials {
	return gmailCredentialsSchema.parse(
		openConnector(row.credentials, CREDENTIAL_OWNER, row.id),
	);
}

export function openCalendlyCredentials(
	row: CrmIntegrationRow,
): CalendlyCredentials {
	return calendlyCredentialsSchema.parse(
		openConnector(row.credentials, CREDENTIAL_OWNER, row.id),
	);
}

function externalFetch(input: string | URL, init?: RequestInit) {
	return fetch(input, {
		...init,
		signal: init?.signal
			? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
			: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
}

// OAuth state: a signed, short-lived token binding the consent flow to the
// admin session that started it, so a callback can only land on that user.
const STATE_TTL_MS = 600_000;

function signState(payload: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(payload)
		.digest("base64url");
}

export function createOAuthState(input: {
	userId: string;
	sessionId: string;
	shared: boolean;
}): string {
	const payload = Buffer.from(
		JSON.stringify({
			u: input.userId,
			s: input.sessionId,
			h: input.shared,
			e: Date.now() + STATE_TTL_MS,
			n: randomBytes(12).toString("base64url"),
		}),
	).toString("base64url");
	return `${payload}.${signState(payload)}`;
}

export function readOAuthState(
	state: string,
	expected: { userId: string; sessionId: string },
): { shared: boolean } {
	const [payload, signature] = state.split(".");
	if (!payload || !signature) {
		throw new HTTPException(400, { message: "Invalid authorization state" });
	}
	const expectedSignature = Buffer.from(signState(payload));
	const given = Buffer.from(signature);
	if (
		expectedSignature.length !== given.length ||
		!timingSafeEqual(expectedSignature, given)
	) {
		throw new HTTPException(400, { message: "Invalid authorization state" });
	}
	const parsed = z
		.object({
			u: z.string(),
			s: z.string(),
			h: z.boolean(),
			e: z.number(),
		})
		.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
	if (
		!parsed.success ||
		parsed.data.e < Date.now() ||
		parsed.data.u !== expected.userId ||
		parsed.data.s !== expected.sessionId
	) {
		throw new HTTPException(400, {
			message: "This authorization link expired. Start again from the CRM.",
		});
	}
	return { shared: parsed.data.h };
}

export function gmailAuthorizeUrl(state: string): string {
	const { clientId } = googleClient();
	if (!clientId) {
		throw new HTTPException(503, {
			message: "Gmail is not configured on this deployment",
		});
	}
	const url = new URL(GOOGLE_AUTHORIZE);
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: gmailCallbackUrl(),
		response_type: "code",
		scope: GOOGLE_SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		state,
	}).toString();
	return url.toString();
}

const googleTokenSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string().optional(),
	expires_in: z.number().optional(),
	scope: z.string().optional(),
});

function tokenExpiry(expiresIn: number | undefined): number {
	const lifetimeMs = (expiresIn ?? 3600) * 1000;
	return Date.now() + lifetimeMs;
}

async function googleToken(params: Record<string, string>) {
	const { clientId, clientSecret } = googleClient();
	if (!clientId || !clientSecret) {
		throw new HTTPException(503, {
			message: "Gmail is not configured on this deployment",
		});
	}
	const response = await externalFetch(GOOGLE_TOKEN, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			...params,
		}),
	});
	if (!response.ok) {
		throw new HTTPException(
			response.status === 400 || response.status === 401 ? 409 : 502,
			{ message: "Google rejected the authorization. Reconnect the mailbox." },
		);
	}
	const parsed = googleTokenSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new HTTPException(502, {
			message: "Google returned invalid credentials",
		});
	}
	return parsed.data;
}

export async function exchangeGmailCode(code: string): Promise<{
	credentials: GmailCredentials;
	email: string;
}> {
	const token = await googleToken({
		grant_type: "authorization_code",
		code,
		redirect_uri: gmailCallbackUrl(),
	});
	const granted = new Set((token.scope ?? "").split(" ").filter(Boolean));
	if (
		token.scope !== undefined &&
		GMAIL_SCOPES.some((scope) => !granted.has(scope))
	) {
		throw new HTTPException(400, {
			message:
				"Both Gmail permissions are required. Tick every box on the consent screen.",
		});
	}
	if (!token.refresh_token) {
		throw new HTTPException(400, {
			message:
				"Google did not issue a refresh token. Remove the app at myaccount.google.com/permissions and connect again.",
		});
	}
	const credentials: GmailCredentials = {
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: tokenExpiry(token.expires_in),
		scope: token.scope,
	};
	const profile = await gmailRequest(credentials.accessToken, "/profile");
	const email = z
		.object({ emailAddress: z.string().email() })
		.parse(profile).emailAddress;
	return { credentials, email: email.toLowerCase() };
}

export function hasCalendarAccess(row: CrmIntegrationRow): boolean {
	try {
		const scope = openGmailCredentials(row).scope;
		return !!scope && scope.split(" ").includes(CALENDAR_SCOPE);
	} catch {
		return false;
	}
}

async function gmailAccessToken(row: CrmIntegrationRow): Promise<string> {
	const credentials = openGmailCredentials(row);
	if (credentials.expiresAt > Date.now() + 60_000) {
		return credentials.accessToken;
	}
	const token = await googleToken({
		grant_type: "refresh_token",
		refresh_token: credentials.refreshToken,
	});
	const next: GmailCredentials = {
		accessToken: token.access_token,
		refreshToken: token.refresh_token ?? credentials.refreshToken,
		expiresAt: tokenExpiry(token.expires_in),
		scope: credentials.scope,
	};
	await db
		.update(tables.crmIntegration)
		.set({ credentials: sealCredentials(row.id, next) })
		.where(eq(tables.crmIntegration.id, row.id));
	return next.accessToken;
}

async function gmailRequest(
	token: string,
	path: string,
	init?: RequestInit & { query?: URLSearchParams },
): Promise<unknown> {
	const url = new URL(`${GMAIL_API}${path}`);
	if (init?.query) {
		url.search = init.query.toString();
	}
	const response = await externalFetch(url, {
		method: init?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
		},
		body: init?.body,
	});
	if (response.status === 401 || response.status === 403) {
		throw new HTTPException(409, {
			message: "Gmail access was revoked. Reconnect the mailbox.",
		});
	}
	if (!response.ok) {
		logger.warn("CRM Gmail request failed", {
			path,
			status: response.status,
		});
		throw new HTTPException(502, {
			message: `Gmail request failed (${response.status})`,
		});
	}
	return await response.json();
}

// --- Gmail message parsing ----------------------------------------------

interface GmailHeader {
	name: string;
	value: string;
}

interface GmailPart {
	mimeType?: string;
	body?: { data?: string; attachmentId?: string; size?: number };
	parts?: GmailPart[];
	headers?: GmailHeader[];
	filename?: string;
}

interface GmailMessage {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	payload?: GmailPart;
}

interface GmailThread {
	id: string;
	messages?: GmailMessage[];
}

function header(message: GmailMessage, name: string): string {
	const lower = name.toLowerCase();
	return (
		message.payload?.headers?.find((h) => h.name.toLowerCase() === lower)
			?.value ?? ""
	);
}

export interface MailAddress {
	name: string | null;
	email: string;
}

export function parseAddresses(value: string): MailAddress[] {
	const out: MailAddress[] = [];
	for (const raw of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
		const part = raw.trim();
		if (!part) {
			continue;
		}
		const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(part);
		if (match) {
			out.push({
				name: match[1]?.trim() || null,
				email: match[2]!.trim().toLowerCase(),
			});
		} else if (part.includes("@")) {
			out.push({ name: null, email: part.toLowerCase() });
		}
	}
	return out;
}

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

// One pass, so an entity produced by decoding is never decoded again.
function decodeEntities(text: string): string {
	return text.replace(
		/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
		(match, entity: string) => {
			if (entity[0] === "#") {
				const code =
					entity[1]?.toLowerCase() === "x"
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10);
				return Number.isFinite(code) && code > 0 && code <= 0x10ffff
					? String.fromCodePoint(code)
					: match;
			}
			return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
		},
	);
}

// Repeats until nothing changes, so nested or split tags cannot survive.
function stripTags(html: string): string {
	let previous: string;
	let current = html;
	do {
		previous = current;
		current = current
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
			.replace(/<[^>]*>/g, "");
	} while (current !== previous);
	return current;
}

export function htmlToText(html: string): string {
	return decodeEntities(
		stripTags(
			html
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n"),
		),
	)
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function partText(part: GmailPart | undefined, depth = 0): string | null {
	if (!part || depth > 10) {
		return null;
	}
	const data = part.body?.data;
	if (part.mimeType === "text/plain" && data) {
		return Buffer.from(data, "base64url")
			.toString("utf8")
			.replace(/\r\n/g, "\n");
	}
	if (part.mimeType === "text/html" && data) {
		return htmlToText(Buffer.from(data, "base64url").toString("utf8"));
	}
	if (!part.parts?.length) {
		return null;
	}
	if (part.mimeType === "multipart/alternative") {
		const plain = part.parts.find((p) => p.mimeType === "text/plain");
		return partText(plain ?? part.parts.at(-1), depth + 1);
	}
	const texts = part.parts
		.map((p) => partText(p, depth + 1))
		.filter((t): t is string => !!t);
	return texts.length ? texts.join("\n\n") : null;
}

function attachments(part: GmailPart | undefined, depth = 0): string[] {
	if (!part || depth > 10) {
		return [];
	}
	const own = part.filename && part.body?.attachmentId ? [part.filename] : [];
	return own.concat(
		...(part.parts ?? []).map((p) => attachments(p, depth + 1)),
	);
}

export interface CrmMailMessage {
	id: string;
	messageId: string;
	from: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	date: string;
	snippet: string;
	text: string;
	unread: boolean;
	attachments: string[];
}

function serializeMessage(message: GmailMessage): CrmMailMessage {
	return {
		id: message.id,
		messageId: header(message, "Message-ID"),
		from: parseAddresses(header(message, "From"))[0] ?? null,
		to: parseAddresses(header(message, "To")),
		cc: parseAddresses(header(message, "Cc")),
		subject: header(message, "Subject"),
		date: new Date(Number(message.internalDate ?? 0)).toISOString(),
		snippet: decodeEntities(message.snippet ?? ""),
		text: partText(message.payload) ?? "",
		unread: message.labelIds?.includes("UNREAD") ?? false,
		attachments: attachments(message.payload),
	};
}

export interface CrmMailThreadSummary {
	integrationId: string;
	mailbox: string;
	threadId: string;
	subject: string;
	snippet: string;
	lastAt: string;
	lastFrom: MailAddress | null;
	participants: MailAddress[];
	messageCount: number;
	unread: boolean;
}

const METADATA_HEADERS = ["Subject", "From", "To", "Cc", "Date", "Message-ID"];

/**
 * Gmail search for everything exchanged with an account: every known address
 * plus, for companies with a corporate domain, anyone else at that domain, so
 * a colleague who was never added as a contact still shows up.
 */
export function gmailQueryFor(
	emails: string[],
	domain?: string | null,
): string {
	const addresses = emails.slice(0, 25);
	const scopes = domain ? [...addresses, `@${domain}`] : addresses;
	const terms = scopes.flatMap((e) => [`from:${e}`, `to:${e}`, `cc:${e}`]);
	return `{${terms.join(" ")}} -in:spam -in:trash`;
}

export async function listGmailThreads(
	row: CrmIntegrationRow,
	emails: string[],
	domain?: string | null,
	max = 20,
): Promise<CrmMailThreadSummary[]> {
	if (!emails.length && !domain) {
		return [];
	}
	const mailboxDomain = row.accountEmail.split("@")[1];
	const searchDomain = domain && domain !== mailboxDomain ? domain : null;
	const token = await gmailAccessToken(row);
	const list = z
		.object({
			threads: z.array(z.object({ id: z.string() })).optional(),
		})
		.parse(
			await gmailRequest(token, "/threads", {
				query: new URLSearchParams({
					q: gmailQueryFor(emails, searchDomain),
					maxResults: String(max),
				}),
			}),
		);
	const threads = await Promise.all(
		(list.threads ?? []).map(async (t) => {
			const query = new URLSearchParams({ format: "metadata" });
			for (const name of METADATA_HEADERS) {
				query.append("metadataHeaders", name);
			}
			return (await gmailRequest(token, `/threads/${t.id}`, {
				query,
			})) as GmailThread;
		}),
	);
	return threads.flatMap((thread) => {
		const messages = (thread.messages ?? []).map(serializeMessage);
		const last = messages.at(-1);
		if (!last) {
			return [];
		}
		const participants = new Map<string, MailAddress>();
		for (const m of messages) {
			for (const a of [m.from, ...m.to, ...m.cc]) {
				if (a && a.email !== row.accountEmail) {
					participants.set(a.email, participants.get(a.email) ?? a);
				}
			}
		}
		return [
			{
				integrationId: row.id,
				mailbox: row.accountEmail,
				threadId: thread.id,
				subject: messages.find((m) => m.subject)?.subject ?? "(no subject)",
				snippet: last.snippet,
				lastAt: last.date,
				lastFrom: last.from,
				participants: [...participants.values()],
				messageCount: messages.length,
				unread: messages.some((m) => m.unread),
			},
		];
	});
}

export async function getGmailThread(
	row: CrmIntegrationRow,
	threadId: string,
): Promise<CrmMailMessage[]> {
	const token = await gmailAccessToken(row);
	const thread = (await gmailRequest(
		token,
		`/threads/${encodeURIComponent(threadId)}`,
		{ query: new URLSearchParams({ format: "full" }) },
	)) as GmailThread;
	return (thread.messages ?? []).map(serializeMessage);
}

function encodeHeaderValue(value: string): string {
	return /^[\x20-\x7e]*$/.test(value)
		? value
		: `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

const singleLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function formatAddress(a: MailAddress): string {
	return a.name
		? `${encodeHeaderValue(`"${a.name.replace(/"/g, "")}"`)} <${a.email}>`
		: a.email;
}

export interface OutgoingMail {
	from: MailAddress;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	text: string;
	threadId?: string;
	inReplyTo?: string;
	references?: string;
}

export function buildRawMessage(mail: OutgoingMail): string {
	const lines = [
		`From: ${formatAddress(mail.from)}`,
		`To: ${mail.to.map(formatAddress).join(", ")}`,
		...(mail.cc.length ? [`Cc: ${mail.cc.map(formatAddress).join(", ")}`] : []),
		`Subject: ${encodeHeaderValue(mail.subject)}`,
		...(mail.inReplyTo ? [`In-Reply-To: ${singleLine(mail.inReplyTo)}`] : []),
		...(mail.references ? [`References: ${singleLine(mail.references)}`] : []),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		Buffer.from(mail.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"),
	];
	return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function sendGmail(
	row: CrmIntegrationRow,
	mail: OutgoingMail,
): Promise<{ id: string; threadId: string }> {
	const token = await gmailAccessToken(row);
	const sent = await gmailRequest(token, "/messages/send", {
		method: "POST",
		body: JSON.stringify({
			raw: buildRawMessage(mail),
			...(mail.threadId ? { threadId: mail.threadId } : {}),
		}),
	});
	return z.object({ id: z.string(), threadId: z.string() }).parse(sent);
}

// --- Google Calendar --------------------------------------------------------

const calendarEventSchema = z.object({
	id: z.string(),
	status: z.string().optional(),
	summary: z.string().optional(),
	description: z.string().optional(),
	location: z.string().optional(),
	htmlLink: z.string().optional(),
	hangoutLink: z.string().optional(),
	start: z.object({
		dateTime: z.string().optional(),
		date: z.string().optional(),
	}),
	end: z.object({
		dateTime: z.string().optional(),
		date: z.string().optional(),
	}),
	organizer: z
		.object({
			email: z.string().optional(),
			displayName: z.string().optional(),
		})
		.optional(),
	attendees: z
		.array(
			z.object({
				email: z.string().optional(),
				displayName: z.string().optional(),
				responseStatus: z.string().optional(),
				organizer: z.boolean().optional(),
				self: z.boolean().optional(),
				resource: z.boolean().optional(),
			}),
		)
		.optional(),
	conferenceData: z
		.object({
			entryPoints: z
				.array(
					z.object({
						entryPointType: z.string().optional(),
						uri: z.string().optional(),
					}),
				)
				.optional(),
		})
		.optional(),
});

export interface CrmCalendarAttendee {
	email: string;
	name: string | null;
	responseStatus: string;
	organizer: boolean;
	self: boolean;
}

export interface CrmCalendarEvent {
	integrationId: string;
	calendar: string;
	eventId: string;
	summary: string;
	description: string | null;
	startAt: string;
	endAt: string;
	allDay: boolean;
	joinUrl: string | null;
	location: string | null;
	htmlLink: string | null;
	organizerEmail: string | null;
	attendees: CrmCalendarAttendee[];
}

function serializeCalendarEvent(
	row: CrmIntegrationRow,
	event: z.infer<typeof calendarEventSchema>,
): CrmCalendarEvent {
	const allDay = !event.start.dateTime;
	const toIso = (value: string | undefined) =>
		value ? new Date(value).toISOString() : new Date(0).toISOString();
	const video = event.conferenceData?.entryPoints?.find(
		(e) => e.entryPointType === "video" && e.uri,
	)?.uri;
	return {
		integrationId: row.id,
		calendar: row.accountEmail,
		eventId: event.id,
		summary: event.summary?.trim() || "(no title)",
		description: event.description ? htmlToText(event.description) : null,
		startAt: toIso(event.start.dateTime ?? event.start.date),
		endAt: toIso(event.end.dateTime ?? event.end.date),
		allDay,
		joinUrl: event.hangoutLink ?? video ?? null,
		location: event.location ?? null,
		htmlLink: event.htmlLink ?? null,
		organizerEmail: event.organizer?.email?.toLowerCase() ?? null,
		attendees: (event.attendees ?? [])
			.filter((a) => a.email && !a.resource)
			.map((a) => ({
				email: a.email!.toLowerCase(),
				name: a.displayName?.trim() || null,
				responseStatus: a.responseStatus ?? "needsAction",
				organizer: a.organizer ?? false,
				self: a.self ?? false,
			})),
	};
}

async function calendarRequest(
	token: string,
	path: string,
	query?: URLSearchParams,
): Promise<unknown> {
	const url = new URL(`${CALENDAR_API}${path}`);
	if (query) {
		url.search = query.toString();
	}
	const response = await externalFetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
	});
	if (response.status === 401 || response.status === 403) {
		throw new HTTPException(409, {
			message:
				"Calendar access is missing. Reconnect the mailbox to grant calendar access.",
		});
	}
	if (response.status === 404) {
		throw new HTTPException(404, { message: "Calendar event not found" });
	}
	if (!response.ok) {
		logger.warn("CRM Calendar request failed", {
			path,
			status: response.status,
		});
		throw new HTTPException(502, {
			message: `Calendar request failed (${response.status})`,
		});
	}
	return await response.json();
}

export async function listCalendarEvents(
	row: CrmIntegrationRow,
	range: { from: Date; to: Date },
	max = 100,
): Promise<CrmCalendarEvent[]> {
	const token = await gmailAccessToken(row);
	const parsed = z
		.object({ items: z.array(calendarEventSchema).optional() })
		.parse(
			await calendarRequest(
				token,
				"/calendars/primary/events",
				new URLSearchParams({
					timeMin: range.from.toISOString(),
					timeMax: range.to.toISOString(),
					singleEvents: "true",
					orderBy: "startTime",
					maxResults: String(max),
				}),
			),
		);
	return (parsed.items ?? [])
		.filter((e) => e.status !== "cancelled")
		.map((e) => serializeCalendarEvent(row, e));
}

export async function getCalendarEvent(
	row: CrmIntegrationRow,
	eventId: string,
): Promise<CrmCalendarEvent> {
	const token = await gmailAccessToken(row);
	const event = calendarEventSchema.parse(
		await calendarRequest(
			token,
			`/calendars/primary/events/${encodeURIComponent(eventId)}`,
		),
	);
	return serializeCalendarEvent(row, event);
}

// --- AI research ------------------------------------------------------------

export function researchConfigured(): boolean {
	return Boolean(researchApiKey());
}

function researchApiKey(): string | undefined {
	return (
		process.env.CRM_RESEARCH_GATEWAY_API_KEY?.trim() ||
		process.env.SUPPORT_CHAT_API_KEY?.trim()
	);
}

export function researchModel(): string {
	return process.env.CRM_RESEARCH_MODEL?.trim() || "openai/gpt-5.2";
}

export interface ResearchResult {
	text: string;
	model: string;
	sources: string[];
}

/**
 * Runs a web-search-grounded brief through the gateway. The prompt asks for
 * plain text so the admin UI can show it verbatim; citations come back as
 * URL annotations and are listed separately.
 */
export async function runWebResearch(input: {
	system: string;
	prompt: string;
}): Promise<ResearchResult> {
	const apiKey = researchApiKey();
	if (!apiKey) {
		throw new HTTPException(503, {
			message:
				"AI research is not configured: set CRM_RESEARCH_GATEWAY_API_KEY on the API.",
		});
	}
	const model = researchModel();
	const response = await fetch(`${getGatewayApiBaseUrl()}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"x-source": "admin-crm-research",
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: input.system },
				{ role: "user", content: input.prompt },
			],
			tools: [{ type: "web_search" }],
			max_tokens: 1800,
		}),
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		logger.warn("CRM research request failed", {
			status: response.status,
			detail: detail.slice(0, 300),
		});
		throw new HTTPException(502, {
			message: `Research model request failed (${response.status})`,
		});
	}
	const parsed = z
		.object({
			model: z.string().optional(),
			choices: z.array(
				z.object({
					message: z.object({
						content: z.string().nullable(),
						annotations: z
							.array(
								z.object({
									type: z.string().optional(),
									url_citation: z
										.object({ url: z.string(), title: z.string().optional() })
										.optional(),
								}),
							)
							.optional(),
					}),
				}),
			),
		})
		.safeParse(await response.json());
	if (!parsed.success || !parsed.data.choices[0]?.message.content) {
		throw new HTTPException(502, {
			message: "Research model returned no answer",
		});
	}
	const message = parsed.data.choices[0].message;
	const content = message.content!;
	const inlineUrls = [
		...content.matchAll(/\]\(((?:https?:)?\/\/[^)\s]+)\)/g),
	].map((m) => m[1]!);
	const sources = [
		...new Set([
			...(message.annotations ?? [])
				.map((a) => a.url_citation?.url)
				.filter((u): u is string => !!u),
			...inlineUrls,
		]),
	];
	return {
		text: stripInlineCitations(content),
		model: parsed.data.model ?? model,
		sources,
	};
}

/**
 * Models still wrap citations as markdown links; the admin UI shows plain
 * text and lists sources separately, so drop the parenthesised link and keep
 * any link label.
 */
export function stripInlineCitations(text: string): string {
	return text
		.replace(/\s*\(\s*\[([^\]]*)\]\((?:https?:)?\/\/[^)]+\)\s*\)/g, " ($1)")
		.replace(/\[([^\]]+)\]\((?:https?:)?\/\/[^)]+\)/g, "$1")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

// --- Calendly -------------------------------------------------------------

async function calendlyRequest(
	token: string,
	path: string,
	init?: RequestInit & { query?: URLSearchParams },
): Promise<unknown> {
	const url = new URL(`${CALENDLY_API}${path}`);
	if (init?.query) {
		url.search = init.query.toString();
	}
	const response = await externalFetch(url, {
		method: init?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
		},
		body: init?.body,
	});
	if (response.status === 401) {
		throw new HTTPException(409, {
			message: "Calendly rejected the token. Reconnect Calendly.",
		});
	}
	if (response.status === 204) {
		return null;
	}
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		logger.warn("CRM Calendly request failed", {
			path,
			status: response.status,
			detail: detail.slice(0, 300),
		});
		throw new HTTPException(502, {
			message: `Calendly request failed (${response.status})`,
		});
	}
	return await response.json();
}

const calendlyUserSchema = z.object({
	resource: z.object({
		uri: z.string(),
		name: z.string(),
		email: z.string(),
		scheduling_url: z.string(),
		current_organization: z.string(),
	}),
});

export async function calendlyMe(token: string) {
	const parsed = calendlyUserSchema.safeParse(
		await calendlyRequest(token, "/users/me"),
	);
	if (!parsed.success) {
		throw new HTTPException(502, {
			message: "Calendly returned an unexpected user profile",
		});
	}
	return parsed.data.resource;
}

const eventTypeSchema = z.object({
	uri: z.string(),
	name: z.string(),
	slug: z.string().nullable().optional(),
	scheduling_url: z.string(),
	duration: z.number(),
	active: z.boolean(),
	kind: z.string().optional(),
});

export interface CrmBookingLink {
	integrationId: string;
	owner: string;
	name: string;
	duration: number;
	url: string;
}

export async function listCalendlyEventTypes(
	row: CrmIntegrationRow,
): Promise<CrmBookingLink[]> {
	if (!row.externalId) {
		return [];
	}
	const credentials = openCalendlyCredentials(row);
	const parsed = z.object({ collection: z.array(eventTypeSchema) }).parse(
		await calendlyRequest(credentials.token, "/event_types", {
			query: new URLSearchParams({
				user: row.externalId,
				active: "true",
				count: "50",
			}),
		}),
	);
	return parsed.collection.map((t) => ({
		integrationId: row.id,
		owner: row.displayName ?? row.accountEmail,
		name: t.name,
		duration: t.duration,
		url: t.scheduling_url,
	}));
}

const scheduledEventSchema = z.object({
	uri: z.string(),
	name: z.string().nullable(),
	status: z.enum(["active", "canceled"]),
	start_time: z.string(),
	end_time: z.string(),
	location: z
		.object({
			type: z.string().optional(),
			location: z.string().nullable().optional(),
			join_url: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
	event_memberships: z
		.array(z.object({ user_email: z.string().optional() }))
		.optional(),
});
export type CalendlyScheduledEvent = z.infer<typeof scheduledEventSchema>;

export interface CrmMeeting {
	integrationId: string;
	host: string;
	eventUri: string;
	name: string;
	status: "active" | "canceled";
	startAt: string;
	endAt: string;
	location: string | null;
	joinUrl: string | null;
	inviteeEmail: string;
}

export function meetingFromEvent(
	row: Pick<CrmIntegrationRow, "id" | "displayName" | "accountEmail">,
	event: CalendlyScheduledEvent,
	inviteeEmail: string,
): CrmMeeting {
	return {
		integrationId: row.id,
		host: row.displayName ?? row.accountEmail,
		eventUri: event.uri,
		name: event.name ?? "Meeting",
		status: event.status,
		startAt: event.start_time,
		endAt: event.end_time,
		location: event.location?.location ?? event.location?.type ?? null,
		joinUrl: event.location?.join_url ?? null,
		inviteeEmail: inviteeEmail.toLowerCase(),
	};
}

export async function listCalendlyMeetings(
	row: CrmIntegrationRow,
	emails: string[],
): Promise<CrmMeeting[]> {
	if (!row.externalId || !emails.length) {
		return [];
	}
	const credentials = openCalendlyCredentials(row);
	const results = await Promise.all(
		emails.slice(0, 15).map(async (email) => {
			const parsed = z
				.object({ collection: z.array(scheduledEventSchema) })
				.parse(
					await calendlyRequest(credentials.token, "/scheduled_events", {
						query: new URLSearchParams({
							user: row.externalId!,
							invitee_email: email,
							sort: "start_time:desc",
							count: "20",
						}),
					}),
				);
			return parsed.collection.map((e) => meetingFromEvent(row, e, email));
		}),
	);
	const seen = new Set<string>();
	return results.flat().filter((m) => {
		if (seen.has(m.eventUri)) {
			return false;
		}
		seen.add(m.eventUri);
		return true;
	});
}

export async function createCalendlyWebhook(input: {
	token: string;
	userUri: string;
	organizationUri: string;
	signingKey: string;
}): Promise<string | undefined> {
	try {
		const created = await calendlyRequest(
			input.token,
			"/webhook_subscriptions",
			{
				method: "POST",
				body: JSON.stringify({
					url: calendlyWebhookUrl(),
					events: ["invitee.created", "invitee.canceled"],
					organization: input.organizationUri,
					user: input.userUri,
					scope: "user",
					signing_key: input.signingKey,
				}),
			},
		);
		return z.object({ resource: z.object({ uri: z.string() }) }).parse(created)
			.resource.uri;
	} catch (error) {
		// Webhooks need a paid Calendly plan; the CRM falls back to syncing
		// meetings whenever the account is opened.
		logger.info("Calendly webhook subscription not created", {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

export async function deleteCalendlyWebhook(
	token: string,
	webhookUri: string,
): Promise<void> {
	const uuid = webhookUri.split("/").pop();
	if (!uuid) {
		return;
	}
	try {
		await calendlyRequest(
			token,
			`/webhook_subscriptions/${encodeURIComponent(uuid)}`,
			{ method: "DELETE" },
		);
	} catch (error) {
		logger.info("Calendly webhook subscription not deleted", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function verifyCalendlySignature(
	rawBody: string,
	signatureHeader: string | undefined,
	signingKey: string,
	now = Date.now(),
): boolean {
	if (!signatureHeader) {
		return false;
	}
	const parts = new Map(
		signatureHeader.split(",").map((kv) => {
			const [k, ...rest] = kv.trim().split("=");
			return [k, rest.join("=")] as const;
		}),
	);
	const t = parts.get("t");
	const v1 = parts.get("v1");
	if (!t || !v1 || !/^\d+$/.test(t) || !/^[a-f0-9]{64}$/.test(v1)) {
		return false;
	}
	const signedAt = Number(t) * 1000;
	if (Math.abs(now - signedAt) > 5 * 60_000) {
		return false;
	}
	const expected = createHmac("sha256", signingKey)
		.update(`${t}.${rawBody}`)
		.digest();
	return timingSafeEqual(expected, Buffer.from(v1, "hex"));
}

export function signCalendlyPayload(
	rawBody: string,
	signingKey: string,
	now = Date.now(),
): string {
	const t = Math.floor(now / 1000);
	const v1 = createHmac("sha256", signingKey)
		.update(`${t}.${rawBody}`)
		.digest("hex");
	return `t=${t},v1=${v1}`;
}

export const calendlyWebhookSchema = z.object({
	event: z.enum(["invitee.created", "invitee.canceled"]),
	created_by: z.string().optional(),
	payload: z.object({
		email: z.string(),
		name: z.string().nullable().optional(),
		scheduled_event: scheduledEventSchema,
	}),
});

export function meetingActivity(
	meeting: CrmMeeting,
	inviteeName?: string | null,
) {
	const when = new Date(meeting.startAt);
	const minutes = Math.round(
		(new Date(meeting.endAt).getTime() - when.getTime()) / 60_000,
	);
	const who = inviteeName
		? `${inviteeName} <${meeting.inviteeEmail}>`
		: meeting.inviteeEmail;
	const lines = [
		`${meeting.status === "canceled" ? "Canceled" : "Scheduled"} via Calendly with ${who}`,
		`${when.toISOString().replace("T", " ").slice(0, 16)} UTC · ${minutes} min · hosted by ${meeting.host}`,
	];
	if (meeting.joinUrl) {
		lines.push(meeting.joinUrl);
	} else if (meeting.location) {
		lines.push(meeting.location);
	}
	return {
		subject: `${meeting.status === "canceled" ? "Canceled: " : ""}${meeting.name}`,
		body: lines.join("\n"),
		externalRef: `calendly:${meeting.eventUri}`,
	};
}

const sqlExternalRefNotNull = sql`external_ref IS NOT NULL`;

/**
 * Mirrors a Calendly event into the account's activity feed, keyed on the
 * event URI so re-syncs and webhooks update the same row (a cancellation
 * rewrites the subject instead of adding a second entry).
 */
export async function upsertMeetingActivity(
	accountId: string,
	meeting: CrmMeeting,
	inviteeName?: string | null,
): Promise<void> {
	const fields = meetingActivity(meeting, inviteeName);
	await db
		.insert(tables.crmActivity)
		.values({
			accountId,
			kind: "meeting",
			subject: fields.subject,
			body: fields.body,
			contactEmail: meeting.inviteeEmail,
			authorEmail: null,
			createdAt: new Date(meeting.startAt),
			externalRef: fields.externalRef,
		})
		.onConflictDoUpdate({
			target: tables.crmActivity.externalRef,
			targetWhere: sqlExternalRefNotNull,
			set: {
				subject: fields.subject,
				body: fields.body,
				createdAt: new Date(meeting.startAt),
			},
		});
}
