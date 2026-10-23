import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("hourly API-key limits across daylight saving time", () => {
	const harness = createGatewayApiTestHarness();

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	test.each([
		["2026-10-25T00:30:00.000Z", 1],
		["2026-03-29T00:30:00.000Z", 2],
	])("resets at the elapsed-hour boundary from %s", async (start, hours) => {
		vi.stubEnv("TZ", "Europe/Stockholm");
		const startedAt = new Date(start);
		await db.insert(tables.apiKey).values({
			id: "period-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
			periodUsageLimit: "1",
			periodUsageDurationValue: hours,
			periodUsageDurationUnit: "hour",
			currentPeriodUsage: "1",
			currentPeriodStartedAt: startedAt,
		});
		await db.insert(tables.providerKey).values({
			id: "period-provider-key",
			...encryptProviderKeyForStorage(
				"sk-openai-test-key",
				"period-provider-key",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		vi.useFakeTimers({ toFake: ["Date"] });
		const milliseconds = hours * 60 * 60 * 1000;
		const resetAt = startedAt.getTime() + milliseconds;

		for (const [now, status] of [
			[resetAt - 1, 401],
			[resetAt, 200],
		]) {
			vi.setSystemTime(now);
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-no-fallback": "true",
					"x-no-cache": "true",
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "hello" }],
				}),
			});
			expect(response.status).toBe(status);
			await response.text();
		}
	});
});
