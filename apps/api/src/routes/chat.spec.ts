import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { ONBOARDING_MAX_TOKENS, ONBOARDING_MODEL } from "@llmgateway/shared";

// The onboarding wizard's "try it now" request runs through this proxy: the
// gateway refuses cross-origin browser calls, so the UI posts here with its
// session cookie and the server forwards to the gateway. A brand new
// organization has no credits, so that first call is sponsored by a
// platform-owned key — which means the endpoint has to stay session-gated (the
// UI must send its cookie), and the sponsored path has to pin what it spends
// rather than trusting the request body.

// Both keys are real deployment env vars, so save and restore whatever the
// developer's environment already had rather than deleting it outright.
const PLATFORM_KEY_VARS = [
	"ONBOARDING_CHAT_API_KEY",
	"SUPPORT_CHAT_API_KEY",
] as const;

describe("chat completion proxy", () => {
	let token: string;
	let previousPlatformKeys: Record<string, string | undefined> = {};
	let gatewayRequests: {
		url: string;
		authorization: string | null;
		body: Record<string, unknown>;
	}[] = [];

	beforeEach(async () => {
		token = await createTestUser();
		gatewayRequests = [];

		previousPlatformKeys = Object.fromEntries(
			PLATFORM_KEY_VARS.map((name) => [name, process.env[name]]),
		);
		delete process.env.SUPPORT_CHAT_API_KEY;
		process.env.ONBOARDING_CHAT_API_KEY = "platform-onboarding-key";

		// The sponsored-call allowance lives in Redis and outlives the database
		// reset, so every test starts from a full allowance.
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

			gatewayRequests.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
				body: JSON.parse(String(init?.body ?? "{}")),
			});

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
		for (const name of PLATFORM_KEY_VARS) {
			const previous = previousPlatformKeys[name];
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, name);
			} else {
				process.env[name] = previous;
			}
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

	test("rejects an unauthenticated request", async () => {
		const res = await request({ model: "auto", apiKey: "test-token" });

		expect(res.status).toBe(401);
		expect(gatewayRequests).toHaveLength(0);
	});

	test("sponsors the first onboarding call with the platform key", async () => {
		const res = await request(
			{ model: ONBOARDING_MODEL, apiKey: "user-token", onboarding: true },
			token,
		);

		expect(res.status).toBe(200);
		expect(gatewayRequests).toHaveLength(1);
		expect(gatewayRequests[0].url).toContain("/v1/chat/completions");
		expect(gatewayRequests[0].authorization).toBe(
			"Bearer platform-onboarding-key",
		);
		expect(gatewayRequests[0].body).toMatchObject({
			model: ONBOARDING_MODEL,
			onboarding: true,
			max_tokens: ONBOARDING_MAX_TOKENS,
		});
	});

	test("pins the sponsored model instead of trusting the request", async () => {
		await request(
			{ model: "gpt-4o", apiKey: "user-token", onboarding: true },
			token,
		);

		expect(gatewayRequests[0].body.model).toBe(ONBOARDING_MODEL);
	});

	test("stops sponsoring once onboarding is complete", async () => {
		await db
			.update(tables.user)
			.set({ onboardingCompleted: true })
			.where(eq(tables.user.id, "test-user-id"));

		await request(
			{ model: ONBOARDING_MODEL, apiKey: "user-token", onboarding: true },
			token,
		);

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].body).not.toHaveProperty("max_tokens");
	});

	test("falls back to the caller's key when no platform key is configured", async () => {
		for (const name of PLATFORM_KEY_VARS) {
			Reflect.deleteProperty(process.env, name);
		}

		await request(
			{ model: ONBOARDING_MODEL, apiKey: "user-token", onboarding: true },
			token,
		);

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
	});

	test("stops sponsoring once the allowance is spent", async () => {
		// One more attempt than the allowance; the tail must land on the user's
		// own key rather than keep spending ours.
		const authorizations: (string | null)[] = [];
		for (let attempt = 0; attempt < 6; attempt++) {
			await request(
				{ model: ONBOARDING_MODEL, apiKey: "user-token", onboarding: true },
				token,
			);
			authorizations.push(gatewayRequests[attempt].authorization);
		}

		expect(
			authorizations.filter((a) => a === "Bearer platform-onboarding-key"),
		).toHaveLength(5);
		expect(authorizations[5]).toBe("Bearer user-token");
	});

	test("leaves non-onboarding requests on the caller's key", async () => {
		await request({ model: "gpt-4o", apiKey: "user-token" }, token);

		expect(gatewayRequests[0].authorization).toBe("Bearer user-token");
		expect(gatewayRequests[0].body.model).toBe("gpt-4o");
		expect(gatewayRequests[0].body).not.toHaveProperty("onboarding");
	});
});
