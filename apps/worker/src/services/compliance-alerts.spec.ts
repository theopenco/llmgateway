import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	encryptNotificationChannelConfig,
	hashCompliancePolicy,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

import {
	deliverOrgAlertChannels,
	processComplianceAlerts,
} from "./compliance-alerts.js";
import { deliverNotificationEmails } from "./notifications.js";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const send = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({ emails: { send } }),
	fromEmail: "alerts@example.com",
	replyToEmail: "support@example.com",
}));

const ORG = "compliance-alert-org";
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/abcdef123456";
const policy: ProviderCompliancePolicy = {
	enabled: true,
	allowedCountries: ["US"],
};

async function addMapping(modelId: string, providerId: string) {
	await db.insert(tables.modelProviderMapping).values({
		modelId,
		providerId,
		externalId: modelId,
		status: "active",
	});
}

beforeEach(async () => {
	await db.delete(tables.organizationAlert);
	await db.delete(tables.notification);
	await db.delete(tables.notificationPreference);
	await db.delete(tables.projectHourlyModelStats);
	await db.delete(tables.project);
	await db.delete(tables.userOrganization);
	await db.delete(tables.organization);
	await db.delete(tables.user);
	await db.delete(tables.modelProviderMapping);
	await db.delete(tables.model);
	await db.delete(tables.provider);
	send.mockReset().mockResolvedValue({ error: null });

	await db.insert(tables.user).values([
		{ id: "ca-owner", email: "owner@example.com", emailVerified: true },
		{ id: "ca-dev", email: "developer@example.com", emailVerified: true },
	]);
	await db.insert(tables.organization).values({
		id: ORG,
		name: "Test Organization",
		billingEmail: "owner@example.com",
		plan: "enterprise",
		providerCompliancePolicy: policy,
		complianceAlertSettings: {
			inApp: true,
			email: true,
			channels: ["slack"],
			downgrades: true,
		},
	});
	await db.insert(tables.userOrganization).values([
		{ userId: "ca-owner", organizationId: ORG, role: "owner" },
		{ userId: "ca-dev", organizationId: ORG, role: "developer" },
	]);
	await db
		.insert(tables.complianceAlertRecipient)
		.values({ organizationId: ORG, userId: "ca-owner" });
	await db.insert(tables.project).values({
		id: "ca-project",
		organizationId: ORG,
		name: "Test Project",
	});
	await db.insert(tables.provider).values(
		["deepseek", "openai"].map((id) => ({
			id,
			name: id,
			description: id,
			streaming: true,
			cancellation: true,
			color: "#000000",
			website: "https://example.com",
		})),
	);
	await db.insert(tables.model).values(
		["watched-model", "used-model"].map((id) => ({
			id,
			name: id,
			family: "test",
		})),
	);
	await addMapping("watched-model", "deepseek");
	await addMapping("used-model", "deepseek");
	const channelId = "ca-slack";
	await db.insert(tables.organizationNotificationChannel).values({
		id: channelId,
		organizationId: ORG,
		kind: "slack",
		config: encryptNotificationChannelConfig(SLACK_URL, channelId, ORG),
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("processComplianceAlerts", () => {
	it("notifies once when a watched model becomes available", async () => {
		await db.insert(tables.modelAvailabilityWatch).values({
			organizationId: ORG,
			modelId: "watched-model",
		});
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => new Response("ok"));

		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(0);

		await addMapping("watched-model", "openai");
		await processComplianceAlerts();
		await processComplianceAlerts();

		const alerts = await db.query.organizationAlert.findMany();
		expect(alerts).toHaveLength(1);
		expect(alerts[0].type).toBe("model_available");
		expect(alerts[0].message).toContain("OpenAI");
		const notifications = await db.query.notification.findMany();
		expect(notifications.map((n) => n.userId)).toEqual(["ca-owner"]);
		expect(notifications[0].organizationId).toBe(ORG);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0][0])).toBe(SLACK_URL);
		const [delivery] = await db.query.organizationAlertDelivery.findMany();
		expect(delivery.sentAt).not.toBeNull();

		const [watch] = await db.query.modelAvailabilityWatch.findMany();
		expect(watch.availableAt).not.toBeNull();
	});

	it("seeds provider state silently and alerts on a provider downgrade", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		await db.insert(tables.projectHourlyModelStats).values({
			projectId: "ca-project",
			hourTimestamp: new Date(Date.now() - 7_200_000),
			usedModel: "deepseek/used-model",
			usedProvider: "deepseek",
			requestCount: 5,
		});

		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(0);
		const states = await db.query.complianceProviderState.findMany({
			where: { organizationId: ORG },
		});
		expect(states.length).toBeGreaterThan(0);

		// Simulate DeepSeek having been compliant under the unchanged policy.
		await db
			.update(tables.complianceProviderState)
			.set({ compliant: true, failures: [] })
			.where(eq(tables.complianceProviderState.providerId, "deepseek"));
		await processComplianceAlerts();

		const alerts = await db.query.organizationAlert.findMany();
		expect(alerts).toHaveLength(1);
		expect(alerts[0].type).toBe("compliance_downgrade");
		expect(alerts[0].title).toContain("DeepSeek");
		expect(alerts[0].message).toContain("used-model");
	});

	it("stays silent when the org edits its own policy", async () => {
		await processComplianceAlerts();
		await db
			.update(tables.complianceProviderState)
			.set({ compliant: true, failures: [], policyHash: "stale" })
			.where(eq(tables.complianceProviderState.providerId, "deepseek"));
		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(0);
		const [state] = await db.query.complianceProviderState.findMany({
			where: { providerId: "deepseek" },
		});
		expect(state.policyHash).toBe(hashCompliancePolicy(policy));
		expect(state.compliant).toBe(false);
	});

	it("ignores stale state rows for providers removed from the catalogue", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		await processComplianceAlerts();
		await db.insert(tables.complianceProviderState).values({
			organizationId: ORG,
			providerId: "removed-provider",
			compliant: true,
			failures: [],
			policyHash: "stale",
		});
		await db
			.update(tables.complianceProviderState)
			.set({ compliant: true, failures: [] })
			.where(eq(tables.complianceProviderState.providerId, "deepseek"));
		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(1);
	});

	it("completes a fan-out interrupted after the alert row was written", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		const [watch] = await db
			.insert(tables.modelAvailabilityWatch)
			.values({ organizationId: ORG, modelId: "watched-model" })
			.returning();
		await db.insert(tables.organizationAlert).values({
			organizationId: ORG,
			type: "model_available",
			eventKey: `${ORG}:model_available:${watch.id}:${watch.armedAt.getTime()}`,
			title: "partial",
			message: "partial",
			href: "/",
		});
		await addMapping("watched-model", "openai");
		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(1);
		expect(await db.query.notification.findMany()).toHaveLength(1);
		expect(
			(await db.query.organizationAlertDelivery.findMany())[0].sentAt,
		).not.toBeNull();
	});

	it("skips organizations without an enterprise plan", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG));
		await db.insert(tables.modelAvailabilityWatch).values({
			organizationId: ORG,
			modelId: "watched-model",
		});
		await addMapping("watched-model", "openai");
		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(0);
	});

	it("skips downgrade alerts when disabled", async () => {
		await db
			.update(tables.organization)
			.set({
				complianceAlertSettings: {
					inApp: true,
					email: true,
					channels: [],
					downgrades: false,
				},
			})
			.where(eq(tables.organization.id, ORG));
		await processComplianceAlerts();
		await db
			.update(tables.complianceProviderState)
			.set({ compliant: true, failures: [] })
			.where(eq(tables.complianceProviderState.providerId, "deepseek"));
		await processComplianceAlerts();
		expect(await db.query.organizationAlert.findMany()).toHaveLength(0);
	});
});

describe("delivery", () => {
	async function emitAvailability() {
		await db.insert(tables.modelAvailabilityWatch).values({
			organizationId: ORG,
			modelId: "watched-model",
		});
		await addMapping("watched-model", "openai");
		await processComplianceAlerts();
	}

	it("retries failed Slack deliveries and records the error", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("invalid_token", { status: 403 }),
		);
		await emitAvailability();
		await deliverOrgAlertChannels();
		const [delivery] = await db.query.organizationAlertDelivery.findMany();
		expect(delivery.sentAt).toBeNull();
		expect(delivery.attempts).toBe(2);
		expect(delivery.lastError).toContain("403");
	});

	it("emails current recipients", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		await emitAvailability();
		await deliverNotificationEmails();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].to).toBe("owner@example.com");
	});

	it("does not email a recipient removed before delivery", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		await emitAvailability();
		await db
			.delete(tables.complianceAlertRecipient)
			.where(eq(tables.complianceAlertRecipient.userId, "ca-owner"));
		await deliverNotificationEmails();
		expect(send).not.toHaveBeenCalled();
		const [item] = await db.query.notification.findMany();
		expect(item.email).toBe(false);
	});

	it("respects a recipient's email opt-out", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("ok"),
		);
		await db.insert(tables.notificationPreference).values({
			userId: "ca-owner",
			type: "model_available",
			inApp: true,
			email: false,
		});
		await emitAvailability();
		const [item] = await db.query.notification.findMany();
		expect(item.inApp).toBe(true);
		expect(item.email).toBe(false);
		await deliverNotificationEmails();
		expect(send).not.toHaveBeenCalled();
	});
});
