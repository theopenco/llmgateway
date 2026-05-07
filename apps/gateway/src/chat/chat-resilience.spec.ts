import { beforeAll, describe, expect, test, vi, afterEach } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { redisClient } from "@llmgateway/cache";
import { cdb, db, eq, tables } from "@llmgateway/db";

describe("chat resilience under DB outage", () => {
	const harness = createGatewayApiTestHarness({
		mockServerPort: 3010,
	});
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function stubDbOutage() {
		const err = new Error("ECONNREFUSED: postgres unavailable");
		const cdbSelect = vi.spyOn(cdb, "select").mockImplementation(() => {
			throw err;
		});
		const dbSelect = vi.spyOn(db, "select").mockImplementation(() => {
			throw err;
		});
		return () => {
			cdbSelect.mockRestore();
			dbSelect.mockRestore();
		};
	}

	async function seedCustomApiAndProvider(opts: {
		apiKeyId: string;
		token: string;
		providerKeyId: string;
		baseUrl: string;
	}) {
		await db.insert(tables.apiKey).values({
			id: opts.apiKeyId,
			token: opts.token,
			projectId: "project-id",
			description: "Resilience API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: opts.providerKeyId,
			token: "sk-resilience-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: opts.baseUrl,
		});
	}

	function buildChatRequest(token: string, extraBody: object = {}) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [{ role: "user", content: "Hello!" }],
				...extraBody,
			}),
		});
	}

	test("primed request succeeds while DB is down", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-1",
			token: "resilience-token-1",
			providerKeyId: "resilience-provider-key-1",
			baseUrl: mockServerUrl,
		});

		const primeRes = await buildChatRequest("resilience-token-1");
		expect(primeRes.status).toBe(200);

		const restore = stubDbOutage();
		try {
			const fallbackRes = await buildChatRequest("resilience-token-1");
			expect(fallbackRes.status).toBe(200);
			const json = await fallbackRes.json();
			expect(json.choices?.[0]?.message?.content).toMatch(/Hello!/);
		} finally {
			restore();
		}
	});

	test("multiple consecutive requests served from SWR while DB is down", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-2",
			token: "resilience-token-2",
			providerKeyId: "resilience-provider-key-2",
			baseUrl: mockServerUrl,
		});

		expect((await buildChatRequest("resilience-token-2")).status).toBe(200);

		const restore = stubDbOutage();
		try {
			for (let i = 0; i < 3; i++) {
				const res = await buildChatRequest("resilience-token-2");
				expect(res.status).toBe(200);
			}
		} finally {
			restore();
		}
	});

	test("concurrent requests during outage all succeed from primed mirrors", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-concurrent",
			token: "resilience-token-concurrent",
			providerKeyId: "resilience-provider-key-concurrent",
			baseUrl: mockServerUrl,
		});

		expect((await buildChatRequest("resilience-token-concurrent")).status).toBe(
			200,
		);

		const restore = stubDbOutage();
		try {
			const results = await Promise.all(
				Array.from({ length: 5 }, () =>
					buildChatRequest("resilience-token-concurrent"),
				),
			);
			for (const res of results) {
				expect(res.status).toBe(200);
			}
		} finally {
			restore();
		}
	});

	test("streaming request survives DB outage after priming", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-stream",
			token: "resilience-token-stream",
			providerKeyId: "resilience-provider-key-stream",
			baseUrl: mockServerUrl,
		});

		expect(
			(await buildChatRequest("resilience-token-stream", { stream: true }))
				.status,
		).toBe(200);

		const restore = stubDbOutage();
		try {
			const res = await buildChatRequest("resilience-token-stream", {
				stream: true,
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
		} finally {
			restore();
		}
	});

	test("unprimed api key fails cleanly when DB is down", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-3",
			token: "resilience-token-3",
			providerKeyId: "resilience-provider-key-3",
			baseUrl: mockServerUrl,
		});

		const restore = stubDbOutage();
		try {
			const res = await buildChatRequest("resilience-token-3");
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).not.toBe(200);
		} finally {
			restore();
		}
	});

	test("expired SWR mirror surfaces error instead of stale data", async () => {
		const originalTtl = process.env.SWR_STALE_TTL_SECONDS;
		process.env.SWR_STALE_TTL_SECONDS = "1";

		try {
			await seedCustomApiAndProvider({
				apiKeyId: "resilience-api-key-4",
				token: "resilience-token-4",
				providerKeyId: "resilience-provider-key-4",
				baseUrl: mockServerUrl,
			});

			expect((await buildChatRequest("resilience-token-4")).status).toBe(200);

			await new Promise((resolve) => setTimeout(resolve, 1500));
			const swrKeys = await redisClient.keys("swr:*");
			for (const k of swrKeys) {
				await redisClient.unlink(k);
			}

			const restore = stubDbOutage();
			try {
				const res = await buildChatRequest("resilience-token-4");
				expect(res.status).toBeGreaterThanOrEqual(400);
				expect(res.status).not.toBe(200);
			} finally {
				restore();
			}
		} finally {
			if (originalTtl === undefined) {
				delete process.env.SWR_STALE_TTL_SECONDS;
			} else {
				process.env.SWR_STALE_TTL_SECONDS = originalTtl;
			}
		}
	});

	test("mutation through cdb invalidates SWR mirror after recovery", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-5",
			token: "resilience-token-5",
			providerKeyId: "resilience-provider-key-5",
			baseUrl: mockServerUrl,
		});

		expect((await buildChatRequest("resilience-token-5")).status).toBe(200);

		const mirrorBefore = await redisClient.get(
			"swr:providerKey:org-id:llmgateway",
		);
		expect(mirrorBefore).not.toBeNull();

		await cdb
			.update(tables.providerKey)
			.set({ baseUrl: `${mockServerUrl}/` })
			.where(eq(tables.providerKey.id, "resilience-provider-key-5"));

		const mirrorAfter = await redisClient.get(
			"swr:providerKey:org-id:llmgateway",
		);
		expect(mirrorAfter).toBeNull();
	});

	test("isCachingEnabled survives outage via SWR mirror", async () => {
		await seedCustomApiAndProvider({
			apiKeyId: "resilience-api-key-caching",
			token: "resilience-token-caching",
			providerKeyId: "resilience-provider-key-caching",
			baseUrl: mockServerUrl,
		});

		expect((await buildChatRequest("resilience-token-caching")).status).toBe(
			200,
		);

		const mirror = await redisClient.get(
			"swr:project:cachingEnabled:project-id",
		);
		expect(mirror).not.toBeNull();

		const restore = stubDbOutage();
		try {
			const res = await buildChatRequest("resilience-token-caching");
			expect(res.status).toBe(200);
		} finally {
			restore();
		}
	});
});
