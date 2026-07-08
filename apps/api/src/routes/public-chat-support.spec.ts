import { describe, expect, it } from "vitest";

import { redisClient } from "@/auth/config.js";
import { app } from "@/index.js";

const BURST_LIMIT_MAX = 5;
const RATE_LIMIT_MAX = 20;
const DAILY_LIMIT_MAX = 60;
const GLOBAL_HOURLY_LIMIT_MAX = 300;
const META_BURST_LIMIT_MAX = 30;

// Unique identifiers per call so runs never collide with earlier state in
// Redis (the rate-limit keys live for up to 24 hours).
function uniqueIp(): string {
	const octet = () => Math.floor(Math.random() * 256);
	return `10.${octet()}.${octet()}.${octet()}`;
}

function uniqueClientId(): string {
	return `spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

async function sendMessage(ip: string, clientId: string): Promise<Response> {
	return await app.request("/public/chat-support", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify({
			clientId,
			messages: [
				{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
			],
		}),
	});
}

describe("public chat support rate limiting", () => {
	it("blocks messages once the per-IP burst window is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("burst", `ip:${ip}`, BURST_LIMIT_MAX);
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.error).toContain("too quickly");
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
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({ clientId: uniqueClientId() }),
		});
		expect(res.status).toBe(400);
		const burst = await redisClient.get(
			`chat_support_rate_limit:burst:ip:${ip}`,
		);
		expect(burst).toBeNull();
	});

	it("throttles the cheap endpoints on a shared per-IP bucket", async () => {
		const ip = uniqueIp();
		await seedLimit("meta_burst", `ip:${ip}`, META_BURST_LIMIT_MAX);
		const blockedGet = await app.request(
			`/public/chat-support/conversation?clientId=${uniqueClientId()}`,
			{ headers: { "CF-Connecting-IP": ip } },
		);
		expect(blockedGet.status).toBe(429);
		const blockedPost = await app.request("/public/chat-support/reaction", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({}),
		});
		expect(blockedPost.status).toBe(429);
	});
});
