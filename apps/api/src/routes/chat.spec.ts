import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import {
	ONBOARDING_MAX_PROMPT_CHARS,
	ONBOARDING_MAX_TOKENS,
	ONBOARDING_MODEL,
	ONBOARDING_SPONSOR_HEADER,
} from "@llmgateway/shared";

// The onboarding wizard's "try it now" request runs through this proxy: the
// gateway refuses cross-origin browser calls, so the UI posts here with its
// session cookie and the server forwards to the gateway.
//
// Two things are load-bearing and pinned below:
//  - The request always leaves on the CALLER'S OWN key. Routing it through a
//    platform key put the log row in the platform's project, so the user saw a
//    real answer and an empty activity log.
//  - A brand new org has 0 credits, so that one call is zero-rated by the
//    gateway. Eligibility is decided here (session, onboarding incomplete,
//    allowance) and asserted with a secret, because the `onboarding` body flag
//    is client-supplied and would otherwise let anyone waive their own charges.

const SPONSOR_SECRET = "test-onboarding-secret";

describe("chat completion proxy", () => {
	let token: string;
	let previousSecret: string | undefined;
	let gatewayRequests: {
		url: string;
		authorization: string | null;
		sponsor: string | null;
		source: string | null;
		body: Record<string, unknown>;
	}[] = [];
	let gatewayStatus = 200;
	let gatewayBody: Record<string, unknown> | null = null;
	let gatewayRaw: string | null = null;
	let gatewayEmptyBody = false;

	beforeEach(async () => {
		token = await createTestUser();
		gatewayRequests = [];
		gatewayStatus = 200;
		gatewayBody = null;
		gatewayRaw = null;
		gatewayEmptyBody = false;

		previousSecret = process.env.ONBOARDING_SPONSOR_SECRET;
		process.env.ONBOARDING_SPONSOR_SECRET = SPONSOR_SECRET;

		// The allowance lives in Redis and outlives the database reset, so every
		// test starts from a full allowance.
		await redisClient.del("onboarding_sponsored_calls:test-user-id");

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

			if (!url.includes("/chat/completions")) {
				return await originalFetch(input, init);
			}

			const headers = new Headers(init?.headers);
			gatewayRequests.push({
				url,
				authorization: headers.get("authorization"),
				sponsor: headers.get(ONBOARDING_SPONSOR_HEADER),
				source: headers.get("x-source"),
				body: JSON.parse(String(init?.body ?? "{}")),
			});

			if (gatewayStatus !== 200) {
				return new Response(JSON.stringify({ message: "upstream exploded" }), {
					status: gatewayStatus,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (gatewayEmptyBody) {
				return new Response(null, {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				});
			}

			if (gatewayRaw !== null) {
				return new Response(gatewayRaw, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (gatewayBody) {
				return new Response(JSON.stringify(gatewayBody), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response(
				JSON.stringify({
					id: "chatcmpl-proxy",
					model: ONBOARDING_MODEL,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "Hello from the gateway" },
							finish_reason: "stop",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (previousSecret === undefined) {
			Reflect.deleteProperty(process.env, "ONBOARDING_SPONSOR_SECRET");
		} else {
			process.env.ONBOARDING_SPONSOR_SECRET = previousSecret;
		}
		await deleteAll();
	});

	function request(body: Record<string, unknown>, cookie?: string) {
		return app.request("/chat/completion", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "Hello!" }],
				...body,
			}),
		});
	}

	function onboardingRequest() {
		return request(
			{ model: "auto", apiKey: "user-token", onboarding: true },
			token,
		);
	}

	test("rejects an unauthenticated request", async () => {
		const res = await request({ model: "auto", apiKey: "test-token" });

		expect(res.status).toBe(401);
		expect(gatewayRequests).toHaveLength(0);
	});

	test("requires an API key", async () => {
		const res = await request({ model: "auto" }, token);

		expect(res.status).toBe(400);
		expect(gatewayRequests).toHaveLength(0);
	});

	test("forwards the onboarding call on the caller's own key", async () => {
		const res = await onboardingRequest();

		expect(res.status).toBe(200);
		expect(gatewayRequests).toHaveLength(1);
		expect(gatewayRequests[0].url).toContain("/v1/chat/completions");
		// The regression this whole change exists for: never a platform key.
		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].sponsor).toBe(SPONSOR_SECRET);
		expect(gatewayRequests[0].source).toBe("onboarding");
		expect(gatewayRequests[0].body).toMatchObject({
			model: ONBOARDING_MODEL,
			onboarding: true,
			max_tokens: ONBOARDING_MAX_TOKENS,
		});
	});

	// The call is zero-rated, so whatever model it names is billed to the
	// platform. Letting the body choose would let a signup pick the bill.
	test("pins the model on a sponsored call", async () => {
		await request(
			{ model: "gpt-4o", apiKey: "user-token", onboarding: true },
			token,
		);

		expect(gatewayRequests[0].sponsor).toBe(SPONSOR_SECRET);
		expect(gatewayRequests[0].body.model).toBe(ONBOARDING_MODEL);
	});

	test("refuses to sponsor an oversized prompt", async () => {
		await request(
			{
				model: "auto",
				apiKey: "user-token",
				onboarding: true,
				messages: [
					{
						role: "user",
						content: "x".repeat(ONBOARDING_MAX_PROMPT_CHARS + 1),
					},
				],
			},
			token,
		);

		// Still forwarded — just billed to the caller, and with their own model.
		expect(gatewayRequests[0].sponsor).toBeNull();
		expect(gatewayRequests[0].body.model).toBe("auto");
		expect(gatewayRequests[0].body).not.toHaveProperty("max_tokens");
	});

	// An unsponsored call is paid for by the user, so it must not be silently
	// truncated or have its model swapped.
	test("leaves an unsponsored onboarding call uncapped", async () => {
		await db
			.update(tables.user)
			.set({ onboardingCompleted: true })
			.where(eq(tables.user.id, "test-user-id"));

		await request(
			{ model: "gpt-4o", apiKey: "user-token", onboarding: true },
			token,
		);

		expect(gatewayRequests[0].sponsor).toBeNull();
		expect(gatewayRequests[0].body.model).toBe("gpt-4o");
		expect(gatewayRequests[0].body).not.toHaveProperty("max_tokens");
	});

	// A 200 whose body is unusable means the gateway served nothing, so it must
	// not cost an allowance slot either.
	test.each([
		["a malformed body", "not json at all"],
		["a body with no choices", JSON.stringify({ id: "chatcmpl-proxy" })],
		[
			"a choice with no message",
			JSON.stringify({ id: "chatcmpl-proxy", choices: [{ index: 0 }] }),
		],
	])("refunds the allowance on %s", async (_label, raw) => {
		gatewayRaw = raw;
		for (let attempt = 0; attempt < 3; attempt++) {
			await onboardingRequest();
		}

		gatewayRaw = null;
		for (let attempt = 0; attempt < 5; attempt++) {
			await onboardingRequest();
		}

		expect(gatewayRequests.filter((r) => r.sponsor !== null)).toHaveLength(8);
	});

	test("refunds the allowance when the stream has no body", async () => {
		gatewayEmptyBody = true;
		for (let attempt = 0; attempt < 3; attempt++) {
			await request(
				{ model: "auto", apiKey: "user-token", onboarding: true, stream: true },
				token,
			);
		}

		gatewayEmptyBody = false;
		for (let attempt = 0; attempt < 5; attempt++) {
			await onboardingRequest();
		}

		expect(gatewayRequests.filter((r) => r.sponsor !== null)).toHaveLength(8);
	});

	test("refunds the allowance when a 200 carries an in-band error", async () => {
		gatewayBody = { error: { message: "provider exploded" } };
		for (let attempt = 0; attempt < 3; attempt++) {
			await onboardingRequest();
		}

		gatewayBody = null;
		for (let attempt = 0; attempt < 5; attempt++) {
			await onboardingRequest();
		}

		expect(gatewayRequests.filter((r) => r.sponsor !== null)).toHaveLength(8);
	});

	test("does not assert sponsorship once onboarding is complete", async () => {
		await db
			.update(tables.user)
			.set({ onboardingCompleted: true })
			.where(eq(tables.user.id, "test-user-id"));

		await onboardingRequest();

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].sponsor).toBeNull();
	});

	test("does not assert sponsorship when no secret is configured", async () => {
		Reflect.deleteProperty(process.env, "ONBOARDING_SPONSOR_SECRET");

		await onboardingRequest();

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].sponsor).toBeNull();
	});

	test("stops asserting sponsorship once the allowance is spent", async () => {
		for (let attempt = 0; attempt < 6; attempt++) {
			await onboardingRequest();
		}

		const sponsored = gatewayRequests.filter((r) => r.sponsor !== null);
		expect(sponsored).toHaveLength(5);
		expect(gatewayRequests[5].sponsor).toBeNull();
		// Even unsponsored, it still goes out on the user's own key.
		expect(gatewayRequests[5].authorization).toBe("Bearer user-token");
	});

	test("refunds the allowance when the gateway call fails", async () => {
		gatewayStatus = 500;
		for (let attempt = 0; attempt < 3; attempt++) {
			await onboardingRequest();
		}

		// A flaky provider must not burn onboarding: all three were refunded, so a
		// full allowance is still available.
		gatewayStatus = 200;
		for (let attempt = 0; attempt < 5; attempt++) {
			await onboardingRequest();
		}

		expect(gatewayRequests.filter((r) => r.sponsor !== null)).toHaveLength(8);
	});

	test("leaves non-onboarding requests untouched", async () => {
		await request({ model: "gpt-4o", apiKey: "user-token" }, token);

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].body.model).toBe("gpt-4o");
		expect(gatewayRequests[0].sponsor).toBeNull();
		expect(gatewayRequests[0].source).toBeNull();
		expect(gatewayRequests[0].body).not.toHaveProperty("onboarding");
		expect(gatewayRequests[0].body).not.toHaveProperty("max_tokens");
	});
});
