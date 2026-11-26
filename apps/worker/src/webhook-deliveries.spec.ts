import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	db,
	organization,
	platformWebhookDelivery,
	project,
	webhookEndpoint,
} from "@llmgateway/db";

import { processWebhookDeliveries } from "./worker.js";

import type * as UrlSafetyNodeModule from "@llmgateway/shared/url-safety-node";

const fetchSafeUserUrl = vi.hoisted(() => vi.fn());

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafetyNodeModule>()),
	fetchSafeUserUrl,
}));

const ORG_ID = "webhook-delivery-org";
const PROJECT_ID = "webhook-delivery-project";
const ENDPOINT_URL = "https://hooks.example.com/llmgateway";

describe("processWebhookDeliveries", () => {
	beforeEach(async () => {
		fetchSafeUserUrl.mockReset();
		await db.delete(platformWebhookDelivery);
		await db.delete(webhookEndpoint);
		await db.delete(project);
		await db.delete(organization);
		await db.insert(organization).values({
			id: ORG_ID,
			name: "Webhook Org",
			billingEmail: "webhooks@example.com",
		});
		await db.insert(project).values({
			id: PROJECT_ID,
			name: "Webhook Project",
			organizationId: ORG_ID,
		});
		await db.insert(webhookEndpoint).values({
			id: "webhook-delivery-endpoint",
			organizationId: ORG_ID,
			projectId: PROJECT_ID,
			url: ENDPOINT_URL,
			secret: ["whsec", "delivery", "test"].join("_"),
		});
		await db.insert(platformWebhookDelivery).values({
			id: "webhook-delivery-row",
			webhookEndpointId: "webhook-delivery-endpoint",
			eventId: "evt_delivery_test",
			eventType: "wallet.credited",
			payload: { id: "evt_delivery_test" },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("delivers through the SSRF-safe fetch and records a refused delivery as a failed attempt", async () => {
		const globalFetch = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", globalFetch);
		fetchSafeUserUrl.mockRejectedValue(new TypeError("fetch failed: redirect"));

		await processWebhookDeliveries();

		expect(fetchSafeUserUrl).toHaveBeenCalledWith(
			ENDPOINT_URL,
			expect.objectContaining({ method: "POST" }),
		);
		expect(globalFetch).not.toHaveBeenCalled();
		const delivery = await db.query.platformWebhookDelivery.findFirst({
			where: { id: { eq: "webhook-delivery-row" } },
		});
		expect(delivery?.status).toBe("pending");
		expect(delivery?.attempts).toBe(1);
		expect(delivery?.lastError).toContain("redirect");
	});
});
