import { beforeEach, describe, expect, it } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";

import {
	alertEventKey,
	buildAlertMessage,
	cooldownKey,
	findTargetsOverThreshold,
	metricsForRule,
	platformTargetId,
	processProviderKeyAlerts,
	windowBucketStart,
} from "./provider-key-alerts.js";

import type {
	ProviderKeyAlertRule,
	ProviderKeyAlertSettings,
} from "@llmgateway/shared/provider-key-alerts";

const ORG = "pka-org";
const KEY = "pka-key";
const MANAGED_KEY = "pka-managed";
const PLATFORM = platformTargetId("anthropic");
const shortRule: ProviderKeyAlertRule = {
	id: "short",
	label: "15m critical",
	enabled: true,
	windowMinutes: 15,
	errorRatePercent: 50,
	minRequests: 10,
	cooldownMinutes: 60,
	includeRetriedErrors: false,
	includeClientErrors: true,
};
const longRule: ProviderKeyAlertRule = {
	id: "long",
	label: "4h warning",
	enabled: true,
	windowMinutes: 240,
	errorRatePercent: 30,
	minRequests: 20,
	cooldownMinutes: 240,
	includeRetriedErrors: false,
	includeClientErrors: true,
};

const counts = {
	targetId: KEY,
	requestCount: 100,
	clientErrorCount: 0,
	gatewayErrorCount: 0,
	upstreamErrorCount: 0,
	retriedGatewayErrorCount: 0,
	retriedUpstreamErrorCount: 0,
};

const settings: ProviderKeyAlertSettings = {
	enabled: true,
	keySource: "byok",
	inApp: true,
	email: true,
	channels: [],
	rules: [shortRule],
};

describe("findTargetsOverThreshold", () => {
	it("flags keys at or above the threshold with enough traffic", () => {
		const hits = findTargetsOverThreshold(shortRule, [
			{ ...counts, targetId: "at", upstreamErrorCount: 50 },
			{ ...counts, targetId: "below", upstreamErrorCount: 49 },
			{ ...counts, targetId: "worse", gatewayErrorCount: 80 },
		]);
		expect(hits.map((hit) => hit.targetId)).toEqual(["worse", "at"]);
		expect(hits[1].errorRate).toBe(50);
	});

	it("counts client errors as errors by default and skips low-traffic keys", () => {
		const hits = findTargetsOverThreshold(shortRule, [
			// 80 client + 12 upstream errors over 100 requests = 92%.
			{
				...counts,
				targetId: "client-heavy",
				clientErrorCount: 80,
				upstreamErrorCount: 12,
			},
			// 9 requests is below minRequests (10).
			{
				...counts,
				targetId: "tiny",
				requestCount: 9,
				gatewayErrorCount: 9,
			},
		]);
		expect(hits.map((hit) => hit.targetId)).toEqual(["client-heavy"]);
		expect(hits[0].errorRate).toBe(92);
	});

	it("drops client errors from both sides when the rule excludes them", () => {
		const row = { ...counts, clientErrorCount: 80, upstreamErrorCount: 12 };
		// 12 errors over the 20 remaining requests = 60%.
		expect(
			metricsForRule({ ...shortRule, includeClientErrors: false }, row),
		).toMatchObject({ requestCount: 20, errorsCount: 12, errorRate: 60 });
	});

	it("drops retried attempts unless the rule includes them", () => {
		// 60 errors over 100 attempts, 50 of them retried elsewhere.
		const row = {
			...counts,
			upstreamErrorCount: 40,
			gatewayErrorCount: 20,
			retriedUpstreamErrorCount: 35,
			retriedGatewayErrorCount: 15,
		};
		// 10 unretried errors over 50 remaining attempts = 20%: below 50%.
		expect(findTargetsOverThreshold(shortRule, [row])).toEqual([]);
		expect(metricsForRule(shortRule, row)).toEqual({
			requestCount: 50,
			errorsCount: 10,
			errorRate: 20,
		});
		const [hit] = findTargetsOverThreshold(
			{ ...shortRule, includeRetriedErrors: true },
			[row],
		);
		expect(hit).toMatchObject({ judgedCount: 100, errorsCount: 60 });
	});
});

describe("windowBucketStart", () => {
	it("widens the window to the start of its first hour", () => {
		const now = new Date("2026-01-01T10:10:00Z");
		expect(windowBucketStart(shortRule, now).toISOString()).toBe(
			"2026-01-01T09:00:00.000Z",
		);
		expect(windowBucketStart(longRule, now).toISOString()).toBe(
			"2026-01-01T06:00:00.000Z",
		);
	});
});

describe("alertEventKey", () => {
	it("is stable inside a cooldown slot", () => {
		const a = alertEventKey(shortRule, KEY, new Date("2026-01-01T10:10:00Z"));
		const b = alertEventKey(shortRule, KEY, new Date("2026-01-01T10:50:00Z"));
		const c = alertEventKey(shortRule, KEY, new Date("2026-01-01T11:10:00Z"));
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe("buildAlertMessage", () => {
	it("lists the worst models first", () => {
		const message = buildAlertMessage(
			shortRule,
			{ kind: "byok" },
			{
				...counts,
				upstreamErrorCount: 60,
				judgedCount: 100,
				errorsCount: 60,
				errorRate: 60,
			},
			[
				{
					...counts,
					usedModel: "openai/gpt-fine",
					requestCount: 50,
					upstreamErrorCount: 10,
				},
				{
					...counts,
					usedModel: "openai/gpt-broken",
					requestCount: 50,
					upstreamErrorCount: 50,
				},
			],
		);
		expect(message).toContain("60.0% of 100 requests failed in the last 15m");
		expect(message).toContain("retried attempts excluded");
		expect(message).toContain(
			"Models affected: openai/gpt-broken 100% (50/50), openai/gpt-fine 20% (10/50).",
		);
	});
});

describe("processProviderKeyAlerts", () => {
	beforeEach(async () => {
		await db.delete(tables.organizationAlertDelivery);
		await db.delete(tables.organizationNotificationChannel);
		await db.delete(tables.organizationAlert);
		await db.delete(tables.notification);
		await db.delete(tables.notificationPreference);
		await db.delete(tables.providerKeyHourlyStats);
		await db.delete(tables.log);
		await db.delete(tables.providerKey);
		await db.delete(tables.project);
		await db.delete(tables.userOrganization);
		await db.delete(tables.organization);
		await db.delete(tables.user);
		await redisClient.del(
			cooldownKey(ORG, shortRule.id, KEY),
			cooldownKey(ORG, shortRule.id, PLATFORM),
		);

		await db.insert(tables.user).values([
			{ id: "pka-owner", email: "owner@example.com", emailVerified: true },
			{ id: "pka-dev", email: "developer@example.com", emailVerified: true },
		]);
		await db.insert(tables.organization).values({
			id: ORG,
			name: "Test Organization",
			billingEmail: "owner@example.com",
			providerKeyAlertSettings: settings,
		});
		await db.insert(tables.userOrganization).values([
			{ userId: "pka-owner", organizationId: ORG, role: "owner" },
			{ userId: "pka-dev", organizationId: ORG, role: "developer" },
		]);
		await db.insert(tables.project).values({
			id: "pka-project",
			organizationId: ORG,
			name: "Test Project",
		});
		await db.insert(tables.providerKey).values([
			{
				id: KEY,
				organizationId: ORG,
				provider: "openai",
				description: "Team key",
				tokenCiphertext: "x",
				tokenMasked: "sk-••••",
				tokenHash: "h",
			},
			{
				id: MANAGED_KEY,
				managed: true,
				provider: "anthropic",
				tokenCiphertext: "x",
				tokenMasked: "sk-••••",
				tokenHash: "h2",
			},
		]);
		const hour = new Date();
		hour.setUTCMinutes(0, 0, 0);
		await db.insert(tables.providerKeyHourlyStats).values([
			{
				providerKeyId: KEY,
				projectId: "pka-project",
				hourTimestamp: hour,
				requestCount: 40,
				errorCount: 30,
				clientErrorCount: 10,
				gatewayErrorCount: 20,
			},
			// The platform credential fails for this org's credit traffic too.
			{
				providerKeyId: MANAGED_KEY,
				projectId: "pka-project",
				hourTimestamp: hour,
				requestCount: 20,
				errorCount: 15,
				upstreamErrorCount: 15,
			},
		]);
	});

	async function alertTitles() {
		const alerts = await db.query.organizationAlert.findMany({
			where: { organizationId: ORG },
			orderBy: { title: "asc" },
		});
		return alerts.map((alert) => alert.title);
	}

	it("alerts owners and admins once per cooldown", async () => {
		await processProviderKeyAlerts();
		await processProviderKeyAlerts();

		const alerts = await db.query.organizationAlert.findMany({
			where: { organizationId: ORG },
		});
		expect(alerts).toHaveLength(1);
		expect(alerts[0].type).toBe("provider_key_errors");
		expect(alerts[0].title).toBe(
			"OpenAI key Team key is failing your requests",
		);
		// 10 client + 20 gateway errors over 40 requests.
		expect(alerts[0].message).toContain("75.0% of 40 requests");
		expect(alerts[0].href).toBe(`/dashboard/${ORG}/org/provider-keys`);

		const notifications = await db.query.notification.findMany({
			where: { organizationId: ORG },
		});
		expect(notifications.map((n) => n.userId)).toEqual(["pka-owner"]);
		expect(notifications[0]).toMatchObject({ inApp: true, email: true });
	});

	it("does not raise a second alert when a pass retries inside the cooldown", async () => {
		await processProviderKeyAlerts();
		// A failed fan-out releases the cooldown; the retry must dedupe.
		await redisClient.del(cooldownKey(ORG, shortRule.id, KEY));
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(1);
	});

	it("drops Slack delivery without enterprise access", async () => {
		await db.update(tables.organization).set({
			providerKeyAlertSettings: { ...settings, channels: ["slack"] },
		});
		await db.insert(tables.organizationNotificationChannel).values({
			id: "pka-slack",
			organizationId: ORG,
			kind: "slack",
			config: "unused",
		});
		await processProviderKeyAlerts();
		expect(await db.query.organizationAlertDelivery.findMany()).toHaveLength(0);
	});

	it("judges platform credentials per provider when selected", async () => {
		await db.update(tables.organization).set({
			providerKeyAlertSettings: { ...settings, keySource: "platform" },
		});
		await processProviderKeyAlerts();
		expect(await alertTitles()).toEqual([
			"LLM Gateway's Anthropic credentials are failing your requests",
		]);
		const [alert] = await db.query.organizationAlert.findMany({
			where: { organizationId: ORG },
		});
		expect(alert.message).toContain("75.0% of 20 credit requests");
		expect(alert.href).toBe("/providers/anthropic");
	});

	it("judges both kinds when the source is any", async () => {
		await db.update(tables.organization).set({
			providerKeyAlertSettings: { ...settings, keySource: "any" },
		});
		await processProviderKeyAlerts();
		expect(await alertTitles()).toEqual([
			"LLM Gateway's Anthropic credentials are failing your requests",
			"OpenAI key Team key is failing your requests",
		]);
	});

	it("does nothing while the alerts are off", async () => {
		await db.update(tables.organization).set({
			providerKeyAlertSettings: { ...settings, enabled: false },
		});
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(0);
	});

	it("ignores platform credentials and inactive keys for the byok source", async () => {
		await db.update(tables.providerKey).set({ status: "inactive" });
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(0);
	});

	it("stays quiet when the failures were retried elsewhere", async () => {
		await db
			.update(tables.providerKeyHourlyStats)
			.set({ clientErrorCount: 0, retriedGatewayErrorCount: 20 });
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(0);
	});

	it("skips keys below the threshold", async () => {
		await db
			.update(tables.providerKeyHourlyStats)
			.set({ clientErrorCount: 0, gatewayErrorCount: 10 });
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(0);
	});
});
