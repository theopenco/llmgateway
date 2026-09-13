import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import {
	deliverNotificationEmails,
	isNearBudget,
	processNotifications,
	providerHasIssues,
} from "./notifications.js";

const send = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({ emails: { send } }),
	fromEmail: "alerts@example.com",
	replyToEmail: "support@example.com",
}));
const now = new Date();
const day = 86400000;
function daysFromNow(days: number) {
	const offset = days * day;
	return new Date(now.getTime() + offset);
}

beforeEach(async () => {
	await db.delete(tables.notification);
	await db.delete(tables.notificationPreference);
	await db.delete(tables.apiKeyHourlyModelStats);
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

async function insertUsage() {
	await db.insert(tables.provider).values({
		id: "test-provider",
		name: "Test provider",
		description: "Test provider",
		logsCount: 100,
		upstreamErrorsCount: 30,
		statsUpdatedAt: now,
	});
	await db.insert(tables.model).values({ id: "test-model", family: "test" });
	await db.insert(tables.modelProviderMapping).values({
		id: "test-mapping",
		modelId: "test-model",
		providerId: "test-provider",
		externalId: "test-model",
		deactivatedAt: daysFromNow(7),
	});
	await db.insert(tables.apiKeyHourlyModelStats).values({
		projectId: "alert-project",
		apiKeyId: "alert-key",
		usedModel: "test-model",
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
		await db
			.update(tables.provider)
			.set({ statsUpdatedAt: new Date(now.getTime() - day) });
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
	it("does not treat client errors or tiny samples as provider incidents", () => {
		const healthy = {
			logsCount: 100,
			cachedCount: 0,
			upstreamErrorsCount: 0,
			clientErrorsCount: 50,
			statsUpdatedAt: now,
		};
		expect(providerHasIssues(healthy, now)).toBe(false);
		expect(
			providerHasIssues(
				{
					...healthy,
					logsCount: 10,
					clientErrorsCount: 0,
					upstreamErrorsCount: 10,
				},
				now,
			),
		).toBe(false);
		expect(
			providerHasIssues({ ...healthy, upstreamErrorsCount: 20 }, now),
		).toBe(true);
	});
});
