import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { signUnsubscribeToken } from "@llmgateway/shared/email-unsubscribe";

const EMAIL = "recipient@example.com";

function token(category: "marketing" | "credit_alerts" = "marketing") {
	return signUnsubscribeToken({ email: EMAIL, category });
}

async function rows() {
	return await db.query.emailUnsubscribe.findMany({});
}

describe("public unsubscribe", () => {
	beforeEach(async () => {
		await deleteAll();
		await redisClient.del("unsubscribe_rate_limit:email:" + EMAIL);
	});

	test("one-click POST records the suppression", async () => {
		const res = await app.request(
			`/public/unsubscribe?token=${encodeURIComponent(token())}`,
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: "List-Unsubscribe=One-Click",
			},
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			email: EMAIL,
			category: "marketing",
			unsubscribed: true,
		});
		expect(await rows()).toHaveLength(1);
	});

	test("one-click POST is idempotent", async () => {
		const url = `/public/unsubscribe?token=${encodeURIComponent(token())}`;
		await app.request(url, { method: "POST" });
		const res = await app.request(url, { method: "POST" });

		expect(res.status).toBe(200);
		expect(await rows()).toHaveLength(1);
	});

	test("suppression is per category", async () => {
		await app.request(
			`/public/unsubscribe?token=${encodeURIComponent(token("marketing"))}`,
			{ method: "POST" },
		);

		const res = await app.request(
			`/public/unsubscribe/status?token=${encodeURIComponent(token("credit_alerts"))}`,
		);
		expect(await res.json()).toMatchObject({
			category: "credit_alerts",
			unsubscribed: false,
		});
	});

	test("GET redirects a human to the dashboard page", async () => {
		const value = token();
		const res = await app.request(
			`/public/unsubscribe?token=${encodeURIComponent(value)}`,
		);

		expect(res.status).toBe(302);
		const location = res.headers.get("location") ?? "";
		expect(location).toContain("/unsubscribe?token=");
		expect(decodeURIComponent(location)).toContain(value);
	});

	test("resubscribe clears the suppression", async () => {
		const value = encodeURIComponent(token());
		await app.request(`/public/unsubscribe?token=${value}`, { method: "POST" });

		const res = await app.request(
			`/public/unsubscribe/resubscribe?token=${value}`,
			{ method: "POST" },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ unsubscribed: false });
		expect(await rows()).toHaveLength(0);
	});

	test("rejects an invalid token without writing a row", async () => {
		for (const method of ["GET", "POST"]) {
			const res = await app.request("/public/unsubscribe?token=nonsense", {
				method,
			});
			expect(res.status).toBe(400);
		}
		expect(await rows()).toHaveLength(0);
	});

	test("rejects a token signed for a different address", async () => {
		const value = token();
		const [version, , signature] = value.split(".");
		const forged = Buffer.from(
			JSON.stringify({ e: "someone-else@example.com", c: "marketing" }),
		).toString("base64url");

		const res = await app.request(
			`/public/unsubscribe?token=${version}.${forged}.${signature}`,
			{ method: "POST" },
		);

		expect(res.status).toBe(400);
		expect(await rows()).toHaveLength(0);
	});

	test("rate limits repeated requests from the same address", async () => {
		const value = encodeURIComponent(token());
		let lastStatus = 200;
		for (let i = 0; i < 32; i++) {
			const res = await app.request(`/public/unsubscribe?token=${value}`, {
				method: "POST",
			});
			lastStatus = res.status;
		}

		expect(lastStatus).toBe(429);
	});

	test("suppression survives when the row already exists for another category", async () => {
		await db.insert(tables.emailUnsubscribe).values({
			email: EMAIL,
			category: "credit_alerts",
			source: "dashboard",
		});

		await app.request(
			`/public/unsubscribe?token=${encodeURIComponent(token("marketing"))}`,
			{ method: "POST" },
		);

		expect(await rows()).toHaveLength(2);
	});

	// A marketing unsubscribe has to end the newsletter too; the suppression
	// row alone would leave the address on the list Resend mails every week.
	describe("the newsletter topic", () => {
		const topicPath = `/contacts/${encodeURIComponent(EMAIL)}/topics`;

		beforeEach(() => {
			vi.stubEnv("RESEND_API_KEY", "test-resend-key");
			vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "topic-newsletter");
		});

		afterEach(() => {
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
		});

		async function unsubscribe(category: "marketing" | "credit_alerts") {
			return await app.request(
				`/public/unsubscribe?token=${encodeURIComponent(token(category))}`,
				{ method: "POST" },
			);
		}

		test("is opted out by a marketing unsubscribe", async () => {
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response("{}", { status: 200 }));

			const res = await unsubscribe("marketing");

			expect(res.status).toBe(200);
			expect(upstream).toHaveBeenCalledTimes(1);
			const [url, init] = upstream.mock.calls[0];
			expect(String(url)).toBe(`https://api.resend.com${topicPath}`);
			expect(init?.method).toBe("PATCH");
			expect(JSON.parse(String(init?.body))).toEqual([
				{ id: "topic-newsletter", subscription: "opt_out" },
			]);
		});

		test("is left alone by any other category", async () => {
			const upstream = vi.spyOn(globalThis, "fetch");

			const res = await unsubscribe("credit_alerts");

			expect(res.status).toBe(200);
			expect(upstream).not.toHaveBeenCalled();
		});

		const busy = (status: number) =>
			new Response("{}", { status, headers: { "retry-after": "0" } });

		test("is retried while Resend is rate limiting or failing", async () => {
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValueOnce(busy(429))
				.mockResolvedValueOnce(busy(503))
				.mockResolvedValue(new Response("{}", { status: 200 }));

			const res = await unsubscribe("marketing");

			expect(res.status).toBe(200);
			expect(upstream).toHaveBeenCalledTimes(3);
		});

		test.each([
			["Resend is down", 1, () => Promise.reject(new Error("connect timeout"))],
			["Resend keeps failing", 3, () => Promise.resolve(busy(500))],
			[
				"Resend rejects the request",
				1,
				() => Promise.resolve(new Response("{}", { status: 422 })),
			],
			[
				"the address is not a contact",
				1,
				() => Promise.resolve(new Response("{}", { status: 404 })),
			],
		])(
			"never blocks the unsubscribe when %s",
			async (_case, attempts, respond) => {
				const upstream = vi
					.spyOn(globalThis, "fetch")
					.mockImplementation(respond);

				const res = await unsubscribe("marketing");

				expect(res.status).toBe(200);
				expect(await rows()).toHaveLength(1);
				expect(upstream).toHaveBeenCalledTimes(attempts);
			},
		);
	});
});
