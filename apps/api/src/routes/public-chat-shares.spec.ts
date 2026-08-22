import { describe, expect, it } from "vitest";

import { redisClient } from "@/auth/config.js";
import { app } from "@/index.js";

import { randomInt, uniqueId } from "@llmgateway/shared/random";

const SHARE_BURST_MAX = 30;
const SHARE_HOURLY_MAX = 600;
const LIST_BURST_MAX = 5;

// Unique addresses per call so runs never collide with earlier state in Redis
// (the rate-limit keys live for up to an hour).
function uniqueIp(): string {
	const octet = () => randomInt(0, 256);
	return `10.${octet()}.${octet()}.${octet()}`;
}

// Seeds a single limiter bucket to its threshold so the next request trips
// exactly that limiter.
async function seedLimit(
	bucket: string,
	ip: string,
	max: number,
): Promise<void> {
	await redisClient.set(
		`chat_share_rate_limit:${bucket}:ip:${ip}`,
		String(max),
		"EX",
		60,
	);
}

async function getShare(ip: string): Promise<Response> {
	return await app.request(`/public/chats/share/${uniqueId("share")}`, {
		headers: { "X-Forwarded-For": ip },
	});
}

async function listShares(ip: string): Promise<Response> {
	return await app.request("/public/chats/share?limit=1", {
		headers: { "X-Forwarded-For": ip },
	});
}

describe("public chat share rate limiting", () => {
	it("blocks share reads once the per-IP burst window is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("share_burst", ip, SHARE_BURST_MAX);
		const blocked = await getShare(ip);
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.message).toContain("Too many requests");
	});

	it("blocks share reads once the hourly per-IP quota is exhausted", async () => {
		const ip = uniqueIp();
		await seedLimit("share_hour", ip, SHARE_HOURLY_MAX);
		expect((await getShare(ip)).status).toBe(429);
	});

	it("blocks the listing on its own tighter budget", async () => {
		const ip = uniqueIp();
		await seedLimit("list_burst", ip, LIST_BURST_MAX);
		expect((await listShares(ip)).status).toBe(429);
	});

	it("keeps the listing and share buckets separate", async () => {
		const ip = uniqueIp();
		await seedLimit("list_burst", ip, LIST_BURST_MAX);
		expect((await listShares(ip)).status).toBe(429);
		expect((await getShare(ip)).status).not.toBe(429);
	});

	it("does not throttle other visitors when one is blocked", async () => {
		const ip = uniqueIp();
		await seedLimit("share_burst", ip, SHARE_BURST_MAX);
		expect((await getShare(ip)).status).toBe(429);
		expect((await getShare(uniqueIp())).status).not.toBe(429);
	});
});
