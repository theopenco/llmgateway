import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const organizationId = "compliance-alerts-org";
const slackUrl = "https://hooks.slack.com/services/T000/B000/abcdef123456";

describe("compliance alerts", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: organizationId,
			name: "Compliance Alerts Test",
			plan: "enterprise",
			billingEmail: "billing@example.com",
			providerCompliancePolicy: { enabled: true, allowedCountries: ["US"] },
		});
		await db.insert(tables.userOrganization).values({
			organizationId,
			userId: "test-user-id",
			role: "owner",
		});
		await db.delete(tables.modelProviderMapping);
		await db
			.insert(tables.model)
			.values(
				["blocked-model", "open-model", "retired-model"].map((id) => ({
					id,
					name: id,
					family: "test",
				})),
			)
			.onConflictDoNothing();
		await db
			.insert(tables.provider)
			.values(
				["deepseek", "openai"].map((id) => ({
					id,
					name: id,
					description: id,
					streaming: true,
					cancellation: true,
					color: "#000000",
					website: "https://example.com",
				})),
			)
			.onConflictDoNothing();
		await db.insert(tables.modelProviderMapping).values([
			{ modelId: "blocked-model", providerId: "deepseek", externalId: "b" },
			{ modelId: "open-model", providerId: "openai", externalId: "o" },
			{
				modelId: "retired-model",
				providerId: "openai",
				externalId: "r",
				deactivatedAt: new Date("2020-01-01"),
			},
		]);
	});
	afterEach(async () => {
		await db.delete(tables.modelProviderMapping);
		await db.delete(tables.model);
		await db.delete(tables.provider);
		await deleteAll();
	});

	function request(path: string, method = "GET", body?: unknown) {
		return app.request(`/orgs/${organizationId}${path}`, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	test("stamps already-available models so they never alert", async () => {
		const res = await request("/compliance-alerts/watches", "POST", {
			modelIds: ["blocked-model", "open-model"],
		});
		expect(res.status).toBe(200);
		const { watches } = await (await request("/compliance-alerts")).json();
		const byModel = Object.fromEntries(
			watches.map((w: { modelId: string }) => [w.modelId, w]),
		);
		expect(byModel["blocked-model"]).toMatchObject({
			availableAt: null,
			compliantProviders: [],
		});
		expect(byModel["open-model"].availableAt).not.toBeNull();
		expect(byModel["open-model"].compliantProviders).toEqual(["openai"]);
	});

	test("the first watch saves default settings with admin recipients", async () => {
		await request("/compliance-alerts/watches", "POST", {
			modelIds: ["blocked-model"],
		});
		const body = await (await request("/compliance-alerts")).json();
		expect(body.settings).toEqual({
			inApp: true,
			email: true,
			channels: [],
			downgrades: true,
			recipientAudience: "admin",
		});
		expect(body.recipientCount).toBe(1);
	});

	test("configures defaults even when every model is already watched", async () => {
		await request("/compliance-alerts/watches", "POST", {
			modelIds: ["blocked-model"],
		});
		await db
			.update(tables.organization)
			.set({ complianceAlertSettings: null })
			.where(eq(tables.organization.id, organizationId));
		await request("/compliance-alerts/watches", "POST", {
			modelIds: ["blocked-model"],
		});
		const body = await (await request("/compliance-alerts")).json();
		expect(body.settings?.recipientAudience).toBe("admin");
	});

	test("counts only active members in the audience", async () => {
		await db.insert(tables.user).values({
			id: "inactive-admin",
			email: "inactive@example.com",
			status: "deactivated",
		});
		await db.insert(tables.userOrganization).values({
			organizationId,
			userId: "inactive-admin",
			role: "admin",
		});
		await request("/compliance-alerts/watches", "POST", {
			modelIds: ["blocked-model"],
		});
		const body = await (await request("/compliance-alerts")).json();
		expect(body.recipientCount).toBe(1);
	});

	test("rejects unknown models", async () => {
		const res = await request("/compliance-alerts/watches", "POST", {
			modelIds: ["does-not-exist"],
		});
		expect(res.status).toBe(400);
	});

	test("rejects models whose every mapping is retired", async () => {
		const res = await request("/compliance-alerts/watches", "POST", {
			modelIds: ["retired-model"],
		});
		expect(res.status).toBe(400);
		expect((await res.json()).message).toContain("retired-model");
		expect(await db.query.modelAvailabilityWatch.findMany()).toHaveLength(0);
	});

	test("stores Slack webhooks encrypted and returns them masked", async () => {
		expect(
			(
				await request("/notification-channels/slack", "PUT", {
					webhookUrl: "https://example.com/hook",
				})
			).status,
		).toBe(400);
		const saved = await request("/notification-channels/slack", "PUT", {
			webhookUrl: slackUrl,
		});
		expect(saved.status).toBe(200);
		const [row] = await db.query.organizationNotificationChannel.findMany({
			where: { organizationId },
		});
		expect(row.config).not.toContain("hooks.slack.com");
		const { channels } = await (await request("/notification-channels")).json();
		expect(channels).toEqual([
			expect.objectContaining({ kind: "slack", target: expect.any(String) }),
		]);
		expect(channels[0].target).not.toContain("abcdef123456");
	});

	test("requires a configured channel before enabling it", async () => {
		const settings = {
			inApp: true,
			email: true,
			channels: ["slack"],
			downgrades: true,
			recipientAudience: "owner",
		};
		expect(
			(await request("/compliance-alerts/settings", "PUT", settings)).status,
		).toBe(400);
		await request("/notification-channels/slack", "PUT", {
			webhookUrl: slackUrl,
		});
		expect(
			(await request("/compliance-alerts/settings", "PUT", settings)).status,
		).toBe(200);
		const body = await (await request("/compliance-alerts")).json();
		expect(body.settings.channels).toEqual(["slack"]);
		expect(body.settings.recipientAudience).toBe("owner");
		expect(body.recipientCount).toBe(1);

		await request("/notification-channels/slack", "DELETE");
		const after = await (await request("/compliance-alerts")).json();
		expect(after.settings.channels).toEqual([]);
	});

	test("only owners and admins can manage alerts", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.organizationId, organizationId));
		expect((await request("/compliance-alerts")).status).toBe(200);
		expect(
			(
				await request("/compliance-alerts/watches", "POST", {
					modelIds: ["blocked-model"],
				})
			).status,
		).toBe(403);
		expect(
			(
				await request("/notification-channels/slack", "PUT", {
					webhookUrl: slackUrl,
				})
			).status,
		).toBe(403);
	});

	test("requires an enterprise plan to configure alerts", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, organizationId));
		expect(
			(
				await request("/compliance-alerts/watches", "POST", {
					modelIds: ["blocked-model"],
				})
			).status,
		).toBe(403);
	});

	test("shows org alerts in the bell only to the configured audience", async () => {
		await db.insert(tables.notification).values({
			userId: "test-user-id",
			organizationId,
			type: "model_available",
			eventKey: "model_available:test",
			title: "Model available",
			message: "Now available",
			href: `/dashboard/${organizationId}/org/compliance`,
			inApp: true,
			email: false,
		});
		const bell = async () =>
			(
				await (
					await app.request("/notifications", { headers: { Cookie: cookie } })
				).json()
			).notifications;
		expect(await bell()).toHaveLength(0);
		await db
			.update(tables.organization)
			.set({
				complianceAlertSettings: {
					inApp: true,
					email: true,
					channels: [],
					downgrades: true,
					recipientAudience: "admin",
				},
			})
			.where(eq(tables.organization.id, organizationId));
		expect(await bell()).toHaveLength(1);
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.organizationId, organizationId));
		expect(await bell()).toHaveLength(0);
	});
});
