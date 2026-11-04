import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { sealCredentials } from "@/lib/crm-integrations.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.events.readonly";
const HUNDRED_DAYS = 100 * 86_400_000;

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

async function call(
	cookie: string,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<Response> {
	return await app.request(path, {
		method: init.method ?? "GET",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
}

async function seed(withCalendar: boolean) {
	await db.insert(tables.organization).values({
		id: "crm-calls-org",
		name: "Acme Corp",
		billingEmail: "ops@acme-corp.com",
		plan: "enterprise",
		planStartedAt: new Date(Date.now() - 86_400_000),
		planExpiresAt: new Date(Date.now() + HUNDRED_DAYS),
	});
	await db.insert(tables.crmAccount).values({
		id: "acme-corp.com",
		industry: "Logistics",
		useCase: "Routing support tickets",
	});
	await db.insert(tables.crmContact).values({
		accountId: "acme-corp.com",
		email: "jane@acme-corp.com",
		name: "Jane Doe",
		title: "VP Engineering",
		role: "decision_maker",
	});
	const admin = (await db.query.user.findFirst({
		where: { email: "admin@example.com" },
	}))!;
	await db.insert(tables.crmIntegration).values({
		id: "gmail-cal",
		provider: "gmail",
		userId: admin.id,
		accountEmail: "rep@llmgateway.io",
		credentials: sealCredentials("gmail-cal", {
			accessToken: "access-fixture",
			refreshToken: "refresh-fixture",
			expiresAt: Date.now() + 3_600_000,
			scope: withCalendar
				? `https://www.googleapis.com/auth/gmail.readonly ${CALENDAR_SCOPE}`
				: "https://www.googleapis.com/auth/gmail.readonly",
		}),
		shared: true,
	});
}

const tomorrow = new Date(Date.now() + 86_400_000);
const event = {
	id: "evt1",
	status: "confirmed",
	summary: "Intro call",
	description: "Agenda:<br>pricing",
	htmlLink: "https://calendar.google.com/event?eid=evt1",
	hangoutLink: "https://meet.google.com/abc",
	start: { dateTime: tomorrow.toISOString() },
	end: { dateTime: new Date(tomorrow.getTime() + 1_800_000).toISOString() },
	organizer: { email: "rep@llmgateway.io" },
	attendees: [
		{ email: "rep@llmgateway.io", self: true, responseStatus: "accepted" },
		{
			email: "Jane@Acme-Corp.com",
			displayName: "Jane Doe",
			responseStatus: "tentative",
		},
		{ email: "room@resource.calendar.google.com", resource: true },
	],
};

describe("CRM calls and research", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		vi.stubEnv("CRM_RESEARCH_GATEWAY_API_KEY", "");
		vi.stubEnv("SUPPORT_CHAT_API_KEY", "");
		cookie = await createTestUser();
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

	it("reports mailboxes connected without calendar access and lists none", async () => {
		await seed(false);
		const res = await call(cookie, "/admin/crm/calls");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.calendars).toEqual([
			{
				integrationId: "gmail-cal",
				email: "rep@llmgateway.io",
				calendar: false,
			},
		]);
		expect(body.calls).toEqual([]);
	});

	it("lists external calls matched to accounts and opens the briefing", async () => {
		await seed(true);
		const params: string[] = [];
		stubFetch((u) => {
			if (u.pathname === "/calendar/v3/calendars/primary/events") {
				params.push(u.search);
				return Response.json({
					items: [
						event,
						{ ...event, id: "internal", attendees: [event.attendees[0]] },
						{ ...event, id: "gone", status: "cancelled" },
					],
				});
			}
			if (u.pathname === "/calendar/v3/calendars/primary/events/evt1") {
				return Response.json(event);
			}
			return undefined;
		});
		const res = await call(cookie, "/admin/crm/calls?days=7");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(params[0]).toContain("singleEvents=true");
		expect(body.calls).toHaveLength(1);
		expect(body.calls[0]).toMatchObject({
			eventId: "evt1",
			summary: "Intro call",
			description: "Agenda:\npricing",
			joinUrl: "https://meet.google.com/abc",
			account: { id: "acme-corp.com", name: "Acme Corp", segment: "customer" },
			suggestedDomain: null,
		});
		expect(body.calls[0].attendees).toEqual([
			expect.objectContaining({
				email: "rep@llmgateway.io",
				internal: true,
				accountId: null,
			}),
			expect.objectContaining({
				email: "jane@acme-corp.com",
				name: "Jane Doe",
				internal: false,
				accountId: "acme-corp.com",
				responseStatus: "tentative",
			}),
		]);

		const brief = await call(cookie, "/admin/crm/calls/gmail-cal/evt1");
		expect(brief.status).toBe(200);
		expect((await brief.json()).call).toMatchObject({
			eventId: "evt1",
			account: { id: "acme-corp.com" },
		});
	});

	it("suggests a domain when the attendee's company is not in the CRM", async () => {
		await seed(true);
		stubFetch((u) => {
			if (u.pathname === "/calendar/v3/calendars/primary/events") {
				return Response.json({
					items: [
						{
							...event,
							id: "evt2",
							attendees: [
								event.attendees[0],
								{ email: "bob@newco.io", responseStatus: "accepted" },
								{ email: "someone@gmail.com", responseStatus: "accepted" },
							],
						},
					],
				});
			}
			return undefined;
		});
		const body = await (await call(cookie, "/admin/crm/calls")).json();
		expect(body.calls[0]).toMatchObject({
			account: null,
			suggestedDomain: "newco.io",
		});
	});

	it("runs web research through the gateway and saves it as a note", async () => {
		await seed(true);
		expect((await call(cookie, "/admin/crm/research/status")).status).toBe(200);
		expect(
			(
				await call(cookie, "/admin/crm/research", {
					method: "POST",
					body: { accountId: "acme-corp.com", kind: "company" },
				})
			).status,
		).toBe(503);

		vi.stubEnv("CRM_RESEARCH_GATEWAY_API_KEY", "gw-fixture");
		vi.stubEnv("CRM_RESEARCH_MODEL", "openai/gpt-5-mini");
		let request:
			| { model: string; tools: unknown; messages: { content: string }[] }
			| undefined;
		let authorization: string | undefined;
		stubFetch((u, init) => {
			if (u.pathname.endsWith("/v1/chat/completions")) {
				request = JSON.parse(String(init?.body));
				authorization =
					new Headers(init?.headers).get("authorization") ?? undefined;
				return Response.json({
					model: "openai/gpt-5-mini",
					choices: [
						{
							message: {
								content:
									"Overview\n- Acme ships routing software. ([acme](https://acme-corp.com/about))\n- See [the blog](https://acme-corp.com/blog) for more.",
								annotations: [
									{
										type: "url_citation",
										url_citation: { url: "https://acme-corp.com/about" },
									},
									{
										type: "url_citation",
										url_citation: { url: "https://acme-corp.com/about" },
									},
								],
							},
						},
					],
				});
			}
			return undefined;
		});
		const status = await (
			await call(cookie, "/admin/crm/research/status")
		).json();
		expect(status).toEqual({ available: true, model: "openai/gpt-5-mini" });

		const res = await call(cookie, "/admin/crm/research", {
			method: "POST",
			body: {
				accountId: "acme-corp.com",
				kind: "person",
				email: "jane@acme-corp.com",
				question: "Did they raise recently?",
			},
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(authorization).toBe("Bearer gw-fixture");
		expect(request?.model).toBe("openai/gpt-5-mini");
		expect(request?.tools).toEqual([{ type: "web_search" }]);
		expect(request?.messages[1]?.content).toContain("Name: Jane Doe");
		expect(request?.messages[1]?.content).toContain(
			"Title (CRM): VP Engineering",
		);
		expect(request?.messages[1]?.content).toContain(
			"Industry (CRM): Logistics",
		);
		expect(request?.messages[1]?.content).toContain("Did they raise recently?");
		expect(body).toMatchObject({
			subject: "AI research: Jane Doe",
			sources: ["https://acme-corp.com/about", "https://acme-corp.com/blog"],
			model: "openai/gpt-5-mini",
		});
		expect(body.text).toContain("Sources:\n- https://acme-corp.com/about");
		expect(body.text).toContain(
			"- Acme ships routing software. (acme)\n- See the blog for more.",
		);

		const [note] = await db
			.select()
			.from(tables.crmActivity)
			.where(eq(tables.crmActivity.accountId, "acme-corp.com"));
		expect(note).toMatchObject({
			kind: "note",
			subject: "AI research: Jane Doe",
			contactEmail: "jane@acme-corp.com",
			authorEmail: "admin@example.com",
		});
		const list = await (
			await call(cookie, "/admin/crm/accounts/acme-corp.com/research")
		).json();
		expect(list.notes).toHaveLength(1);
		expect(list.notes[0].id).toBe(body.activityId);
	});
});
