import { beforeEach, describe, expect, it } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { DEFAULT_PROVIDER_KEY_ALERT_RULES } from "@llmgateway/shared/provider-key-alerts";

import {
	alertEventKey,
	buildAlertMessage,
	cooldownKey,
	findKeysOverThreshold,
	processProviderKeyAlerts,
	windowBucketStart,
} from "./provider-key-alerts.js";

import type { ProviderKeyAlertSettings } from "@llmgateway/shared/provider-key-alerts";

const ORG = "pka-org";
const KEY = "pka-key";
const [shortRule, longRule] = DEFAULT_PROVIDER_KEY_ALERT_RULES;

const counts = {
	providerKeyId: KEY,
	requestCount: 100,
	clientErrorCount: 0,
	gatewayErrorCount: 0,
	upstreamErrorCount: 0,
};

const settings: ProviderKeyAlertSettings = {
	enabled: true,
	inApp: true,
	email: true,
	channels: [],
	rules: [shortRule],
};

describe("findKeysOverThreshold", () => {
	it("flags keys at or above the threshold with enough traffic", () => {
		const hits = findKeysOverThreshold(shortRule, [
			{ ...counts, providerKeyId: "at", upstreamErrorCount: 50 },
			{ ...counts, providerKeyId: "below", upstreamErrorCount: 49 },
			{ ...counts, providerKeyId: "worse", gatewayErrorCount: 80 },
		]);
		expect(hits.map((hit) => hit.providerKeyId)).toEqual(["worse", "at"]);
		expect(hits[1].errorRate).toBe(50);
	});

	it("excludes client errors and skips low-traffic keys", () => {
		const hits = findKeysOverThreshold(shortRule, [
			// 20 non-client requests, 12 errors = 60%.
			{
				...counts,
				providerKeyId: "client-heavy",
				clientErrorCount: 80,
				upstreamErrorCount: 12,
			},
			// 9 requests is below minRequests (10).
			{
				...counts,
				providerKeyId: "tiny",
				requestCount: 9,
				gatewayErrorCount: 9,
			},
		]);
		expect(hits.map((hit) => hit.providerKeyId)).toEqual(["client-heavy"]);
		expect(hits[0].errorRate).toBe(60);
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
			{
				...counts,
				upstreamErrorCount: 60,
				judgedCount: 100,
				errorsCount: 60,
				errorRate: 60,
			},
			[
				{
					usedModel: "openai/gpt-fine",
					requestCount: 50,
					clientErrorCount: 0,
					gatewayErrorCount: 0,
					upstreamErrorCount: 10,
				},
				{
					usedModel: "openai/gpt-broken",
					requestCount: 50,
					clientErrorCount: 0,
					gatewayErrorCount: 0,
					upstreamErrorCount: 50,
				},
			],
		);
		expect(message).toContain("60.0% of 100 requests failed in the last 15m");
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
		await redisClient.del(cooldownKey(ORG, shortRule.id, KEY));

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
		await db.insert(tables.providerKey).values({
			id: KEY,
			organizationId: ORG,
			provider: "openai",
			description: "Team key",
			tokenCiphertext: "x",
			tokenMasked: "sk-••••",
			tokenHash: "h",
		});
		const hour = new Date();
		hour.setUTCMinutes(0, 0, 0);
		await db.insert(tables.providerKeyHourlyStats).values({
			providerKeyId: KEY,
			projectId: "pka-project",
			hourTimestamp: hour,
			requestCount: 40,
			errorCount: 30,
			clientErrorCount: 10,
			gatewayErrorCount: 20,
		});
	});

	it("alerts owners and admins once per cooldown", async () => {
		await processProviderKeyAlerts();
		await processProviderKeyAlerts();

		const alerts = await db.query.organizationAlert.findMany({
			where: { organizationId: ORG },
		});
		expect(alerts).toHaveLength(1);
		expect(alerts[0].type).toBe("provider_key_errors");
		expect(alerts[0].title).toBe("OpenAI key Team key is failing requests");
		// 20 gateway errors over 30 non-client requests.
		expect(alerts[0].message).toContain("66.7% of 30 requests");
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

	it("ignores platform-managed credentials and inactive keys", async () => {
		await db.update(tables.providerKey).set({ status: "inactive" });
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
			.set({ gatewayErrorCount: 10 });
		await processProviderKeyAlerts();
		expect(
			await db.query.organizationAlert.findMany({
				where: { organizationId: ORG },
			}),
		).toHaveLength(0);
	});
});
