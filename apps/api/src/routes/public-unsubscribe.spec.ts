import { beforeEach, describe, expect, test } from "vitest";

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
});
