import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, modelProviderMappingHistory, systemSetting } from "@llmgateway/db";
import {
	DEFAULT_MODEL_ERROR_RATE_ALERT_RULES,
	MODEL_ERROR_RATE_ALERTS_SETTING_ID,
} from "@llmgateway/shared";

import {
	checkModelErrorRateAlerts,
	cooldownKey,
	findMappingsOverThreshold,
} from "./model-error-rate-alerts.js";

import type { ModelErrorRateAlertRule } from "@llmgateway/shared";

const shortRule = DEFAULT_MODEL_ERROR_RATE_ALERT_RULES[0];

const counts = {
	mappingId: "m1",
	modelId: "gpt-test",
	providerId: "openai",
	logsCount: 100,
	clientErrorsCount: 0,
	gatewayErrorsCount: 0,
	upstreamErrorsCount: 0,
	retriedGatewayErrorsCount: 0,
	retriedUpstreamErrorsCount: 0,
};

describe("findMappingsOverThreshold", () => {
	it("flags mappings at or above the threshold with enough traffic", () => {
		const hits = findMappingsOverThreshold(shortRule, [
			{ ...counts, mappingId: "at", upstreamErrorsCount: 30 },
			{ ...counts, mappingId: "below", upstreamErrorsCount: 29 },
			{ ...counts, mappingId: "worse", gatewayErrorsCount: 50 },
		]);
		expect(hits.map((hit) => hit.mappingId)).toEqual(["worse", "at"]);
		expect(hits[1].errorRate).toBe(30);
	});

	it("excludes client errors and skips low-traffic mappings", () => {
		const hits = findMappingsOverThreshold(shortRule, [
			// 25 non-client requests, 10 errors = 40%.
			{
				...counts,
				mappingId: "client-heavy",
				clientErrorsCount: 75,
				upstreamErrorsCount: 10,
			},
			// 19 requests is below minRequests (20).
			{ ...counts, mappingId: "tiny", logsCount: 19, upstreamErrorsCount: 19 },
		]);
		expect(hits.map((hit) => hit.mappingId)).toEqual(["client-heavy"]);
		expect(hits[0].errorRate).toBe(40);
	});

	it("drops retried attempts when the rule excludes them", () => {
		// 40 errors over 100 attempts; 30 of the errors were retried elsewhere.
		const row = {
			...counts,
			upstreamErrorsCount: 30,
			gatewayErrorsCount: 10,
			retriedUpstreamErrorsCount: 25,
			retriedGatewayErrorsCount: 5,
		};
		expect(findMappingsOverThreshold(shortRule, [row])[0]).toMatchObject({
			requestCount: 100,
			errorsCount: 40,
		});
		// 10 unretried errors over 70 remaining attempts is below 30%.
		expect(
			findMappingsOverThreshold({ ...shortRule, includeRetriedErrors: false }, [
				row,
			]),
		).toEqual([]);
		const [hit] = findMappingsOverThreshold(
			{ ...shortRule, includeRetriedErrors: false, errorRatePercent: 10 },
			[row],
		);
		expect(hit).toMatchObject({
			requestCount: 70,
			errorsCount: 10,
			upstreamErrorsCount: 5,
			gatewayErrorsCount: 5,
		});
	});
});

describe("checkModelErrorRateAlerts", () => {
	const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
	const originalUrl = process.env.MODEL_ERROR_RATE_DISCORD_URL;
	const mappingId = "mer-alert-mapping";

	async function saveSetting(
		enabled: boolean,
		rules: ModelErrorRateAlertRule[] = [shortRule],
	) {
		await db
			.insert(systemSetting)
			.values({
				id: MODEL_ERROR_RATE_ALERTS_SETTING_ID,
				enabled,
				value: JSON.stringify({ enabled, rules }),
			})
			.onConflictDoUpdate({
				target: systemSetting.id,
				set: { enabled, value: JSON.stringify({ enabled, rules }) },
			});
	}

	beforeEach(async () => {
		vi.stubGlobal("fetch", fetchMock);
		process.env.MODEL_ERROR_RATE_DISCORD_URL = "https://discord.test/webhook";
		await db.delete(systemSetting);
		await db.delete(modelProviderMappingHistory);
		await redisClient.del(cooldownKey(shortRule.id, mappingId));
		const now = new Date();
		now.setSeconds(0, 0);
		await db.insert(modelProviderMappingHistory).values([
			{
				modelId: "gpt-test",
				providerId: "openai",
				modelProviderMappingId: mappingId,
				usedMode: "credits",
				minuteTimestamp: now,
				logsCount: 40,
				upstreamErrorsCount: 20,
			},
			// BYOK traffic never counts.
			{
				modelId: "gpt-test",
				providerId: "openai",
				modelProviderMappingId: mappingId,
				usedMode: "api-keys",
				minuteTimestamp: now,
				logsCount: 1000,
			},
		]);
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		fetchMock.mockClear();
		if (originalUrl === undefined) {
			delete process.env.MODEL_ERROR_RATE_DISCORD_URL;
		} else {
			process.env.MODEL_ERROR_RATE_DISCORD_URL = originalUrl;
		}
		await db.delete(systemSetting);
		await db.delete(modelProviderMappingHistory);
		await redisClient.del(cooldownKey(shortRule.id, mappingId));
	});

	it("does nothing until enabled", async () => {
		await checkModelErrorRateAlerts();
		await saveSetting(false);
		await checkModelErrorRateAlerts();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does nothing without a webhook", async () => {
		delete process.env.MODEL_ERROR_RATE_DISCORD_URL;
		await saveSetting(true);
		await checkModelErrorRateAlerts();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("alerts once per cooldown", async () => {
		await saveSetting(true);
		await checkModelErrorRateAlerts();
		await checkModelErrorRateAlerts();

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://discord.test/webhook");
		const body = JSON.parse(String(init.body));
		expect(body.embeds[0].title).toBe(`High error rate: ${shortRule.label}`);
		expect(body.embeds[0].fields[0]).toMatchObject({
			name: "gpt-test / openai",
		});
		expect(body.embeds[0].fields[0].value).toContain("**50.0%** · 20/40");
	});

	it("releases the cooldown when delivery fails", async () => {
		await saveSetting(true);
		fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
		await checkModelErrorRateAlerts();
		expect(await redisClient.exists(cooldownKey(shortRule.id, mappingId))).toBe(
			0,
		);

		await checkModelErrorRateAlerts();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("skips disabled rules and rules whose threshold is not met", async () => {
		await saveSetting(true, [
			{ ...shortRule, enabled: false },
			{ ...shortRule, id: "strict", errorRatePercent: 60 },
		]);
		await checkModelErrorRateAlerts();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
