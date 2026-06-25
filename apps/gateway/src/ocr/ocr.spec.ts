import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

const IMAGE_DOCUMENT = {
	type: "image_url" as const,
	image_url: "https://example.com/doc.png",
};

describe("ocr", () => {
	const harness = createGatewayApiTestHarness();

	test("/v1/ocr returns the OCR result and bills per page", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-ocr",
			token: "real-token-ocr",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-mistral",
			token: "mistral-token",
			provider: "mistral",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const res = await app.request("/v1/ocr", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-ocr",
			},
			body: JSON.stringify({
				model: "mistral-ocr-latest",
				document: {
					type: "image_url",
					image_url: "https://example.com/PAGES_3.png",
				},
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(Array.isArray(json.pages)).toBe(true);
		expect(json.pages).toHaveLength(3);
		expect(json.usage_info.pages_processed).toBe(3);

		const logs = await waitForLogs(1);
		const ocrLog = logs.find(
			(l) => l.usedModel === "mistral/mistral-ocr-latest",
		);
		expect(ocrLog).toBeDefined();
		expect(ocrLog?.hasError).toBe(false);
		expect(ocrLog?.finishReason).toBe("stop");
		// 3 pages * $0.004 per page.
		expect(Number(ocrLog?.cost)).toBeCloseTo(0.012, 6);
		expect(ocrLog?.routingMetadata?.selectedProvider).toBe("mistral");
	});

	test("/v1/ocr rejects dev-plan personal orgs with 403", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-ocr-devplan",
			token: "real-token-ocr-devplan",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await harness.setDevPlan({ devPlan: "pro", allowAllModels: true });

		const res = await app.request("/v1/ocr", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-ocr-devplan",
			},
			body: JSON.stringify({
				model: "mistral-ocr-latest",
				document: IMAGE_DOCUMENT,
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"OCR is not available for coding plans",
		);
	});

	test("/v1/ocr surfaces upstream errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-ocr-error",
			token: "real-token-ocr-error",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-mistral-error",
			token: "mistral-token",
			provider: "mistral",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const res = await app.request("/v1/ocr", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-ocr-error",
			},
			body: JSON.stringify({
				model: "mistral-ocr-latest",
				document: {
					type: "image_url",
					image_url: "https://example.com/TRIGGER_ERROR.png",
				},
			}),
		});

		expect(res.status).toBe(500);
	});
});
