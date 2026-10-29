import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "@/test-utils/mock-openai-server.js";
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
		expect((await res.json()).model).toBe("typesafe/jev-1.14.0");

		const logs = await waitForLogs(1);
		expect(
			logs.find((l) => l.usedModel === "typesafe/jev-1.14.0")?.usedModelMapping,
		).toBe("jev-1.14.0");
	});

	test("/v1/systemone forwards image assets with TypeSafe's image opt-in", async () => {
		await seedKeys("systemone-assets");
		await seedProviderKey("systemone-assets");

		const assets = {
			"a3f1c2e8-door": {
				type: "image",
				format: "jpg",
				data_base64: "/9j/4AAQSkZJRg==",
			},
		};
		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-assets",
			},
			body: JSON.stringify({
				model: "jev-1.14.0",
				state: { door: "a3f1c2e8-door" },
				assets,
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		// The mock rejects assets sent without the opt-in header.
		expect(res.status, await res.clone().text()).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.14.0");
		expect(log?.upstreamRequest).toMatchObject({ assets });
	});

	test("/v1/systemone moves inline image parts into assets", async () => {
		await seedKeys("systemone-inline");
		await seedProviderKey("systemone-inline");

		const png = "iVBORw0KGgo=";
		const jpg = "/9j/4AAQSkZJRg==";
		const part = (data: string, mime: string) => ({
			type: "image_url",
			image_url: { url: `data:${mime};base64,${data}` },
		});
		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-inline",
			},
			body: JSON.stringify({
				model: "jev-1.14.0",
				state: ["Product photo:", part(png, "image/png")],
				questions: {
					urgency: {
						type: "noul",
						instructions: ["Same item as", part(jpg, "image/jpeg"), "?"],
					},
					severity: {
						type: "score",
						instructions: "How worn is it?",
						criteria: ["New", part(jpg, "image/jpeg")],
					},
				},
			}),
		});

		const json = await res.json();
		// The mock rejects assets sent without the opt-in header.
		expect(res.status, JSON.stringify(json)).toBe(200);
		// The legend echoes each level as sent; the image level comes back as
		// the caller's part, not the gateway's reference.
		expect(json.answers.severity.legend).toEqual({
			"0": "New",
			"1": part(jpg, "image/jpeg"),
		});

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "typesafe/jev-1.14.0");
		const upstream = log?.upstreamRequest as {
			state: string[];
			questions: {
				urgency: { instructions: string[] };
				severity: { criteria: string[] };
			};
			assets: Record<string, unknown>;
		};
		const stateRef = upstream.state[1];
		const instructionRef = upstream.questions.urgency.instructions[1];
		const criteriaRef = upstream.questions.severity.criteria[1];
		expect(upstream.state[0]).toBe("Product photo:");
		expect(upstream.assets).toEqual({
			[stateRef]: { type: "image", format: "png", data_base64: png },
			[instructionRef]: { type: "image", format: "jpg", data_base64: jpg },
			[criteriaRef]: { type: "image", format: "jpg", data_base64: jpg },
		});
		const { assets: _assets, ...content } = upstream;
		expect(JSON.stringify(content)).not.toContain("base64");
	});

	test("/v1/systemone keeps caller assets next to inline image parts", async () => {
		await seedKeys("systemone-mixed");
		await seedProviderKey("systemone-mixed");

		const assets = {
			"a3f1c2e8-door": {
				type: "image",
				format: "jpg",
				data_base64: "/9j/4AAQSkZJRg==",
			},
		};
		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-mixed",
			},
			body: JSON.stringify({
				model: "jev-1.14.0",
				state: {
					door: "a3f1c2e8-door",
					badge: {
						type: "image_url",
						image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
					},
				},
				assets,
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status, await res.clone().text()).toBe(200);

		const logs = await waitForLogs(1);
		const upstream = logs.find((l) => l.usedModel === "typesafe/jev-1.14.0")
			?.upstreamRequest as {
			state: { door: string; badge: string };
			assets: Record<string, unknown>;
		};
		expect(upstream.state.door).toBe("a3f1c2e8-door");
		expect(Object.keys(upstream.assets).sort()).toEqual(
			["a3f1c2e8-door", upstream.state.badge].sort(),
		);
	});

	test("/v1/systemone rejects inline images Jev can't read", async () => {
		await seedKeys("systemone-webp");
		await seedProviderKey("systemone-webp");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-webp",
			},
			body: JSON.stringify({
				model: "jev-1.14.0",
				state: [
					{
						type: "image_url",
						image_url: { url: "data:image/webp;base64,UklGRg==" },
					},
				],
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("PNG and JPEG");
	});

	test("/v1/systemone answers box questions", async () => {
		await seedKeys("systemone-box");
		await seedProviderKey("systemone-box");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-box",
			},
			body: JSON.stringify({
				model: "jev-1.14.0",
				state: {
					type: "image_url",
					image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
				},
				questions: {
					product: { type: "box", instructions: "the product in `state`" },
				},
			}),
		});

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.answers.product).toMatchObject({
			type: "box",
			box: { top: 0.25, bottom: 0.75, left: 0.25, right: 0.75 },
		});
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

	test("/v1/systemone points non-TypeSafe decision models at /v1/decisions", async () => {
		await seedKeys("systemone-openai-model");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-openai-model",
			},
			body: JSON.stringify({
				model: "gpt-6-luna-decisions",
				state: "hello",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("model_not_found");
		expect(json.error.message).toContain("/v1/decisions");
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

	test("/v1/systemone retries with another BYOK key after upstream 500", async () => {
		resetFailOnceCounter();
		await seedKeys("systemone-retry");
		await seedProviderKey("systemone-retry-a");
		await seedProviderKey("systemone-retry-b");

		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-systemone-retry",
			},
			body: JSON.stringify({
				model: "jev-1.13.0",
				state: "TRIGGER_FAIL_ONCE first call should fail",
				questions: { urgency: QUESTIONS.urgency },
			}),
		});

		expect(res.status).toBe(200);

		const logs = await waitForLogs(2);
		const systemOneLogs = logs.filter(
			(l) => l.usedModel === "typesafe/jev-1.13.0",
		);
		expect(systemOneLogs).toHaveLength(2);

		const failedLog = systemOneLogs.find((l) => l.hasError);
		const successLog = systemOneLogs.find((l) => !l.hasError);
		expect(failedLog?.finishReason).toBe("upstream_error");
		expect(failedLog?.retried).toBe(true);
		expect(failedLog?.retriedByLogId).toBe(successLog?.id);
		expect(Number(failedLog?.cost)).toBe(0);
		expect(successLog?.finishReason).toBe("stop");
		expect(successLog?.retried).toBe(false);
		expect(failedLog?.providerKeyId).not.toBe(successLog?.providerKeyId);

		const routing = successLog?.routingMetadata?.routing;
		expect(routing).toHaveLength(2);
		expect(routing?.[0]).toMatchObject({
			provider: "typesafe",
			succeeded: false,
			credentialSource: "byok",
			logId: failedLog?.id,
		});
		expect(routing?.[1]).toMatchObject({
			provider: "typesafe",
			succeeded: true,
			credentialSource: "byok",
			logId: successLog?.id,
		});
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
