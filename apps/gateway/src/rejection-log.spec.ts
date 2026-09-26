import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { processLogQueue } from "worker";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { orgInflightKey } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

const headers = {
	"Content-Type": "application/json",
	Authorization: "Bearer test-token",
};
const body = {
	model: "gpt-4o-mini",
	messages: [{ role: "user", content: "Hello" }],
};

async function readLog() {
	const logs = await waitForLogs();
	expect(logs).toHaveLength(1);
	const log = logs[0];
	expect(log).toMatchObject({
		hasError: true,
		finishReason: "client_error",
		cost: 0,
		dataStorageCost: "0",
		usedProvider: "llmgateway",
	});
	return log;
}

describe("gateway rejection logs", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
	});

	afterEach(() => vi.unstubAllEnvs());

	test.each([
		["/v1/chat/completions", body, "chat-completions"],
		["/v1/messages", { ...body, max_tokens: 10 }, "messages"],
		["/v1/responses", { model: body.model, input: "Hello" }, "responses"],
		[
			"/v1/embeddings",
			{ model: "text-embedding-3-small", input: "Hello" },
			"embeddings",
		],
	] as const)(
		"logs account review on %s",
		async (path, requestBody, apiOrigin) => {
			await db
				.update(tables.organization)
				.set({ riskFlagged: true })
				.where(eq(tables.organization.id, "org-id"));
			const response = await app.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
			});
			expect(response.status).toBe(403);
			expect(await response.text()).toContain("under review");
			const log = await readLog();
			expect(log).toMatchObject({
				errorCategory: "account_review",
				apiOrigin,
				errorDetails: { statusCode: 403 },
			});
			expect(response.headers.get("x-request-id")).toBe(log.requestId);
		},
	);

	test("records disabled accounts without retaining payloads", async () => {
		await db
			.update(tables.organization)
			.set({
				status: "deleted",
				retentionLevel: "none",
				blockReason: "Account policy violation",
			})
			.where(eq(tables.organization.id, "org-id"));
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		expect(response.status).toBe(410);
		const log = await readLog();
		expect(log).toMatchObject({
			errorCategory: "account_disabled",
			messages: null,
			errorDetails: { statusCode: 410 },
		});
	});

	test("does not duplicate an already logged validation error", async () => {
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: "{",
		});
		expect(response.status).toBe(400);
		expect(await readLog()).toMatchObject({ errorCategory: "validation" });
	});

	test("does not duplicate errors from an internal Messages forward", async () => {
		const response = await app.request("/v1/messages", {
			method: "POST",
			headers,
			body: JSON.stringify({
				...body,
				model: "nonexistent-model",
				max_tokens: 10,
			}),
		});
		expect(response.status).toBe(400);
		expect(await readLog()).toMatchObject({
			apiOrigin: "messages",
			errorCategory: "validation",
		});
	});

	test("does not log an unrecognized key", async () => {
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { ...headers, Authorization: "Bearer unknown-key" },
			body: JSON.stringify(body),
		});
		expect(response.status).toBe(401);
		await processLogQueue();
		expect(await db.query.log.findMany()).toHaveLength(0);
	});

	test("preserves the rejection when the log queue is unavailable", async () => {
		await db
			.update(tables.organization)
			.set({ riskFlagged: true })
			.where(eq(tables.organization.id, "org-id"));
		const publish = vi
			.spyOn(redisClient, "lpush")
			.mockRejectedValueOnce(new Error("Queue unavailable"));
		try {
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(403);
			expect(await response.text()).toContain("under review");
			expect(publish).toHaveBeenCalledTimes(1);
		} finally {
			publish.mockRestore();
		}
	});

	test("logs organization RPM limits", async () => {
		vi.stubEnv("GATEWAY_RATE_LIMITS_ENABLED", "true");
		vi.stubEnv("GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM", "1");
		await redisClient.zadd(
			"rate_limit:org_path:org-id:chat_completions",
			Date.now(),
			"previous-request",
		);
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBeTruthy();
		expect(await readLog()).toMatchObject({
			errorCategory: "rate_limit",
			requestedModel: "unknown",
			errorDetails: { statusCode: 429 },
		});
	});

	test("logs organization concurrency limits without consuming the body", async () => {
		vi.stubEnv("GATEWAY_RATE_LIMITS_ENABLED", "true");
		vi.stubEnv("GATEWAY_SPEND_TIER_0_INFLIGHT_LIMIT", "1");
		await redisClient.zadd(
			orgInflightKey("org-id"),
			Date.now(),
			"active-request",
		);
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("1");
		expect(await readLog()).toMatchObject({
			errorCategory: "concurrency_limit",
			requestedModel: "unknown",
			errorDetails: { statusCode: 429 },
		});
	});
});
