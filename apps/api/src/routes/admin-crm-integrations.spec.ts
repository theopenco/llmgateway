import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import {
	buildRawMessage,
	gmailQueryFor,
	htmlToText,
	parseAddresses,
	sealCredentials,
	signCalendlyPayload,
	verifyCalendlySignature,
} from "@/lib/crm-integrations.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const HUNDRED_DAYS = 100 * 86_400_000;
const TEN_MINUTES = 10 * 60_000;

type Route = (url: URL, init: RequestInit | undefined) => Response | undefined;

function stubFetch(route: Route) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url,
			);
			const response = route(url, init);
			if (!response) {
				throw new Error(`Unexpected fetch ${url.toString()}`);
			}
			return response;
		});
}

function base64url(value: string) {
	return Buffer.from(value, "utf8").toString("base64url");
}

function gmailMessage(input: {
	id: string;
	threadId: string;
	from: string;
	to: string;
	subject: string;
	date: number;
	text: string;
	unread?: boolean;
}) {
	return {
		id: input.id,
		threadId: input.threadId,
		labelIds: input.unread ? ["INBOX", "UNREAD"] : ["INBOX"],
		snippet: input.text.slice(0, 40),
		internalDate: String(input.date),
		payload: {
			mimeType: "multipart/alternative",
			headers: [
				{ name: "From", value: input.from },
				{ name: "To", value: input.to },
				{ name: "Subject", value: input.subject },
				{ name: "Message-ID", value: `<${input.id}@mail.example>` },
			],
			parts: [
				{
					mimeType: "text/plain",
					body: { data: base64url(input.text) },
				},
				{
					mimeType: "text/html",
					body: { data: base64url(`<p>${input.text}</p>`) },
				},
			],
		},
	};
}

async function call(
	cookie: string,
	path: string,
	init: {
		method?: string;
		body?: unknown;
		headers?: Record<string, string>;
	} = {},
): Promise<Response> {
	return await app.request(path, {
		method: init.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			Cookie: cookie,
			...init.headers,
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
}

async function seedAccount() {
	await db.insert(tables.organization).values({
		id: "crm-int-org",
		name: "Acme Corp",
		billingEmail: "ops@acme-corp.com",
		plan: "enterprise",
		planStartedAt: new Date(Date.now() - 86_400_000),
		planExpiresAt: new Date(Date.now() + HUNDRED_DAYS),
	});
	await db.insert(tables.crmAccount).values({ id: "acme-corp.com" });
	await db.insert(tables.crmContact).values({
		accountId: "acme-corp.com",
		email: "jane@acme-corp.com",
		name: "Jane Doe",
	});
}

async function adminUser() {
	return await db.query.user.findFirst({
		where: { email: "admin@example.com" },
	});
}

async function seedGmail(
	userId: string,
	shared = false,
	email = "contact@llmgateway.io",
) {
	const [row] = await db
		.insert(tables.crmIntegration)
		.values({
			id: `gmail-${email}`,
			provider: "gmail",
			userId,
			accountEmail: email,
			credentials: sealCredentials(`gmail-${email}`, {
				accessToken: "access-fixture",
				refreshToken: "refresh-fixture",
				expiresAt: Date.now() + 3_600_000,
			}),
			shared,
		})
		.returning();
	return row!;
}

async function seedCalendly(userId: string, signingKey?: string) {
	const [row] = await db
		.insert(tables.crmIntegration)
		.values({
			id: "calendly-luca",
			provider: "calendly",
			userId,
			accountEmail: "luca@llmgateway.io",
			displayName: "Luca",
			externalId: "https://api.calendly.com/users/LUCA",
			credentials: sealCredentials("calendly-luca", {
				token: "pat-fixture",
				organizationUri: "https://api.calendly.com/organizations/ORG",
				schedulingUrl: "https://calendly.com/luca",
				webhookUri: signingKey
					? "https://api.calendly.com/webhook_subscriptions/WH"
					: undefined,
				signingKey,
			}),
			shared: true,
		})
		.returning();
	return row!;
}

describe("CRM integrations", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		for (const name of [
			"CRM_GOOGLE_CLIENT_ID",
			"CRM_GOOGLE_CLIENT_SECRET",
			"LOUNGE_GOOGLE_CLIENT_ID",
			"LOUNGE_GOOGLE_CLIENT_SECRET",
		]) {
			vi.stubEnv(name, "");
		}
		cookie = await createTestUser();
		await seedAccount();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await deleteAll();
	});

	describe("helpers", () => {
		it("parses address lists and strips html", () => {
			expect(
				parseAddresses('"Doe, Jane" <Jane@Acme-Corp.com>, bob@acme-corp.com'),
			).toEqual([
				{ name: "Doe, Jane", email: "jane@acme-corp.com" },
				{ name: null, email: "bob@acme-corp.com" },
			]);
			expect(
				htmlToText("<div>Hi&nbsp;there<br>bye</div><p>&amp; more</p>"),
			).toBe("Hi there\nbye\n& more");
			expect(gmailQueryFor(["a@x.io"])).toBe(
				"{from:a@x.io to:a@x.io cc:a@x.io} -in:spam -in:trash",
			);
			expect(gmailQueryFor(["a@x.io"], "x.io")).toBe(
				"{from:a@x.io to:a@x.io cc:a@x.io from:@x.io to:@x.io cc:@x.io} -in:spam -in:trash",
			);
		});

		it("builds a threaded RFC 2822 message", () => {
			const raw = Buffer.from(
				buildRawMessage({
					from: { email: "contact@llmgateway.io", name: null },
					to: [{ email: "jane@acme-corp.com", name: "Jane Doe" }],
					cc: [],
					subject: "Re: Pricing ✓",
					text: "Hello\nJane",
					threadId: "t1",
					inReplyTo: "<m1@mail.example>",
					references: "<m1@mail.example>",
				}),
				"base64url",
			).toString("utf8");
			expect(raw).toContain('To: "Jane Doe" <jane@acme-corp.com>');
			expect(raw).toContain("Subject: =?UTF-8?B?");
			expect(raw).toContain("In-Reply-To: <m1@mail.example>");
			expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
		});

		it("verifies Calendly signatures with a replay window", () => {
			const body = JSON.stringify({ event: "invitee.created" });
			const header = signCalendlyPayload(body, "key");
			expect(verifyCalendlySignature(body, header, "key")).toBe(true);
			expect(verifyCalendlySignature(body, header, "other")).toBe(false);
			expect(verifyCalendlySignature(`${body} `, header, "key")).toBe(false);
			expect(
				verifyCalendlySignature(
					body,
					signCalendlyPayload(body, "key", Date.now() - TEN_MINUTES),
					"key",
				),
			).toBe(false);
		});
	});

	it("lists connections without credentials and reports Gmail availability", async () => {
		const admin = (await adminUser())!;
		await seedGmail(admin.id);
		await seedCalendly(admin.id, "sign");
		const res = await call(cookie, "/admin/crm/integrations");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.gmailAvailable).toBe(false);
		expect(body.integrations).toHaveLength(2);
		expect(JSON.stringify(body)).not.toContain("fixture");
		const calendly = body.integrations.find(
			(i: { provider: string }) => i.provider === "calendly",
		);
		expect(calendly).toMatchObject({
			mine: true,
			shared: true,
			webhook: true,
			schedulingUrl: "https://calendly.com/luca",
			ownerEmail: "admin@example.com",
		});
	});

	it("starts the Gmail consent flow bound to the session and rejects a foreign state", async () => {
		expect(
			(
				await call(cookie, "/admin/crm/integrations/gmail/connect", {
					method: "POST",
					body: {},
				})
			).status,
		).toBe(503);
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		const res = await call(cookie, "/admin/crm/integrations/gmail/connect", {
			method: "POST",
			body: { shared: true },
		});
		expect(res.status).toBe(200);
		const url = new URL((await res.json()).url);
		expect(url.origin).toBe("https://accounts.google.com");
		expect(url.searchParams.get("client_id")).toBe("fixture-client");
		expect(url.searchParams.get("scope")).toContain("gmail.send");
		expect(url.searchParams.get("redirect_uri")).toContain(
			"/admin/crm/integrations/gmail/callback",
		);

		const bad = await call(
			cookie,
			"/admin/crm/integrations/gmail/callback?code=abc&state=forged.sig",
		);
		expect(bad.status).toBe(302);
		const target = new URL(bad.headers.get("location")!);
		expect(target.pathname).toBe("/crm/settings");
		expect(target.searchParams.get("status")).toBe("error");

		const fetchSpy = stubFetch((u) => {
			if (u.host === "oauth2.googleapis.com") {
				return Response.json({
					access_token: "fixture-access",
					refresh_token: "fixture-refresh",
					expires_in: 3600,
					scope:
						"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
				});
			}
			if (u.pathname.endsWith("/users/me/profile")) {
				return Response.json({ emailAddress: "Contact@LLMGateway.io" });
			}
			return undefined;
		});
		const good = await call(
			cookie,
			`/admin/crm/integrations/gmail/callback?code=abc&state=${url.searchParams.get("state")}`,
		);
		expect(good.status).toBe(302);
		const done = new URL(good.headers.get("location")!);
		expect(done.searchParams.get("status")).toBe("connected");
		expect(done.searchParams.get("account")).toBe("contact@llmgateway.io");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const row = await db.query.crmIntegration.findFirst({
			where: { provider: "gmail" },
		});
		expect(row).toMatchObject({
			accountEmail: "contact@llmgateway.io",
			shared: true,
		});
		expect(row!.credentials).not.toContain("fixture-refresh");
	});

	it("connects Calendly from a personal token and subscribes a webhook", async () => {
		let webhookBody: unknown;
		stubFetch((u, init) => {
			if (u.pathname === "/users/me") {
				return Response.json({
					resource: {
						uri: "https://api.calendly.com/users/LUCA",
						name: "Luca",
						email: "luca@llmgateway.io",
						scheduling_url: "https://calendly.com/luca",
						current_organization: "https://api.calendly.com/organizations/ORG",
					},
				});
			}
			if (u.pathname === "/webhook_subscriptions") {
				webhookBody = JSON.parse(String(init?.body));
				return Response.json(
					{
						resource: {
							uri: "https://api.calendly.com/webhook_subscriptions/WH",
						},
					},
					{ status: 201 },
				);
			}
			return undefined;
		});
		const res = await call(cookie, "/admin/crm/integrations/calendly", {
			method: "POST",
			body: { token: "eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNj", shared: true },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			provider: "calendly",
			accountEmail: "luca@llmgateway.io",
			displayName: "Luca",
			webhook: true,
			shared: true,
		});
		expect(webhookBody).toMatchObject({
			events: ["invitee.created", "invitee.canceled"],
			scope: "user",
			user: "https://api.calendly.com/users/LUCA",
		});
		expect(String((webhookBody as { url: string }).url)).toContain(
			"/public/crm-webhooks/calendly",
		);
	});

	it("lists threads with the account's people across mailboxes and opens one", async () => {
		const admin = (await adminUser())!;
		await seedGmail(admin.id);
		const queries: string[] = [];
		stubFetch((u) => {
			if (u.pathname.endsWith("/users/me/threads")) {
				queries.push(u.searchParams.get("q")!);
				return Response.json({ threads: [{ id: "t1" }] });
			}
			if (u.pathname.endsWith("/users/me/threads/t1")) {
				return Response.json({
					id: "t1",
					messages: [
						gmailMessage({
							id: "m1",
							threadId: "t1",
							from: "Jane Doe <jane@acme-corp.com>",
							to: "contact@llmgateway.io",
							subject: "Pricing",
							date: 1_700_000_000_000,
							text: "Can we talk pricing?",
						}),
						gmailMessage({
							id: "m2",
							threadId: "t1",
							from: "contact@llmgateway.io",
							to: "Jane Doe <jane@acme-corp.com>",
							subject: "Re: Pricing",
							date: 1_700_000_100_000,
							text: "Sure, tomorrow?",
							unread: true,
						}),
					],
				});
			}
			return undefined;
		});
		const res = await call(cookie, "/admin/crm/accounts/acme-corp.com/mail");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(queries[0]).toContain("from:jane@acme-corp.com");
		expect(queries[0]).toContain("to:ops@acme-corp.com");
		expect(queries[0]).toContain("from:@acme-corp.com");
		expect(body.mailboxes).toEqual([
			{
				id: "gmail-contact@llmgateway.io",
				email: "contact@llmgateway.io",
				canSend: true,
			},
		]);
		expect(body.threads).toHaveLength(1);
		expect(body.threads[0]).toMatchObject({
			threadId: "t1",
			subject: "Pricing",
			messageCount: 2,
			unread: true,
			participants: [{ email: "jane@acme-corp.com", name: "Jane Doe" }],
		});

		const thread = await call(
			cookie,
			"/admin/crm/integrations/gmail-contact@llmgateway.io/threads/t1",
		);
		expect(thread.status).toBe(200);
		const detail = await thread.json();
		expect(detail.messages).toHaveLength(2);
		expect(detail.messages[0]).toMatchObject({
			text: "Can we talk pricing?",
			messageId: "<m1@mail.example>",
			from: { email: "jane@acme-corp.com", name: "Jane Doe" },
		});
	});

	it("sends mail from a usable mailbox, logs the activity, and refuses private mailboxes", async () => {
		const admin = (await adminUser())!;
		const [other] = await db
			.insert(tables.user)
			.values({
				id: "crm-int-other",
				email: "luca@llmgateway.io",
				name: "Luca",
				emailVerified: true,
			})
			.returning();
		await seedGmail(admin.id, false);
		await seedGmail(other!.id, false, "luca@llmgateway.io");
		let sendBody: { raw: string; threadId?: string } | undefined;
		stubFetch((u, init) => {
			if (u.pathname.endsWith("/users/me/messages/send")) {
				sendBody = JSON.parse(String(init?.body));
				return Response.json({ id: "sent-1", threadId: "t1" });
			}
			return undefined;
		});
		const forbidden = await call(
			cookie,
			"/admin/crm/accounts/acme-corp.com/mail",
			{
				method: "POST",
				body: {
					integrationId: "gmail-luca@llmgateway.io",
					to: ["jane@acme-corp.com"],
					subject: "Hi",
					text: "Hello",
				},
			},
		);
		expect(forbidden.status).toBe(403);

		const res = await call(cookie, "/admin/crm/accounts/acme-corp.com/mail", {
			method: "POST",
			body: {
				integrationId: "gmail-contact@llmgateway.io",
				to: ["jane@acme-corp.com"],
				subject: "Re: Pricing",
				text: "Tomorrow at 10 works.",
				threadId: "t1",
				inReplyTo: "<m1@mail.example>",
				references: "<m1@mail.example>",
			},
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ threadId: "t1", messageId: "sent-1" });
		expect(sendBody?.threadId).toBe("t1");
		const raw = Buffer.from(sendBody!.raw, "base64url").toString("utf8");
		expect(raw).toContain('To: "Jane Doe" <jane@acme-corp.com>');
		expect(raw).toContain("In-Reply-To: <m1@mail.example>");
		const activity = await db.query.crmActivity.findFirst({
			where: { accountId: "acme-corp.com" },
		});
		expect(activity).toMatchObject({
			kind: "email",
			subject: "Re: Pricing",
			contactEmail: "jane@acme-corp.com",
			authorEmail: "admin@example.com",
			externalRef: "gmail:sent-1",
		});
	});

	it("lists Calendly meetings and booking links, mirroring meetings into the feed once", async () => {
		const admin = (await adminUser())!;
		await seedCalendly(admin.id);
		const start = new Date(Date.now() + 86_400_000).toISOString();
		const end = new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
		stubFetch((u) => {
			if (u.pathname === "/scheduled_events") {
				return Response.json({
					collection:
						u.searchParams.get("invitee_email") === "jane@acme-corp.com"
							? [
									{
										uri: "https://api.calendly.com/scheduled_events/EV1",
										name: "Intro call",
										status: "active",
										start_time: start,
										end_time: end,
										location: {
											type: "google_conference",
											join_url: "https://meet.google.com/abc",
										},
									},
								]
							: [],
				});
			}
			if (u.pathname === "/event_types") {
				return Response.json({
					collection: [
						{
							uri: "https://api.calendly.com/event_types/ET1",
							name: "30 min call",
							slug: "30min",
							scheduling_url: "https://calendly.com/luca/30min",
							duration: 30,
							active: true,
						},
					],
				});
			}
			return undefined;
		});
		const res = await call(
			cookie,
			"/admin/crm/accounts/acme-corp.com/meetings",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.meetings).toEqual([
			expect.objectContaining({
				name: "Intro call",
				host: "Luca",
				joinUrl: "https://meet.google.com/abc",
				inviteeEmail: "jane@acme-corp.com",
			}),
		]);
		expect(body.bookingLinks).toEqual([
			expect.objectContaining({ name: "30 min call", duration: 30 }),
		]);
		await call(cookie, "/admin/crm/accounts/acme-corp.com/meetings");
		const activities = await db
			.select()
			.from(tables.crmActivity)
			.where(eq(tables.crmActivity.accountId, "acme-corp.com"));
		expect(activities).toHaveLength(1);
		expect(activities[0]).toMatchObject({
			kind: "meeting",
			subject: "Intro call",
			contactEmail: "jane@acme-corp.com",
			externalRef: "calendly:https://api.calendly.com/scheduled_events/EV1",
		});
		expect(activities[0]!.body).toContain("Jane Doe <jane@acme-corp.com>");
		expect(activities[0]!.createdAt.toISOString()).toBe(start);
	});

	it("records webhook bookings for known accounts and rejects bad signatures", async () => {
		const admin = (await adminUser())!;
		await seedCalendly(admin.id, "signing-key-fixture");
		const event = {
			uri: "https://api.calendly.com/scheduled_events/EV2",
			name: "Demo",
			status: "active",
			start_time: "2026-12-01T10:00:00.000000Z",
			end_time: "2026-12-01T10:45:00.000000Z",
			location: { type: "zoom", join_url: "https://zoom.us/j/1" },
		};
		const payload = JSON.stringify({
			event: "invitee.created",
			created_by: "https://api.calendly.com/users/LUCA",
			payload: {
				email: "Bob@Acme-Corp.com",
				name: "Bob",
				scheduled_event: event,
			},
		});
		const send = (body: string, signature: string) =>
			app.request("/public/crm-webhooks/calendly", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Calendly-Webhook-Signature": signature,
				},
				body,
			});
		expect(
			(await send(payload, signCalendlyPayload(payload, "wrong"))).status,
		).toBe(401);
		expect(
			(await send(payload, signCalendlyPayload(payload, "signing-key-fixture")))
				.status,
		).toBe(200);
		const [activity] = await db
			.select()
			.from(tables.crmActivity)
			.where(eq(tables.crmActivity.accountId, "acme-corp.com"));
		expect(activity).toMatchObject({
			kind: "meeting",
			subject: "Demo",
			contactEmail: "bob@acme-corp.com",
		});

		const canceled = JSON.stringify({
			event: "invitee.canceled",
			payload: {
				email: "bob@acme-corp.com",
				name: "Bob",
				scheduled_event: { ...event, status: "canceled" },
			},
		});
		expect(
			(
				await send(
					canceled,
					signCalendlyPayload(canceled, "signing-key-fixture"),
				)
			).status,
		).toBe(200);
		const after = await db
			.select()
			.from(tables.crmActivity)
			.where(eq(tables.crmActivity.accountId, "acme-corp.com"));
		expect(after).toHaveLength(1);
		expect(after[0]!.subject).toBe("Canceled: Demo");

		const unknown = JSON.stringify({
			event: "invitee.created",
			payload: { email: "someone@gmail.com", scheduled_event: event },
		});
		expect(
			(await send(unknown, signCalendlyPayload(unknown, "signing-key-fixture")))
				.status,
		).toBe(200);
		expect((await db.select().from(tables.crmActivity)).length).toBe(1);
	});

	it("lets only the connecting admin share or disconnect a connection", async () => {
		const [other] = await db
			.insert(tables.user)
			.values({
				id: "crm-int-other",
				email: "luca@llmgateway.io",
				name: "Luca",
				emailVerified: true,
			})
			.returning();
		await seedGmail(other!.id, false, "luca@llmgateway.io");
		expect(
			(
				await call(cookie, "/admin/crm/integrations/gmail-luca@llmgateway.io", {
					method: "PATCH",
					body: { shared: true },
				})
			).status,
		).toBe(403);
		expect(
			(
				await call(cookie, "/admin/crm/integrations/gmail-luca@llmgateway.io", {
					method: "DELETE",
				})
			).status,
		).toBe(403);
		const admin = (await adminUser())!;
		await seedGmail(admin.id);
		expect(
			(
				await call(
					cookie,
					"/admin/crm/integrations/gmail-contact@llmgateway.io",
					{
						method: "PATCH",
						body: { shared: true },
					},
				)
			).status,
		).toBe(200);
		expect(
			(
				await call(
					cookie,
					"/admin/crm/integrations/gmail-contact@llmgateway.io",
					{
						method: "DELETE",
					},
				)
			).status,
		).toBe(200);
		expect(
			await db.query.crmIntegration.findFirst({
				where: { id: "gmail-contact@llmgateway.io" },
			}),
		).toBeUndefined();
	});
});
