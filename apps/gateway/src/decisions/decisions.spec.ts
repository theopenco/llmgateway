import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const QUESTIONS = [
	{
		type: "choice" as const,
		name: "department",
		instructions: "Which team should handle this support request?",
		choices: [
			{ value: "billing", description: "Invoices, payments, refunds" },
			{ value: "technical", description: "Bugs, outages, integrations" },
		],
	},
	{
		type: "predicate" as const,
		name: "urgency",
		instructions: "Does the request describe an urgent problem?",
	},
	{
		type: "score" as const,
		name: "severity",
		instructions: "Rate the operational impact.",
		levels: [{ label: "None" }, { label: "Limited" }, { label: "Critical" }],
	},
];

async function seedApiKey(suffix: string) {
	await db.insert(tables.apiKey).values({
		id: `token-id-${suffix}`,
		...hashApiKeyForStorage(`real-token-${suffix}`),
		projectId: "project-id",
		description: "Test API Key",
		createdBy: "user-id",
	});
}

function postDecision(suffix: string, body: Record<string, unknown>) {
	return app.request("/v1/decisions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer real-token-${suffix}`,
		},
		body: JSON.stringify(body),
	});
}

describe("decisions", () => {
	const harness = createGatewayApiTestHarness();

	async function seedProviderKey(
		suffix: string,
		provider: "openai" | "typesafe" | "azure",
	) {
		await db.insert(tables.providerKey).values({
			id: `provider-key-${suffix}`,
			...encryptProviderKeyForStorage(
				`${provider}-token`,
				`provider-key-${suffix}`,
				"org-id",
			),
			provider,
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	test("/v1/decisions forwards gpt-6-luna-decisions to OpenAI and bills input tokens", async () => {
		await seedApiKey("decisions-openai");
		await seedProviderKey("decisions-openai", "openai");

		const res = await postDecision("decisions-openai", {
			model: "gpt-6-luna-decisions",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: "Our integration returns 500s." },
						{
							type: "input_image",
							image_url: "data:image/png;base64,iVBORw0KGgo=",
						},
					],
				},
			],
			questions: QUESTIONS,
		});

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.model).toBe("openai/gpt-6-luna-decisions");
		expect(json.answers).toEqual([
			expect.objectContaining({
				type: "choice",
				name: "department",
				choice: "billing",
			}),
			{ type: "predicate", name: "urgency", probability: 0.92 },
			expect.objectContaining({ type: "score", name: "severity", score: 2 }),
		]);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "openai/gpt-6-luna-decisions");
		expect(log?.hasError).toBe(false);
		expect(log?.apiOrigin).toBe("decisions");
		expect(log?.usedModelMapping).toBe("gpt-6-luna");
		expect(log?.promptTokens).toBe("300");
		expect(log?.pricingTier).toBe("Up to 272K");
		// 300 input tokens at $0.10/M; decisions have no output charge.
		expect(Number(log?.cost)).toBeCloseTo(300 * 0.1e-6, 12);
		// Image data never lands in the stored request summary.
		expect(JSON.stringify(log?.messages)).toContain("[image]");
		expect(JSON.stringify(log?.messages)).not.toContain("iVBORw0KGgo");
	});

	test("/v1/decisions serves Jev by translating to TypeSafe System One", async () => {
		await seedApiKey("decisions-jev");
		await seedProviderKey("decisions-jev", "typesafe");

		const res = await postDecision("decisions-jev", {
			model: "jev",
			input: "Our integration returns 500 on every request.",
			questions: [
				...QUESTIONS,
				{ type: "predicate", instructions: "Is it spam?" },
			],
		});

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.model).toBe("typesafe/jev-1.13.0");
		expect(json.answers).toEqual([
			{
				type: "choice",
				name: "department",
				choice: "billing",
				probabilities: [
					{ value: "billing", probability: 1 },
					{ value: "technical", probability: 0 },
				],
				confidence: 0.9,
			},
			{ type: "predicate", name: "urgency", probability: 0.01 },
			{
				type: "score",
				name: "severity",
				score: 2,
				probabilities: [
					{ value: 0, label: "None", probability: 0 },
					{ value: 1, label: "Limited", probability: 0 },
					{ value: 2, label: "Critical", probability: 1 },
				],
				confidence: 0.9,
			},
			{ type: "predicate", name: null, probability: 0.01 },
		]);
		expect(json.usage).toMatchObject({
			input_tokens: 441,
			output_tokens: 69,
			total_tokens: 510,
		});

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.13.0");
		expect(log?.hasError).toBe(false);
		expect(log?.apiOrigin).toBe("decisions");
		expect(Number(log?.cost)).toBeCloseTo(441 * 0.042e-6, 12);
	});

	test("/v1/decisions serves Microsoft-Decision-1 via Azure's System One route", async () => {
		await seedApiKey("decisions-azure");
		await seedProviderKey("decisions-azure", "azure");

		const res = await postDecision("decisions-azure", {
			model: "azure/microsoft-decision-1",
			input: "Checkout is down for all EU customers since 09:00.",
			questions: QUESTIONS,
		});

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.model).toBe("azure/microsoft-decision-1");
		expect(json.answers).toEqual([
			expect.objectContaining({
				type: "choice",
				name: "department",
				choice: "billing",
			}),
			{ type: "predicate", name: "urgency", probability: 0.01 },
			expect.objectContaining({ type: "score", name: "severity", score: 2 }),
		]);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "azure/microsoft-decision-1");
		expect(log?.hasError).toBe(false);
		expect(log?.apiOrigin).toBe("decisions");
		// Azure is called with the deployment name, not the model name.
		expect(log?.usedModelMapping).toBe("Decision-1");
		expect(log?.upstreamRequest).toMatchObject({
			model: "Decision-1",
			state: "Checkout is down for all EU customers since 09:00.",
		});
		expect(Number(log?.cost)).toBeCloseTo(441 * 0.042e-6, 12);
	});

	test("/v1/decisions reports an invalid Azure resource as a 400", async () => {
		await seedApiKey("decisions-azure-bad-resource");
		await db.insert(tables.providerKey).values({
			id: "provider-key-decisions-azure-bad-resource",
			...encryptProviderKeyForStorage(
				"azure-token",
				"provider-key-decisions-azure-bad-resource",
				"org-id",
			),
			provider: "azure",
			organizationId: "org-id",
			options: { azure_resource: "evil.example.com/x" },
		});

		const res = await postDecision("decisions-azure-bad-resource", {
			model: "azure/microsoft-decision-1",
			input: "hello",
			questions: [QUESTIONS[1]],
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain(
			"Invalid Azure resource",
		);
	});

	test("/v1/decisions rejects image input for a text-only decision model", async () => {
		await seedApiKey("decisions-jev-image");
		await seedProviderKey("decisions-jev-image", "typesafe");

		const res = await postDecision("decisions-jev-image", {
			model: "jev-1.13.0",
			input: [
				{
					role: "user",
					content: [
						{
							type: "input_image",
							image_url: "data:image/png;base64,iVBORw0KGgo=",
						},
					],
				},
			],
			questions: [QUESTIONS[1]],
		});

		expect(res.status).toBe(400);
	});

	test("/v1/decisions rejects a chat model", async () => {
		await seedApiKey("decisions-chat-model");

		const res = await postDecision("decisions-chat-model", {
			model: "gpt-4o-mini",
			input: "hello",
			questions: [QUESTIONS[1]],
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("model_not_found");
	});

	test("/v1/decisions rejects the TypeSafe request shape", async () => {
		await seedApiKey("decisions-legacy-shape");

		const res = await postDecision("decisions-legacy-shape", {
			model: "jev-1.13.0",
			state: "hello",
			questions: { urgency: { type: "noul", instructions: "Urgent?" } },
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("invalid_parameters");
		expect(json.error.type).toBe("invalid_request_error");
	});

	test("/v1/decisions surfaces an upstream failure and logs it", async () => {
		await seedApiKey("decisions-error");
		await seedProviderKey("decisions-error", "openai");

		const res = await postDecision("decisions-error", {
			model: "gpt-6-luna-decisions",
			input: "TRIGGER_ERROR",
			questions: [QUESTIONS[1]],
		});

		expect(res.status).toBe(500);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "openai/gpt-6-luna-decisions");
		expect(log?.hasError).toBe(true);
		expect(log?.apiOrigin).toBe("decisions");
		expect(Number(log?.cost)).toBe(0);
	});
});
