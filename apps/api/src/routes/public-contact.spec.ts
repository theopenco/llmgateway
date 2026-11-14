import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { signEnterpriseContactToken } from "@/lib/enterprise-contact.js";
import * as discord from "@/utils/discord.js";
import * as emailUtils from "@/utils/email.js";
import * as rateLimit from "@/utils/public-rate-limit.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as sharedEmail from "@llmgateway/shared/email";
import type { MockInstance } from "vitest";

// Sales hears about an inquiry, and the visitor can book a call, only after
// the visitor confirms their email. The sales email must declare UTF-8 early
// and escape what the visitor typed.

const send = vi.hoisted(() => vi.fn());
let sendTransactionalEmail: MockInstance<
	typeof emailUtils.sendTransactionalEmail
>;

vi.mock("@llmgateway/shared/email", async (importOriginal) => ({
	...(await importOriginal<typeof sharedEmail>()),
	getResendClient: () => ({ emails: { send } }),
}));

const inquiry = {
	name: "김민준 <i>Renée</i>",
	email: "inquiry@acme.example",
	country: "KR<i>",
	size: "51-200<i>",
	message: "게이트웨이 도입을 검토 중입니다 <b>urgent</b>",
};

beforeEach(() => {
	send.mockReset().mockResolvedValue({ data: { id: "email-id" }, error: null });
	vi.spyOn(rateLimit, "consumeRateLimit").mockResolvedValue(true);
	vi.spyOn(discord, "notifyEnterpriseContact").mockResolvedValue();
	sendTransactionalEmail = vi
		.spyOn(emailUtils, "sendTransactionalEmail")
		.mockResolvedValue();
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db
		.delete(tables.enterpriseContactSubmission)
		.where(eq(tables.enterpriseContactSubmission.email, inquiry.email));
});

async function submit() {
	return await app.request("/public/contact/enterprise", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(inquiry),
	});
}

async function confirm(token: string) {
	return await app.request("/public/contact/enterprise/confirm", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token }),
	});
}

async function loadSubmission() {
	const [row] = await db
		.select()
		.from(tables.enterpriseContactSubmission)
		.where(eq(tables.enterpriseContactSubmission.email, inquiry.email));
	return row;
}

test("a submission only mails the visitor a confirmation link", async () => {
	const response = await submit();

	expect(response.status).toBe(200);
	expect(send).not.toHaveBeenCalled();
	expect(discord.notifyEnterpriseContact).not.toHaveBeenCalled();
	expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
	const mail = sendTransactionalEmail.mock.calls[0][0];
	expect(mail.to).toBe(inquiry.email);
	const row = await loadSubmission();
	expect(row?.spamFilterStatus).toBe("unconfirmed");
	expect(mail.html).toContain("/enterprise/confirm?token=v1.");
	expect(mail.html).toContain("김민준 &lt;i&gt;Renée&lt;/i&gt;");
});

test("confirming delivers to sales once, escaped, and returns the booking prefill", async () => {
	await submit();
	const row = await loadSubmission();
	const token = signEnterpriseContactToken(row!.id);

	const first = await confirm(token);
	expect(first.status).toBe(200);
	expect(await first.json()).toMatchObject({
		success: true,
		name: inquiry.name,
		email: inquiry.email,
	});
	// A second click still lets the visitor book but does not notify again.
	expect((await confirm(token)).status).toBe(200);

	expect(send).toHaveBeenCalledTimes(1);
	expect(discord.notifyEnterpriseContact).toHaveBeenCalledTimes(1);
	expect((await loadSubmission())?.spamFilterStatus).toBe("delivered");
	const html: string = send.mock.calls[0][0].html;
	expect(Buffer.from(html).subarray(0, 1024).toString("latin1")).toMatch(
		/<head>\s*<meta charset="utf-8">/i,
	);
	expect(html).toContain("김민준 &lt;i&gt;Renée&lt;/i&gt;");
	expect(html).toContain("KR&lt;i&gt;");
	expect(html).toContain("51-200&lt;i&gt;");
	expect(html).toContain("&lt;b&gt;urgent&lt;/b&gt;");
	expect(html).not.toMatch(/<[bi]>/);
});

test("a failed sales delivery is retried on the next click", async () => {
	await submit();
	const row = await loadSubmission();
	const token = signEnterpriseContactToken(row!.id);
	send.mockResolvedValueOnce({ data: null, error: { message: "down" } });

	expect((await confirm(token)).status).toBe(200);
	expect((await loadSubmission())?.spamFilterStatus).toBe("delivery_failed");

	expect((await confirm(token)).status).toBe(200);
	expect(send).toHaveBeenCalledTimes(2);
	expect((await loadSubmission())?.spamFilterStatus).toBe("delivered");
});

test("a failed confirmation email leaves the request unconfirmed", async () => {
	sendTransactionalEmail.mockRejectedValueOnce(new Error("down"));

	expect((await submit()).status).toBe(500);
	expect(await loadSubmission()).toMatchObject({
		spamFilterStatus: "unconfirmed",
		rejectionReason: "confirmation_send_failed",
	});
});

test("a forged, expired or rejected link cannot book a call", async () => {
	await submit();
	const row = await loadSubmission();

	const forged = await confirm(`${signEnterpriseContactToken(row!.id)}x`);
	expect(forged.status).toBe(400);
	expect(await forged.json()).toMatchObject({ invalidLink: true });

	const eightDaysAgo = new Date();
	eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
	const expired = signEnterpriseContactToken(row!.id, eightDaysAgo);
	expect((await confirm(expired)).status).toBe(400);

	await db
		.update(tables.enterpriseContactSubmission)
		.set({ spamFilterStatus: "rejected" })
		.where(eq(tables.enterpriseContactSubmission.id, row!.id));
	expect((await confirm(signEnterpriseContactToken(row!.id))).status).toBe(400);

	expect(send).not.toHaveBeenCalled();
});
