import { beforeEach, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { canUseModel } from "./lib/enterprise.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

import type { ModelDefinition } from "@llmgateway/models";

const MODEL_ID = "deepseek-v4.1-flash-cyber";

async function request(model: string) {
	return await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer real-token",
			"x-no-fallback": "true",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: "Hello!" }],
		}),
	});
}

describe("enterprise-only models", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id",
				"org-id",
			),
			provider: "inference.net",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	});

	test("the cyber model is marked enterprise-only", () => {
		const model = models.find((m) => m.id === MODEL_ID) as
			ModelDefinition | undefined;
		expect(model?.enterpriseOnly).toBe(true);
	});

	test.each([MODEL_ID, `inference.net/${MODEL_ID}`])(
		"non-enterprise orgs get a 403 for %s",
		async (model) => {
			const res = await request(model);
			expect(res.status).toBe(403);
			const json = await res.json();
			expect(json.error.message).toContain("enterprise plan");
			expect(json.error.message).toContain("contact@llmgateway.io");
		},
	);

	test("enterprise orgs can use it", async () => {
		await harness.setOrganizationPlan("enterprise");
		const res = await request(`inference.net/${MODEL_ID}`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices[0].message.content).toMatch(/Hello!/);
	});

	test("canUseModel requires enterprise access for enterprise-only models", () => {
		expect(canUseModel({ enterpriseOnly: true }, "org-id", "pro")).toBe(false);
		expect(canUseModel({ enterpriseOnly: true }, "org-id", "enterprise")).toBe(
			true,
		);
		expect(canUseModel({}, "org-id", "free")).toBe(true);
	});
});
