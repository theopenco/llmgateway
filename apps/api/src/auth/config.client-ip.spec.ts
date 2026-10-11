import { afterEach, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { randomInt } from "@llmgateway/shared/random";

import { apiAuth } from "./config.js";

// Hoisted above the imports: the auth config names the header at module load.
vi.hoisted(() => {
	process.env.CLIENT_IP_HEADER = "X-Client-Ip";
});

const email = `test-session-ip-${Date.now()}@example.com`;
const password = "Password123!";

afterEach(async () => {
	await db.delete(tables.user).where(eq(tables.user.email, email));
});

test("records the session IP from CLIENT_IP_HEADER behind an appending load balancer", async () => {
	const clientIp = `203.0.113.${randomInt(1, 254)}`;
	// The hosted shape: an overwritten single-value header plus a forwarding
	// chain whose first hop is caller-supplied.
	const headers = {
		"Content-Type": "application/json",
		"X-Client-Ip": clientIp,
		"X-Forwarded-For": `198.51.100.7, ${clientIp}, 10.0.0.1`,
	};

	const signUpResponse = await apiAuth.handler(
		new Request("http://localhost:4002/auth/sign-up/email", {
			method: "POST",
			headers,
			body: JSON.stringify({ email, password, name: "Test User" }),
		}),
	);
	expect(signUpResponse.status).toBe(200);

	await db
		.update(tables.user)
		.set({ emailVerified: true })
		.where(eq(tables.user.email, email));

	const signInResponse = await apiAuth.handler(
		new Request("http://localhost:4002/auth/sign-in/email", {
			method: "POST",
			headers,
			body: JSON.stringify({ email, password }),
		}),
	);
	expect(signInResponse.status).toBe(200);

	const sessions = await db
		.select({ ipAddress: tables.session.ipAddress })
		.from(tables.session)
		.innerJoin(tables.user, eq(tables.user.id, tables.session.userId))
		.where(eq(tables.user.email, email));
	expect(sessions.length).toBeGreaterThan(0);
	expect(sessions.map((s) => s.ipAddress)).toEqual(
		sessions.map(() => clientIp),
	);
});
