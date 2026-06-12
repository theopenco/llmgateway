import { serve } from "@hono/node-server";
import "dotenv/config";
import { Hono } from "hono";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { app } from "@/app.js";
import { clearCache } from "@/test-utils/test-helpers.js";

import { db, pool, tables } from "@llmgateway/db";

// A trivial upstream that always returns a valid completion, so the gateway
// path runs end-to-end without touching a real provider.
const mockServer = new Hono();
let server: ReturnType<typeof serve> | null = null;
const MOCK_PORT = 3099;

mockServer.post("/v1/chat/completions", async (c) => {
	return c.json({
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "mock-model",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "Hello" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
	});
});

/**
 * Tables whose reads MUST be served from the Redis/Drizzle cache once warm.
 * A SELECT against any of these on a repeated chat request means the per-request
 * metadata lookup regressed to hitting Postgres (unstable cache key or use of
 * the uncached client) — the exact class of bug this test guards against.
 */
const CACHED_READ_TABLES = [
	"api_key",
	"api_key_iam_rule",
	"project",
	"organization",
	"provider_key",
	"rate_limit",
	"discount",
	"model_provider_mapping_history",
	"user_organization",
	"wallet",
	"end_user_session",
	"end_customer",
	"routing_config",
];

function statementText(args: unknown[]): string {
	const first = args[0];
	if (typeof first === "string") {
		return first;
	}
	if (first && typeof first === "object") {
		const o = first as { text?: unknown; sql?: unknown };
		if (typeof o.text === "string") {
			return o.text;
		}
		if (typeof o.sql === "string") {
			return o.sql;
		}
	}
	return "";
}

function cachedTableReads(statements: string[]): string[] {
	return statements.filter((sql) => {
		const lower = sql.toLowerCase();
		if (!lower.includes("select")) {
			return false;
		}
		return CACHED_READ_TABLES.some((t) => lower.includes(`from "${t}"`));
	});
}

async function sendChat(prompt: string) {
	return await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer cache-token",
		},
		body: JSON.stringify({
			model: "llmgateway/custom",
			messages: [{ role: "user", content: prompt }],
		}),
	});
}

describe("Chat completions caching: repeated requests do not re-read Postgres", () => {
	beforeAll(async () => {
		server = serve({ fetch: mockServer.fetch, port: MOCK_PORT });
	});

	afterAll(() => {
		if (server) {
			server.close();
		}
	});

	beforeEach(async () => {
		await clearCache();

		await Promise.all([
			db.delete(tables.log),
			db.delete(tables.apiKey),
			db.delete(tables.providerKey),
		]);
		await Promise.all([
			db.delete(tables.userOrganization),
			db.delete(tables.project),
		]);
		await Promise.all([db.delete(tables.organization), db.delete(tables.user)]);

		await db.insert(tables.user).values({
			id: "cache-user",
			name: "user",
			email: "cache@test.com",
		});
		// Keep credits positive: findOrganizationById refetches UNCACHED when an
		// org is out of credits, which would legitimately hit Postgres every time.
		await db.insert(tables.organization).values({
			id: "cache-org",
			name: "Cache Org",
			billingEmail: "cache@test.com",
			plan: "pro",
			credits: "100.00",
		});
		await db.insert(tables.userOrganization).values({
			id: "cache-user-org",
			userId: "cache-user",
			organizationId: "cache-org",
		});
		await db.insert(tables.project).values({
			id: "cache-project",
			name: "Cache Project",
			organizationId: "cache-org",
			mode: "api-keys",
		});
		await db.insert(tables.apiKey).values({
			id: "cache-key",
			token: "cache-token",
			projectId: "cache-project",
			description: "Cache Key",
			createdBy: "cache-user",
		});
		await db.insert(tables.providerKey).values({
			id: "cache-provider-key",
			token: "sk-mock",
			provider: "llmgateway",
			organizationId: "cache-org",
			baseUrl: `http://localhost:${MOCK_PORT}`,
		});
	});

	test("a warm chat request issues zero Postgres reads on cached metadata tables", async () => {
		// Warm the cache: api key, project, org, provider key, rate limits,
		// discounts and routing metrics are all looked up and cached here.
		expect((await sendChat("warm up one")).status).toBe(200);
		expect((await sendChat("warm up two")).status).toBe(200);

		// Record every statement the shared pool executes during a fresh request.
		// Both the cached (cdb) and uncached (db) clients use this same pool, so
		// this captures any query that actually reaches Postgres.
		const statements: string[] = [];
		const original = pool.query.bind(pool);
		const spy = vi.spyOn(pool, "query").mockImplementation(((
			...args: Parameters<typeof original>
		) => {
			statements.push(statementText(args));
			return original(...args);
		}) as typeof pool.query);

		try {
			// A unique prompt guarantees the response cache cannot short-circuit
			// the request, so the full auth/routing/pricing path runs.
			const res = await sendChat("measured request with a unique prompt");
			expect(res.status).toBe(200);
		} finally {
			spy.mockRestore();
		}

		const leaked = cachedTableReads(statements);
		expect(
			leaked,
			`Expected zero cached-table SELECTs on a warm request, but these hit Postgres:\n${leaked.join("\n")}`,
		).toEqual([]);
	});
});
