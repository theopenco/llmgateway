import { describe, expect, it } from "vitest";

import { app } from "@/index.js";

const BURST_LIMIT_MAX = 5;
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

// Omits `messages` on purpose: requests that pass the rate limiter fail
// validation with a 400, so these tests exercise the limiter without ever
// touching the DB or the LLM.
async function sendMessage(ip: string, clientId: string): Promise<Response> {
	return await app.request("/public/chat-support", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify({ clientId }),
	});
}

describe("public chat support rate limiting", () => {
	it("blocks message bursts per IP", async () => {
		const ip = uniqueIp();
		for (let i = 0; i < BURST_LIMIT_MAX; i++) {
			const res = await sendMessage(ip, uniqueClientId());
			expect(res.status).toBe(400);
		}
		const blocked = await sendMessage(ip, uniqueClientId());
		expect(blocked.status).toBe(429);
		const json = await blocked.json();
		expect(json.error).toContain("too quickly");
	});

	it("blocks message bursts per clientId across IPs", async () => {
		const clientId = uniqueClientId();
		for (let i = 0; i < BURST_LIMIT_MAX; i++) {
			const res = await sendMessage(uniqueIp(), clientId);
			expect(res.status).toBe(400);
		}
		const blocked = await sendMessage(uniqueIp(), clientId);
		expect(blocked.status).toBe(429);
	});

	it("does not throttle other visitors when one is blocked", async () => {
		const ip = uniqueIp();
		const clientId = uniqueClientId();
		for (let i = 0; i < BURST_LIMIT_MAX + 1; i++) {
			await sendMessage(ip, clientId);
		}
		const other = await sendMessage(uniqueIp(), uniqueClientId());
		expect(other.status).toBe(400);
	});

	it("throttles the cheap endpoints on a shared per-IP bucket", async () => {
		const ip = uniqueIp();
		for (let i = 0; i < META_BURST_LIMIT_MAX; i++) {
			// Missing clientId: passes the limiter, fails validation with a 400.
			const res = await app.request("/public/chat-support/conversation", {
				headers: { "CF-Connecting-IP": ip },
			});
			expect(res.status).toBe(400);
		}
		const blocked = await app.request("/public/chat-support/reaction", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({}),
		});
		expect(blocked.status).toBe(429);
	});
});
