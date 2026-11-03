import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import {
	describePriceChange,
	processModelPriceAlerts,
	usedModelIds,
} from "./model-price-alerts.js";
import { deliverNotificationEmails } from "./notifications.js";

const send = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({ emails: { send } }),
	fromEmail: "alerts@example.com",
	replyToEmail: "support@example.com",
}));

const now = new Date();
const twoHoursAgo = new Date(now.getTime() - 7200000);
const monthAgo = new Date(now.getTime() - 2678400000);

beforeEach(async () => {
	await db.delete(tables.notification);
	await db.delete(tables.notificationPreference);
	await db.delete(tables.apiKeyHourlyModelStats);
	await db.delete(tables.modelPriceState);
	await db.delete(tables.apiKey);
	await db.delete(tables.project);
	await db.delete(tables.userOrganization);
	await db.delete(tables.organization);
	await db.delete(tables.user);
	await db.delete(tables.modelProviderMapping);
	await db.delete(tables.model);
	await db.delete(tables.provider);
	send.mockReset().mockResolvedValue({ error: null });
	await db.insert(tables.user).values([
		{ id: "price-owner", email: "owner@example.com", emailVerified: true },
		{
			id: "price-developer",
			email: "developer@example.com",
			emailVerified: true,
		},
	]);
	await db.insert(tables.organization).values({
		id: "price-org",
		name: "Test Organization",
		billingEmail: "owner@example.com",
	});
	await db.insert(tables.userOrganization).values([
		{
			id: "price-owner-member",
			userId: "price-owner",
			organizationId: "price-org",
			role: "owner",
		},
		{
			id: "price-developer-member",
			userId: "price-developer",
			organizationId: "price-org",
			role: "developer",
		},
	]);
	await db.insert(tables.project).values({
		id: "price-project",
		organizationId: "price-org",
		name: "Test Project",
	});
	await db.insert(tables.userProject).values({
		userOrganizationId: "price-developer-member",
		projectId: "price-project",
	});
	await db.insert(tables.apiKey).values({
		id: "price-key",
		...hashApiKeyForStorage("price-token"),
		description: "Test key",
		projectId: "price-project",
		createdBy: "price-owner",
	});
	await db.insert(tables.provider).values({
		id: "price-provider",
		name: "Price Provider",
		description: "Test provider",
	});
	await db.insert(tables.model).values([
		{ id: "price-model-a", name: "Model A", family: "test" },
		{ id: "price-model-b", name: "Model B", family: "test" },
	]);
	await db.insert(tables.modelProviderMapping).values([
		{
			id: "price-mapping-a",
			modelId: "price-model-a",
			providerId: "price-provider",
			externalId: "a",
			inputPrice: "0.000001",
			outputPrice: "0.000002",
		},
		{
			id: "price-mapping-b",
			modelId: "price-model-b",
			providerId: "price-provider",
			externalId: "b",
			region: "eu",
			inputPrice: "0.000003",
			outputPrice: "0.000004",
		},
	]);
});

async function enable(
	userId: string,
	modelScope: "all" | "selected" | "used",
	options: { modelIds?: string[]; email?: boolean } = {},
) {
	await db.insert(tables.notificationPreference).values({
		userId,
		type: "model_price_change",
		inApp: true,
		email: options.email ?? false,
		modelScope,
		modelIds: options.modelIds ?? [],
	});
}

async function setPrice(mappingId: string, inputPrice: string) {
	await db
		.update(tables.modelProviderMapping)
		.set({ inputPrice })
		.where(eq(tables.modelProviderMapping.id, mappingId));
}

async function insertSpend(model: string, cost: number) {
	await db.insert(tables.apiKeyHourlyModelStats).values({
		projectId: "price-project",
		apiKeyId: "price-key",
		usedModel: `price-provider/${model}`,
		usedProvider: "price-provider",
		hourTimestamp: twoHoursAgo,
		requestCount: 10,
		cost,
	});
}

describe("model price alerts", () => {
	it("describes changed prices per million tokens", () => {
		expect(
			describePriceChange(
				{
					inputPrice: "0.000001",
					outputPrice: "0.000002",
					imageInputPrice: null,
					requestPrice: null,
				},
				{
					inputPrice: "0.0000012",
					outputPrice: "0.000002",
					imageInputPrice: "0.0000025",
					requestPrice: "0.01",
				},
			),
		).toBe(
			"input $1.00 → $1.20 per 1M tokens, image input not set → $0.0000025, request not set → $0.01 per request",
		);
	});

	it("sends one digest when a run changes more than three covered models", async () => {
		await enable("price-owner", "all");
		const extra = ["c", "d", "e"];
		await db.insert(tables.model).values(
			extra.map((id) => ({
				id: `price-model-${id}`,
				name: `Model ${id.toUpperCase()}`,
				family: "test",
			})),
		);
		await db.insert(tables.modelProviderMapping).values(
			extra.map((id) => ({
				id: `price-mapping-${id}`,
				modelId: `price-model-${id}`,
				providerId: "price-provider",
				externalId: id,
				inputPrice: "0.000001",
			})),
		);
		await processModelPriceAlerts(now);
		await db
			.update(tables.modelProviderMapping)
			.set({ inputPrice: "0.000002" });
		await processModelPriceAlerts(now);
		await processModelPriceAlerts(now);
		const notifications = await db.query.notification.findMany();
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({
			title: "Price changes for 5 models",
			href: "/models",
		});
		expect(notifications[0].message).toContain("Model A");
	});

	it("records first-seen prices silently, then notifies opted-in users once per change", async () => {
		await enable("price-owner", "all");
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		expect(await db.query.modelPriceState.findMany()).toHaveLength(2);

		await setPrice("price-mapping-a", "0.0000008");
		await Promise.all([
			processModelPriceAlerts(now),
			processModelPriceAlerts(now),
		]);
		await processModelPriceAlerts(now);
		expect(
			(
				await db.query.modelPriceState.findFirst({
					where: { mappingId: "price-mapping-a" },
				})
			)?.prices.inputPrice,
		).toBe("8e-7");
		const notifications = await db.query.notification.findMany();
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({
			userId: "price-owner",
			type: "model_price_change",
			projectId: null,
			organizationId: null,
			title: "Price change for Model A",
			href: "/models/price-model-a",
			inApp: true,
			email: false,
		});
		expect(notifications[0].message).toContain(
			"Price Provider: input $1.00 → $0.80 per 1M tokens",
		);

		// Reverting to an earlier price is a new change, not a duplicate.
		await setPrice("price-mapping-a", "0.000001");
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(2);
	});

	it("ignores equal prices written in another notation and users who opted out", async () => {
		await db.insert(tables.notificationPreference).values({
			userId: "price-owner",
			type: "model_price_change",
			inApp: false,
			email: false,
			modelScope: "all",
		});
		await processModelPriceAlerts(now);
		await setPrice("price-mapping-a", "0.0000010");
		await processModelPriceAlerts(now);
		await setPrice("price-mapping-a", "0.0000009");
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
	});

	it("waits while the catalogue sync holds its lock", async () => {
		await enable("price-owner", "all");
		await processModelPriceAlerts(now);
		await db.insert(tables.lock).values({ key: "model_sync" });
		await setPrice("price-mapping-a", "0.0000008");
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await db.delete(tables.lock);
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(1);
	});

	it("records price fields missing from a saved snapshot silently", async () => {
		await enable("price-owner", "all");
		await processModelPriceAlerts(now);
		await db
			.update(tables.modelProviderMapping)
			.set({ imageInputPrice: "0.001" })
			.where(eq(tables.modelProviderMapping.id, "price-mapping-a"));
		const state = await db.query.modelPriceState.findFirst({
			where: { mappingId: "price-mapping-a" },
		});
		const { imageInputPrice: _, ...older } = state!.prices;
		await db
			.update(tables.modelPriceState)
			.set({ prices: older })
			.where(eq(tables.modelPriceState.mappingId, "price-mapping-a"));
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		expect(
			(
				await db.query.modelPriceState.findFirst({
					where: { mappingId: "price-mapping-a" },
				})
			)?.prices.imageInputPrice,
		).toBe("0.001");
	});

	it("limits selected scope to the chosen models", async () => {
		await enable("price-owner", "selected", { modelIds: ["price-model-b"] });
		await processModelPriceAlerts(now);
		await setPrice("price-mapping-a", "0.0000008");
		await processModelPriceAlerts(now);
		expect(await db.query.notification.findMany()).toHaveLength(0);
		await setPrice("price-mapping-b", "0.0000025");
		await processModelPriceAlerts(now);
		const [notification] = await db.query.notification.findMany();
		expect(notification.title).toBe("Price change for Model B");
		expect(notification.message).toContain("Price Provider (eu)");
	});

	it("limits used scope to models with more than $1 of readable spend in 30 days", async () => {
		await insertSpend("price-model-a", 1.5);
		await insertSpend("price-model-b", 0.5);
		expect(
			await usedModelIds(
				"price-owner",
				["price-model-a", "price-model-b"],
				now,
			),
		).toEqual(new Set(["price-model-a"]));
		// A developer cannot see another member's key spend.
		expect(
			await usedModelIds("price-developer", ["price-model-a"], now),
		).toEqual(new Set());
		await db
			.update(tables.apiKey)
			.set({ createdBy: "price-developer" })
			.where(eq(tables.apiKey.id, "price-key"));
		expect(
			await usedModelIds("price-developer", ["price-model-a"], now),
		).toEqual(new Set(["price-model-a"]));
		await db
			.update(tables.apiKeyHourlyModelStats)
			.set({ hourTimestamp: monthAgo });
		expect(await usedModelIds("price-owner", ["price-model-a"], now)).toEqual(
			new Set(),
		);
	});

	it("notifies used scope only for spent models and emails the alert", async () => {
		await enable("price-owner", "used", { email: true });
		await insertSpend("price-model-a", 2);
		await processModelPriceAlerts(now);
		await setPrice("price-mapping-a", "0.0000008");
		await setPrice("price-mapping-b", "0.0000025");
		await processModelPriceAlerts(now);
		const notifications = await db.query.notification.findMany();
		expect(notifications.map((n) => n.title)).toEqual([
			"Price change for Model A",
		]);
		await deliverNotificationEmails(now);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toMatchObject({
			to: "owner@example.com",
			subject: "Price change for Model A",
		});
		expect(
			(await db.query.notification.findFirst())?.emailSentAt,
		).not.toBeNull();
	});
});
