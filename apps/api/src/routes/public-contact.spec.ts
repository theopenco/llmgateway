import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { addBusinessDays } from "@/lib/crm-lead-follow-up.js";
import * as crm from "@/lib/crm.js";
import { deleteAll } from "@/testing.js";
import * as discord from "@/utils/discord.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as SharedEmail from "@llmgateway/shared/email";

// Ways a new enterprise lead can end up forgotten: it lands in the CRM with no
// follow-up or no owner, the follow-up falls on a weekend, a second inquiry
// from a company stacks tasks or a finished task blocks the next one, an owner
// someone chose is overwritten, spam gets a task, or the lead loses its
// follow-up because the notification email failed. And the reverse: a CRM
// failure must not cost the visitor their submission.

// The route emails and posts to Discord with whatever a developer's .env
// holds. Both are replaced here, and any other network call fails the test.
const send = vi.hoisted(() => vi.fn());
vi.mock("@llmgateway/shared/email", async (importOriginal) => ({
	...(await importOriginal<typeof SharedEmail>()),
	getResendClient: () => ({ emails: { send } }),
}));

const OWNER = "owner@example.com";
const HOUR_MS = 3_600_000;

function company(): string {
	return `acme-${randomUUID().slice(0, 8)}.example`;
}

async function inquire(
	email: string,
	overrides: Record<string, unknown> = {},
): Promise<Response> {
	return await app.request("/public/contact/enterprise", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: "Jane Doe",
			email,
			country: "DE",
			size: "51-200",
			message: "We would like to talk about a contract.",
			timestamp: Date.now() - 10_000,
			...overrides,
		}),
	});
}

async function tasks(accountId: string) {
	return await db
		.select()
		.from(tables.crmActivity)
		.where(eq(tables.crmActivity.accountId, accountId));
}

async function account(accountId: string) {
	return await db.query.crmAccount.findFirst({ where: { id: accountId } });
}

beforeEach(async () => {
	await deleteAll();
	send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
	vi.spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("The network is off in this spec"),
	);
	vi.spyOn(discord, "notifyEnterpriseContact").mockResolvedValue();
	vi.stubEnv("CRM_DEFAULT_OWNER_EMAIL", OWNER);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("a new enterprise inquiry", () => {
	test("gets the default owner and a follow-up due the next working day", async () => {
		const domain = company();
		const before = Date.now();

		const response = await inquire(`Jane@${domain}`);

		expect(response.status).toBe(200);
		expect(await account(domain)).toMatchObject({ ownerEmail: OWNER });
		const [task, ...rest] = await tasks(domain);
		expect(rest).toEqual([]);
		const submission = await db.query.enterpriseContactSubmission.findFirst({
			where: { email: `Jane@${domain}` },
		});
		expect(task).toMatchObject({
			kind: "task",
			subject: "Reply to Jane Doe's enterprise inquiry",
			contactEmail: `jane@${domain}`,
			completedAt: null,
			externalRef: `lead:${submission?.id}`,
		});
		const due = task.dueAt?.getTime() ?? 0;
		expect(due).toBeGreaterThanOrEqual(
			addBusinessDays(new Date(before), 1).getTime(),
		);
		expect(due).toBeLessThanOrEqual(
			addBusinessDays(new Date(), 1).getTime() + HOUR_MS,
		);
	});

	test("still gets its follow-up when no default owner is configured", async () => {
		vi.stubEnv("CRM_DEFAULT_OWNER_EMAIL", "");
		const domain = company();

		expect((await inquire(`jane@${domain}`)).status).toBe(200);

		expect(await account(domain)).toMatchObject({ ownerEmail: null });
		expect(await tasks(domain)).toHaveLength(1);
	});

	test("from a personal address is followed up under that address", async () => {
		const address = `${randomUUID().slice(0, 8)}@gmail.com`;

		expect((await inquire(address)).status).toBe(200);

		expect(await tasks(`lead:${address}`)).toHaveLength(1);
	});

	test("keeps an owner someone already chose", async () => {
		const domain = company();
		await db
			.insert(tables.crmAccount)
			.values({ id: domain, ownerEmail: "ae@example.com" });

		expect((await inquire(`jane@${domain}`)).status).toBe(200);

		expect(await account(domain)).toMatchObject({
			ownerEmail: "ae@example.com",
		});
	});

	test("does not stack tasks while one is open, and gets a new one after it is done", async () => {
		const domain = company();

		await inquire(`jane@${domain}`);
		await inquire(`john@${domain}`, { name: "John Roe" });
		expect(await tasks(domain)).toHaveLength(1);

		await db
			.update(tables.crmActivity)
			.set({ completedAt: new Date() })
			.where(eq(tables.crmActivity.accountId, domain));
		await inquire(`mary@${domain}`, { name: "Mary Major" });

		expect((await tasks(domain)).map((task) => task.subject).sort()).toEqual([
			"Reply to Jane Doe's enterprise inquiry",
			"Reply to Mary Major's enterprise inquiry",
		]);
	});

	test("keeps its follow-up when the notification email fails", async () => {
		send.mockResolvedValue({ data: null, error: { message: "down" } });
		const domain = company();

		const response = await inquire(`jane@${domain}`);

		expect(response.status).toBe(500);
		expect(await tasks(domain)).toHaveLength(1);
	});

	test("is accepted even when the follow-up cannot be scheduled", async () => {
		vi.spyOn(crm, "loadCrmBook").mockRejectedValue(new Error("database down"));
		const domain = company();

		const response = await inquire(`jane@${domain}`);

		expect(response.status).toBe(200);
		expect(send).toHaveBeenCalledTimes(1);
		expect(await tasks(domain)).toEqual([]);
	});

	test("that is spam gets no follow-up and no account", async () => {
		const domain = company();

		const response = await inquire(`jane@${domain}`, { honeypot: "filled" });

		expect(response.status).toBe(400);
		expect(await account(domain)).toBeUndefined();
		expect(send).not.toHaveBeenCalled();
	});
});

test("working days skip the weekend", () => {
	const at = (iso: string) => new Date(iso);

	// 2026-11-11 is a Wednesday.
	expect(addBusinessDays(at("2026-11-11T15:30:00Z"), 1)).toEqual(
		at("2026-11-12T15:30:00Z"),
	);
	expect(addBusinessDays(at("2026-11-13T15:30:00Z"), 1)).toEqual(
		at("2026-11-16T15:30:00Z"),
	);
	expect(addBusinessDays(at("2026-11-14T09:00:00Z"), 1)).toEqual(
		at("2026-11-16T09:00:00Z"),
	);
	expect(addBusinessDays(at("2026-11-15T23:59:00Z"), 1)).toEqual(
		at("2026-11-16T23:59:00Z"),
	);
	expect(addBusinessDays(at("2026-11-12T08:00:00Z"), 3)).toEqual(
		at("2026-11-17T08:00:00Z"),
	);
});
