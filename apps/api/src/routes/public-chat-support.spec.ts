import { beforeAll, describe, expect, it, vi } from "vitest";

import { redisClient } from "@/auth/config.js";
import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { randomInt, uniqueId } from "@llmgateway/shared/random";

const BURST_LIMIT_MAX = 5;
const RATE_LIMIT_MAX = 20;
const DAILY_LIMIT_MAX = 60;
const GLOBAL_HOURLY_LIMIT_MAX = 300;
const META_BURST_LIMIT_MAX = 30;

// Unique identifiers per call so runs never collide with earlier state in
// Redis (the rate-limit keys live for up to 24 hours).
function uniqueIp(): string {
	const octet = () => randomInt(0, 256);
	return `10.${octet()}.${octet()}.${octet()}`;
}

function uniqueClientId(): string {
	return uniqueId("spec");
}

// Seeds a single limiter bucket to its threshold so the next request trips
// exactly that limiter. Blocked requests are rejected before any DB or LLM
// work, so the tests exercise the limiter and nothing else.
async function seedLimit(
	bucket: string,
	identifier: string,
	max: number,
): Promise<string> {
	const key = `chat_support_rate_limit:${bucket}:${identifier}`;
	await redisClient.set(key, String(max), "EX", 60);
	return key;
}

let token: string;

const ORG_ID = "chat-support-spec-org";

beforeAll(async () => {
	token = await createTestUser();
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Paid Org",
		billingEmail: "admin@example.com",
		plan: "pro",
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
	});
});

async function setPlan(plan: "free" | "pro" | "enterprise"): Promise<void> {
	await db
		.update(tables.organization)
		.set({ plan })
		.where(eq(tables.organization.id, ORG_ID));
}

async function getEligibility(): Promise<Response> {
	return await app.request("/public/chat-support/eligibility", {
		headers: { "X-Forwarded-For": uniqueIp(), Cookie: token },
	});
}

describe("public chat support eligibility", () => {
	it("reports paid and enterprise users as eligible", async () => {
		for (const plan of ["pro", "enterprise"] as const) {
			await setPlan(plan);
			const res = await getEligibility();
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ eligible: true });
		}
	});

	it("blocks free users without a payment on every endpoint", async () => {
		await setPlan("free");
		try {
			const res = await getEligibility();
			expect(await res.json()).toEqual({ eligible: false });

			const ip = uniqueIp();
			const clientId = uniqueClientId();
			const blocked = await sendMessage(ip, clientId);
			expect(blocked.status).toBe(403);
			expect(
				await redisClient.get(`chat_support_rate_limit:burst:ip:${ip}`),
			).toBeNull();

			for (const path of [
				`/public/chat-support/conversation?clientId=${clientId}`,
				"/public/chat-support/reaction",
				"/public/chat-support/resolve",
				"/public/chat-support/escalate",
			]) {
				const res = await app.request(path, {
					method: path.includes("?") ? "GET" : "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Forwarded-For": ip,
						Cookie: token,
					},
					body: path.includes("?") ? undefined : JSON.stringify({ clientId }),
				});
				expect(res.status, path).toBe(403);
			}
		} finally {
			await setPlan("pro");
		}
	});

	it("treats a completed payment as paid", async () => {
		await setPlan("free");
		const [row] = await db
			.insert(tables.transaction)
			.values({
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "10",
				creditAmount: "10",
				status: "completed",
			})
			.returning({ id: tables.transaction.id });
		try {
			expect(await (await getEligibility()).json()).toEqual({
				eligible: true,
			});
		} finally {
			await db
				.delete(tables.transaction)
				.where(eq(tables.transaction.id, row!.id));
			await setPlan("pro");
		}
	});
});

async function sendMessage(
	ip: string,
	clientId: string,
	role: "user" | "developer" = "user",
): Promise<Response> {
	return await app.request("/public/chat-support", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Forwarded-For": ip,
			Cookie: token,
		},
		body: JSON.stringify({
			clientId,
			messages: [{ id: "1", role, parts: [{ type: "text", text: "hi" }] }],
		}),
	});
}

describe("public chat support authentication", () => {
	it("rejects anonymous visitors on every endpoint", async () => {
		const ip = uniqueIp();
		const clientId = uniqueClientId();
		const anonymous = await app.request("/public/chat-support", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forwarded-For": ip,
			},
			body: JSON.stringify({
				clientId,
				messages: [
					{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
				],
			}),
		});
		expect(anonymous.status).toBe(401);
		expect(await anonymous.json()).toEqual({
			error: "Please sign in to use chat support.",
		});
		// Rejected before validation and rate limiting, so no bucket is spent.
		expect(
			await redisClient.get(`chat_support_rate_limit:burst:ip:${ip}`),
		).toBeNull();

		for (const path of [
			`/public/chat-support/conversation?clientId=${clientId}`,
			"/public/chat-support/reaction",
			"/public/chat-support/resolve",
			"/public/chat-support/escalate",
		]) {
			const res = await app.request(path, {
				method: path.includes("?") ? "GET" : "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": ip,
				},
				body: path.includes("?") ? undefined : JSON.stringify({ clientId }),
			});
			expect(res.status, path).toBe(401);
		}
	});

	it("lets a signed-in user through", async () => {
		const res = await sendMessage(uniqueIp(), uniqueClientId());
		expect(res.status).not.toBe(401);
	});
});

describe("public chat support rate limiting", () => {
	it("blocks messages once the per-IP burst window is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("burst", `ip:${ip}`, BURST_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.error).toContain("too quickly");
	});

	it("accepts the developer message role", async () => {
		const ip = uniqueIp();
		await seedLimit("burst", `ip:${ip}`, BURST_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId(), "developer");
		expect(blocked.status).toBe(429);
	});

	it("blocks messages once the clientId burst window is exhausted", async () => {
		const clientId = uniqueClientId();
		await seedLimit("burst", `client:${clientId}`, BURST_LIMIT_MAX);
		const blocked = await sendMessage(uniqueIp(), clientId);
		expect(blocked.status).toBe(429);
	});

	it("blocks messages once the hourly per-IP quota is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("hour", `ip:${ip}`, RATE_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.error).toContain("20 per hour");
	});

	it("blocks messages once the daily per-IP quota is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("day", `ip:${ip}`, DAILY_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.error).toContain("Daily message limit");
	});

	it("blocks everyone once the global breaker trips", async () => {
		const key = await seedLimit("global_hour", "all", GLOBAL_HOURLY_LIMIT_MAX);
		try {
			const blocked = await sendMessage(uniqueIp(), uniqueClientId());
			expect(blocked.status).toBe(429);
			const json = await blocked.json();
			expect(json.error).toContain("high volume");
		} finally {
			await redisClient.del(key);
		}
	});

	it("does not throttle other visitors when one is blocked", async () => {
		const ip = uniqueIp();
		await seedLimit("burst", `ip:${ip}`, BURST_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const other = await sendMessage(uniqueIp(), uniqueClientId());
		expect(other.status).not.toBe(429);
	});

	it("does not consume rate-limit buckets for malformed requests", async () => {
		const ip = uniqueIp();
		const res = await app.request("/public/chat-support", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forwarded-For": ip,
				Cookie: token,
			},
			body: JSON.stringify({ clientId: uniqueClientId() }),
		});
		expect(res.status).toBe(400);
		const burst = await redisClient.get(
			`chat_support_rate_limit:burst:ip:${ip}`,
		);
		expect(burst).toBeNull();
	});

	it("returns a logged client error for an invalid message role", async () => {
		const ip = uniqueIp();
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		try {
			const res = await app.request("/public/chat-support", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": ip,
					Cookie: token,
				},
				body: JSON.stringify({
					clientId: uniqueClientId(),
					messages: [
						{
							id: "1",
							role: "invalid",
							parts: [{ type: "text", text: "hi" }],
						},
					],
				}),
			});

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: "Invalid message role" });
			expect(warn).toHaveBeenCalledWith(
				"Invalid chat support request",
				expect.objectContaining({
					path: "/public/chat-support",
					method: "POST",
				}),
			);
			expect(
				await redisClient.get(`chat_support_rate_limit:burst:ip:${ip}`),
			).toBeNull();
		} finally {
			warn.mockRestore();
		}
	});

	it("throttles the cheap endpoints on a shared per-IP bucket", async () => {
		const ip = uniqueIp();
		await seedLimit("meta_burst", `ip:${ip}`, META_BURST_LIMIT_MAX);
		const blockedGet = await app.request(
			`/public/chat-support/conversation?clientId=${uniqueClientId()}`,
			{ headers: { "X-Forwarded-For": ip, Cookie: token } },
		);
		expect(blockedGet.status).toBe(429);
		const blockedPost = await app.request("/public/chat-support/reaction", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forwarded-For": ip,
				Cookie: token,
			},
			body: JSON.stringify({}),
		});
		expect(blockedPost.status).toBe(429);
	});
});
