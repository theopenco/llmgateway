import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import * as discord from "@/utils/discord.js";
import * as rateLimit from "@/utils/public-rate-limit.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as sharedEmail from "@llmgateway/shared/email";

// Ways the inquiry notification can go wrong: it never says which encoding it
// uses, or says so too late for a reader to see, so a name or message outside
// ASCII arrives garbled; or what the visitor typed reaches the email as markup.

const send = vi.hoisted(() => vi.fn());

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
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db
		.delete(tables.enterpriseContactSubmission)
		.where(eq(tables.enterpriseContactSubmission.email, inquiry.email));
});

test("the notification declares UTF-8 at the top of its head and escapes what was typed", async () => {
	const response = await app.request("/public/contact/enterprise", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(inquiry),
	});

	expect(response.status).toBe(200);
	expect(send).toHaveBeenCalledTimes(1);
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
