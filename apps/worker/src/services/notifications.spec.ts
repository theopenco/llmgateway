import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import {
	buildUnsubscribeHeaders,
	buildUnsubscribeUrl,
	signUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import {
	deliverNotificationEmails,
	isNearBudget,
	processNotifications,
} from "./notifications.js";

const send = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({ emails: { send } }),
	fromEmail: "alerts@example.com",
	replyToEmail: "support@example.com",
}));
const now = new Date();
const day = 86400000;
function minutesAgo(minutes: number) {
	const offset = minutes * 60000;
	return new Date(now.getTime() - offset);
}
function daysFromNow(days: number) {
	const offset = days * day;
	return new Date(now.getTime() + offset);
}

beforeEach(async () => {
	await db.delete(tables.notification);
	await db.delete(tables.notificationPreference);
	await db.delete(tables.emailUnsubscribe);
	await db.delete(tables.apiKeyHourlyModelStats);
	await db.delete(tables.modelProviderMappingHistory);
	await db.delete(tables.project);
	await db.delete(tables.userOrganization);
	await db.delete(tables.organization);
	await db.delete(tables.user);
	await db.delete(tables.modelProviderMapping);
	await db.delete(tables.model);
	await db.delete(tables.provider);
	send.mockReset().mockResolvedValue({ error: null });
	await db.insert(tables.user).values([
		{ id: "alert-owner", email: "owner@example.com", emailVerified: true },
		{
			id: "alert-developer",
			email: "developer@example.com",
			emailVerified: true,
		},
	]);
	await db.insert(tables.organization).values({
		id: "alert-org",
		name: "Test Organization",
		billingEmail: "owner@example.com",
	});
	await db.insert(tables.userOrganization).values([
		{
			id: "alert-owner-member",
			userId: "alert-owner",
			organizationId: "alert-org",
			role: "owner",
		},
		{
			id: "alert-developer-member",
			userId: "alert-developer",
			organizationId: "alert-org",
			role: "developer",
		},
	]);
	await db.insert(tables.project).values({
		id: "alert-project",
		organizationId: "alert-org",
		name: "Test Project",
	});
	await db.insert(tables.userProject).values({
		userOrganizationId: "alert-developer-member",
		projectId: "alert-project",
	});
	await db.insert(tables.apiKey).values({
		id: "alert-key",
		...hashApiKeyForStorage("test-token"),
		description: "Test key",
		projectId: "alert-project",
		createdBy: "alert-owner",
		usage: "81",
		usageLimit: "100",
	});
});

async function enable(
	type: (typeof tables.notificationTypes)[number],
	userId = "alert-owner",
	email = false,
) {
	await db
		.insert(tables.notificationPreference)
		.values({ userId, type, inApp: true, email });
}

async function insertHistory(
	mappingId: string,
	modelId: string,
	counts: Partial<typeof tables.modelProviderMappingHistory.$inferInsert> = {},
) {
	await db.insert(tables.modelProviderMappingHistory).values({
		modelProviderMappingId: mappingId,
		modelId,
		providerId: "test-provider",
		usedMode: "credits",
		minuteTimestamp: minutesAgo(2),
		logsCount: 100,
		...counts,
	});
}

async function insertUsage() {
	await db.insert(tables.provider).values({
		id: "test-provider",
		name: "Test provider",
		description: "Test provider",
	});
	await db.insert(tables.model).values({ id: "test-model", family: "test" });
	await db.insert(tables.modelProviderMapping).values({
		id: "test-mapping",
		modelId: "test-model",
		providerId: "test-provider",
		externalId: "test-model",
		deactivatedAt: daysFromNow(7),
	});
	await insertHistory("test-mapping", "test-model", {
		upstreamErrorsCount: 30,
	});
	await db.insert(tables.apiKeyHourlyModelStats).values({
		projectId: "alert-project",
		apiKeyId: "alert-key",
		usedModel: "test-provider/test-model",
		usedProvider: "test-provider",
		hourTimestamp: new Date(now.getTime() - 3600000),
		requestCount: 10,
	});
}

describe("usage notifications", () => {
	it("compares exact thresholds and ignores unlimited and zero budgets", () => {
		expect(isNearBudget("79.999", "100", 80)).toBe(false);
		expect(isNearBudget("80", "100", 80)).toBe(true);
		expect(isNearBudget("81", null, 80)).toBe(false);
		expect(isNearBudget("81", "0", 80)).toBe(false);
	});
	it("requires opt-in and deduplicates concurrent budget scans", async () => {
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await enable("budget");
		await Promise.all([processNotifications(now), processNotifications(now)]);
		expect(await db.query.notification.findMany()).toHaveLength(1);
		expect(send).not.toHaveBeenCalled();
	});
	it("ignores expired periods and warns again in a new active period", async () => {
		await enable("budget");
		await db.update(tables.apiKey).set({
			usageLimit: null,
			periodUsageLimit: "100",
			currentPeriodUsage: "90",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day",
			currentPeriodStartedAt: daysFromNow(-2),
		});
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db.update(tables.apiKey).set({ currentPeriodStartedAt: now });
		await processNotifications(now);
		await db
			.update(tables.apiKey)
			.set({ currentPeriodStartedAt: new Date(now.getTime() + day) });
		await processNotifications(new Date(now.getTime() + day));
		expect(await db.query.notification.findMany()).toHaveLength(2);
	});
	it("keeps another developer's keys and traffic private", async () => {
		await enable("budget", "alert-developer");
		await enable("model_retirement", "alert-developer");
		await enable("provider_issue", "alert-developer");
		await insertUsage();
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db.update(tables.apiKey).set({ createdBy: "alert-developer" });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(3);
	});
	it("targets recent usage and excludes distant retirements and stale health", async () => {
		await enable("model_retirement");
		await enable("provider_issue");
		await insertUsage();
		await processNotifications(now);
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(2);
		await db.delete(tables.notification);
		await db
			.update(tables.modelProviderMapping)
			.set({ deactivatedAt: daysFromNow(31) });
		// Errors older than the default 15m window no longer count.
		await db
			.update(tables.modelProviderMappingHistory)
			.set({ minuteTimestamp: minutesAgo(20) });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db
			.update(tables.modelProviderMapping)
			.set({ deactivatedAt: daysFromNow(7) });
		await db
			.update(tables.modelProviderMappingHistory)
			.set({ minuteTimestamp: minutesAgo(2) });
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ hourTimestamp: daysFromNow(-31) });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
	});
	it("matches the used mapping region when scheduling retirement alerts", async () => {
		await enable("model_retirement");
		await insertUsage();
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ usedModel: "test-provider/test-model:west" });
		await db.update(tables.modelProviderMapping).set({ region: "east" });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db.update(tables.modelProviderMapping).set({ region: "west" });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(1);
	});

	it("names the failing model and skips healthy models on the same provider", async () => {
		await enable("provider_issue", "alert-owner", true);
		await insertUsage();
		await db.insert(tables.model).values({ id: "other-model", family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: "other-mapping",
			modelId: "other-model",
			providerId: "test-provider",
			externalId: "other-model",
		});
		await insertHistory("other-mapping", "other-model");
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "alert-project",
			apiKeyId: "alert-key",
			usedModel: "test-provider/other-model",
			usedProvider: "test-provider",
			hourTimestamp: new Date(now.getTime() - 3600000),
			requestCount: 10,
		});
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toMatchObject([
			{
				title: "test-model on Test provider is experiencing errors",
				href: "/models/test-model/test-provider",
			},
		]);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].text).toContain(
			'30% of requests to test-provider/test-model failed over the last 15m (30 of 100). Project "Test Project" used it in the last 4h.',
		);
	});
	it("skips provider issues for mappings not used within the usage window", async () => {
		await enable("provider_issue");
		await insertUsage();
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ hourTimestamp: minutesAgo(6 * 60) });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		// The bucket started over 4h ago, but it ends inside the window.
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ hourTimestamp: minutesAgo(4.5 * 60) });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(1);
		await db.delete(tables.notification);
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ hourTimestamp: minutesAgo(6 * 60) });
		await db.update(tables.notificationPreference).set({ issueUsageHours: 24 });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(1);
	});
	it("applies the user's error window and threshold", async () => {
		await enable("provider_issue");
		await insertUsage();
		await db
			.update(tables.notificationPreference)
			.set({ issueErrorRatePercent: 50 });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db.update(tables.notificationPreference).set({
			issueErrorRatePercent: 20,
			issueWindowMinutes: 5,
		});
		await db
			.update(tables.modelProviderMappingHistory)
			.set({ minuteTimestamp: minutesAgo(10) });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db
			.update(tables.notificationPreference)
			.set({ issueWindowMinutes: 15 });
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(1);
	});
	it("ignores errors retried elsewhere, client errors and tiny samples", async () => {
		await enable("provider_issue");
		await insertUsage();
		await db
			.update(tables.modelProviderMappingHistory)
			.set({ retriedUpstreamErrorsCount: 30 });
		await processNotifications(now);
		await db.update(tables.modelProviderMappingHistory).set({
			retriedUpstreamErrorsCount: 0,
			upstreamErrorsCount: 0,
			clientErrorsCount: 50,
		});
		await processNotifications(now);
		await db.update(tables.modelProviderMappingHistory).set({
			logsCount: 10,
			clientErrorsCount: 0,
			upstreamErrorsCount: 10,
		});
		await processNotifications(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
	});
	it("retries failed email with the same idempotency key and checks current access", async () => {
		await enable("budget", "alert-owner", true);
		send.mockResolvedValueOnce({ error: { message: "Temporary failure" } });
		await processNotifications(now);
		expect((await db.query.notification.findFirst())?.emailSentAt).toBeNull();
		await deliverNotificationEmails(now);
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[0][1]).toEqual(send.mock.calls[1][1]);
		expect(
			(await db.query.notification.findFirst())?.emailSentAt,
		).not.toBeNull();
		await db.update(tables.notification).set({ emailSentAt: null });
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.userId, "alert-owner"));
		await deliverNotificationEmails(now);
		expect(send).toHaveBeenCalledTimes(2);
	});
	it("carries one-click unsubscribe headers and an unsubscribe footer", async () => {
		await enable("budget", "alert-owner", true);
		await processNotifications(now);
		expect(send).toHaveBeenCalledTimes(1);
		const payload = send.mock.calls[0][0];
		const token = signUnsubscribeToken({
			email: "owner@example.com",
			category: "budget",
		});
		expect(payload.headers).toEqual(buildUnsubscribeHeaders(token));
		expect(payload.text).toContain(buildUnsubscribeUrl(token));
		expect(payload.text).toContain("/dashboard/alert-org/org/notifications");
	});
	it("groups events detected together into one email per category", async () => {
		await enable("model_retirement", "alert-owner", true);
		await enable("budget", "alert-owner", true);
		await insertUsage();
		await db.insert(tables.model).values({ id: "other-model", family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: "other-mapping",
			modelId: "other-model",
			providerId: "test-provider",
			externalId: "other-model",
			deactivatedAt: daysFromNow(7),
		});
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "alert-project",
			apiKeyId: "alert-key",
			usedModel: "test-provider/other-model",
			usedProvider: "test-provider",
			hourTimestamp: new Date(now.getTime() - 3600000),
			requestCount: 10,
		});
		await processNotifications(now);
		expect(send).toHaveBeenCalledTimes(2);
		const retirement = send.mock.calls
			.map((call) => call[0])
			.find((payload) => payload.subject.startsWith("Model deactivation"));
		expect(retirement.subject).toBe("Model deactivation approaching (2)");
		expect(retirement.text).toContain("test-provider/test-model");
		expect(retirement.text).toContain("test-provider/other-model");
		expect(
			(await db.query.notification.findMany()).every((n) => n.emailSentAt),
		).toBe(true);
		await deliverNotificationEmails(now);
		expect(send).toHaveBeenCalledTimes(2);
	});
	it("stops emailing an address that used the one-click link, permanently", async () => {
		await enable("budget", "alert-owner", true);
		await db.insert(tables.emailUnsubscribe).values({
			email: "owner@example.com",
			category: "budget",
			source: "one_click",
		});
		await processNotifications(now);
		expect(send).not.toHaveBeenCalled();
		// Terminal: the row leaves the pending queue instead of blocking it for
		// the full retry window.
		expect((await db.query.notification.findFirst())?.email).toBe(false);
	});
	it("keeps emailing when the suppression is for another category", async () => {
		await enable("budget", "alert-owner", true);
		await db.insert(tables.emailUnsubscribe).values({
			email: "owner@example.com",
			category: "marketing",
			source: "one_click",
		});
		await processNotifications(now);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("does not email unverified users or users who opted out", async () => {
		await enable("budget", "alert-owner", true);
		await db.update(tables.user).set({ emailVerified: false });
		await processNotifications(now);
		expect(send).not.toHaveBeenCalled();
		await db.update(tables.user).set({ emailVerified: true });
		await db.update(tables.notificationPreference).set({ email: false });
		await deliverNotificationEmails(now);
		expect(send).not.toHaveBeenCalled();
	});
	it("emails organization limit alerts to admins without compliance settings", async () => {
		await db.insert(tables.notification).values(
			["alert-owner", "alert-developer"].map((userId) => ({
				userId,
				organizationId: "alert-org",
				type: "org_limit" as const,
				eventKey: "alert-org:org_limit:api_keys:2026-09-30",
				title: "API key limit reached",
				message: "Revoke unused keys or contact us.",
				href: "/dashboard/alert-org/alert-project/api-keys",
				inApp: true,
				email: true,
			})),
		);
		await deliverNotificationEmails(now);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].to).toBe("owner@example.com");
		// A developer outside the audience is skipped for good.
		expect(
			await db.query.notification.findFirst({
				where: { userId: "alert-developer" },
			}),
		).toMatchObject({ email: false, emailSentAt: null });
	});
});
