import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const QUESTIONS = {
	department: {
		type: "choice" as const,
		instructions: "Which team should handle this support request?",
		criteria: {
			billing: "Invoices, payments, refunds",
			technical: "Bugs, outages, integrations",
		},
	},
	urgency: {
		type: "noul" as const,
		instructions: "Does the request describe an urgent problem?",
	},
	severity: {
		type: "score" as const,
		instructions: "Rate the operational impact.",
		criteria: ["None", "Limited", "Critical"],
	},
};

async function seedKeys(suffix: string) {
	await db.insert(tables.apiKey).values({
		id: `token-id-${suffix}`,
		...hashApiKeyForStorage(`real-token-${suffix}`),
		projectId: "project-id",
		description: "Test API Key",
		createdBy: "user-id",
	});
}

describe("systemone", () => {
	const harness = createGatewayApiTestHarness();

	async function seedProviderKey(suffix: string) {
		await db.insert(tables.providerKey).values({
			id: `provider-key-${suffix}`,
			...encryptProviderKeyForStorage(
				"typesafe-token",
				`provider-key-${suffix}`,
				"org-id",
			),
			provider: "typesafe",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	test("/v1/systemone returns typed answers and bills input tokens", async () => {
		await seedKeys("systemone");
		await seedProviderKey("systemone");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone",
			},
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: "Our integration returns 500 on every request.",
				questions: QUESTIONS,
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe("typesafe/jev-1.13.0");
		expect(json.answers.urgency).toMatchObject({ type: "noul" });
		expect(json.answers.department.choice).toBe("billing");
		expect(json.answers.severity.score).toBe(2);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.13.0");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.apiOrigin).toBe("systemone");
		expect(log?.promptTokens).toBe("441");
		// 441 input tokens at $0.042/M, output tokens are free.
		expect(Number(log?.cost)).toBeCloseTo(441 * 0.042e-6, 12);
		expect(Number(log?.outputCost)).toBe(0);
		// The organization retains data, so the payload has to survive: it is
		// charged for the storage either way.
		expect(log?.messages).not.toBeNull();
		expect(log?.content).toContain("urgency");
		// Storage is charged on everything kept: 441 input + 69 output tokens at
		// $0.01/M. Input alone would silently pass a "greater than zero" check.
		expect(Number(log?.dataStorageCost)).toBeCloseTo(
			((441 + 69) / 1_000_000) * 0.01,
			12,
		);
	});

	test("/v1/systemone resolves the provider's moving alias to the pinned model", async () => {
		await seedKeys("systemone-alias");
		await seedProviderKey("systemone-alias");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-alias",
			},
			body: JSON.stringify({
				model: "typesafe/jev-latest",
				state: "Just checking in, no rush.",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe("typesafe/jev-1.13.0");

		const logs = await waitForLogs(1);
		expect(
			logs.find((l) => l.usedModel === "typesafe/jev-1.13.0")?.usedModelMapping,
		).toBe("jev-1.13.0");
	});

	test("/v1/systemone rejects a chat model", async () => {
		await seedKeys("systemone-chat-model");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-chat-model",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				state: "hello",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("model_not_found");
	});

	test("/v1/systemone rejects a request with no questions", async () => {
		await seedKeys("systemone-no-questions");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-no-questions",
			},
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: "hello",
				questions: {},
			}),
		});

		expect(res.status).toBe(400);
	});

	test("/v1/systemone surfaces an upstream failure and logs it", async () => {
		await seedKeys("systemone-error");
		await seedProviderKey("systemone-error");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-error",
			},
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: "TRIGGER_ERROR",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(500);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.13.0");
		expect(log?.hasError).toBe(true);
		expect(Number(log?.cost)).toBe(0);
	});

	test("/v1/systemone does not persist payloads when retention is disabled", async () => {
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));
		await seedKeys("systemone-no-retention");
		await seedProviderKey("systemone-no-retention");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-no-retention",
			},
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: "Sensitive customer record",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.13.0");
		expect(log?.messages).toBeNull();
		expect(log?.content).toBeNull();
	});
});
