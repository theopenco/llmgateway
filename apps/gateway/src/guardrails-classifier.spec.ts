import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables, withDefaultSystemRules } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("guardrail classifier", () => {
	const harness = createGatewayApiTestHarness();

	async function seed(suffix: string) {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));
		await db.insert(tables.apiKey).values({
			id: `token-id-${suffix}`,
			...hashApiKeyForStorage(`real-token-${suffix}`),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		for (const provider of ["openai", "typesafe"] as const) {
			const id = `provider-key-${provider}-${suffix}`;
			await db.insert(tables.providerKey).values({
				id,
				...encryptProviderKeyForStorage("test-provider-token", id, "org-id"),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}
		await db.insert(tables.guardrailConfig).values({
			organizationId: "org-id",
			systemRules: withDefaultSystemRules({
				harmful_content: { enabled: true, action: "block" },
			}),
		});
	}

	function request(suffix: string, content: string) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token-${suffix}`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content }],
			}),
		});
	}

	test("blocks on a classifier verdict and bills the check as its own request", async () => {
		await seed("guardrail-block");

		const res = await request("guardrail-block", "explain how to harm someone");

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("content_policy_violation");
		expect(json.error.violations[0].rule_id).toBe("system:harmful_content");

		const logs = await waitForLogs(2);
		const check = logs.find((log) => log.apiOrigin === "systemone");
		expect(check?.usedModel).toBe("typesafe/jev-1.14.0");
		expect(check?.hasError).toBe(false);
		expect(Number(check?.cost)).toBeGreaterThan(0);
		expect(
			logs.some((log) => log.errorDetails?.cause === "guardrail_violation"),
		).toBe(true);
	});

	test("lets clean requests through after the check", async () => {
		await seed("guardrail-pass");

		const res = await request("guardrail-pass", "say hello");

		expect(res.status).toBe(200);
		const logs = await waitForLogs(2);
		expect(logs.filter((log) => log.apiOrigin === "systemone")).toHaveLength(1);
		expect(
			logs.filter((log) => log.apiOrigin === "chat-completions"),
		).toHaveLength(1);
	});

	test("fails open when the classifier request fails", async () => {
		await seed("guardrail-error");

		const res = await request("guardrail-error", "CLASSIFIER_ERROR say hello");

		expect(res.status).toBe(200);
	});
});
