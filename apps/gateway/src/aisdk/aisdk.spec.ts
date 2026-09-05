import { beforeAll, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

// Request-path tests for the AI SDK Gateway protocol surface: header-driven
// model/spec/streaming negotiation, the hop into /v1/chat/completions, the
// stream-part translation, and the error envelope `@ai-sdk/gateway` classifies
// on. The pure converters have their own suite in convert.spec.ts.
describe("ai sdk gateway protocol surface", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	const MODEL = "openai/gpt-4o-mini";

	async function seedKeys(suffix: string) {
		await db.insert(tables.apiKey).values({
			id: `token-aisdk-${suffix}`,
			...hashApiKeyForStorage(`real-token-aisdk-${suffix}`),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: `provider-key-aisdk-${suffix}`,
			...encryptProviderKeyForStorage(
				"sk-openai-test-key",
				`provider-key-aisdk-${suffix}`,
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		return `real-token-aisdk-${suffix}`;
	}

	function languageModel(
		token: string,
		body: Record<string, unknown>,
		{
			stream = false,
			specVersion = "4",
			modelId = MODEL,
			path = "/v4/ai/language-model",
		}: {
			stream?: boolean;
			specVersion?: string;
			modelId?: string | null;
			path?: string;
		} = {},
	) {
		return app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"ai-gateway-protocol-version": "0.0.1",
				"ai-language-model-specification-version": specVersion,
				...(modelId ? { "ai-language-model-id": modelId } : {}),
				"ai-language-model-streaming": String(stream),
			},
			body: JSON.stringify(body),
		});
	}

	async function readStreamParts(response: Response) {
		const text = await response.text();
		return text
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("data:"))
			.map((line) => JSON.parse(line.slice(5).trim()) as { type: string });
	}

	test("answers a non-streaming call with spec content parts and nested usage", async () => {
		const token = await seedKeys("generate");

		const res = await languageModel(token, {
			prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			maxOutputTokens: 64,
		});

		expect(res.status).toBe(200);
		const json = await res.json();

		expect(Array.isArray(json.content)).toBe(true);
		expect(
			json.content.some((part: { type: string }) => part.type === "text"),
		).toBe(true);
		expect(json.finishReason).toBeDefined();
		// v4 usage is nested; a flat shape here would silently report zero tokens
		// to the AI SDK rather than fail.
		expect(json.usage.inputTokens).toHaveProperty("total");
		expect(json.usage.outputTokens).toHaveProperty("total");
	});

	test("reports flat usage when the caller announced spec version 2", async () => {
		const token = await seedKeys("v2");

		const res = await languageModel(
			token,
			{ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
			{ specVersion: "2" },
		);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(typeof json.usage.inputTokens).not.toBe("object");
		expect(json.usage).toHaveProperty("totalTokens");
	});

	test("streams spec stream parts and always terminates with finish", async () => {
		const token = await seedKeys("stream");

		const res = await languageModel(
			token,
			{
				prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			},
			{ stream: true },
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const parts = await readStreamParts(res);
		const types = parts.map((part) => part.type);

		expect(types[0]).toBe("stream-start");
		expect(types).toContain("text-start");
		expect(types).toContain("text-delta");
		expect(types.at(-1)).toBe("finish");
		// Every emitted part must be a spec part: the AI SDK parses them with
		// z.any() and forwards an unknown type straight into the consumer stream.
		const specParts = new Set([
			"stream-start",
			"response-metadata",
			"text-start",
			"text-delta",
			"text-end",
			"reasoning-start",
			"reasoning-delta",
			"reasoning-end",
			"tool-input-start",
			"tool-input-delta",
			"tool-input-end",
			"tool-call",
			"tool-result",
			"source",
			"file",
			"raw",
			"error",
			"finish",
		]);
		expect(types.every((type) => specParts.has(type))).toBe(true);
	});

	test("rejects a call without the model header", async () => {
		const token = await seedKeys("no-model");

		const res = await languageModel(
			token,
			{ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
			{ modelId: null },
		);

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.type).toBe("invalid_request_error");
	});

	test("rejects a malformed body with an invalid_request_error", async () => {
		const token = await seedKeys("bad-body");

		const res = await languageModel(token, { prompt: "not an array" });

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.type).toBe("invalid_request_error");
	});

	test("maps an inner auth failure onto authentication_error", async () => {
		const res = await languageModel("nope-not-a-key", {
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		});

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.type).toBe("authentication_error");
	});

	test("surfaces the inner message verbatim for an unresolvable model", async () => {
		const token = await seedKeys("unknown-model");

		const res = await languageModel(
			token,
			{ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
			{ modelId: "openai/definitely-not-a-real-model" },
		);

		expect(res.status).toBe(400);
		const json = await res.json();
		// The inner endpoint answers 400, so the type follows the status rather
		// than being upgraded to model_not_found off the message text — the
		// message itself already names the model.
		expect(json.error.type).toBe("invalid_request_error");
		expect(json.error.message).toContain("definitely-not-a-real-model");
	});

	test("serves the same surface under every versioned prefix", async () => {
		const token = await seedKeys("prefixes");

		for (const path of [
			"/v1/ai/language-model",
			"/v2/ai/language-model",
			"/v3/ai/language-model",
			"/v4/ai/language-model",
		]) {
			const res = await languageModel(
				token,
				{ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
				{ path },
			);
			expect(res.status, `prefix ${path}`).toBe(200);
		}
	});

	describe("GET /config", () => {
		test("requires an active API key", async () => {
			const res = await app.request("/v4/ai/config");
			expect(res.status).toBe(401);
			expect((await res.json()).error.type).toBe("authentication_error");
		});

		test("lists provider-pinned models with an AI SDK specification block", async () => {
			const token = await seedKeys("config");

			const res = await app.request("/v4/ai/config", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.models.length).toBeGreaterThan(0);

			const entry = json.models.find(
				(model: { id: string }) => model.id === MODEL,
			);
			expect(entry).toMatchObject({
				specification: {
					specificationVersion: "v4",
					provider: "openai",
					modelId: "gpt-4o-mini",
				},
				modelType: "language",
			});
		});
	});

	describe("GET /v1/credits", () => {
		test("requires an active API key", async () => {
			const res = await app.request("/v1/credits");
			expect(res.status).toBe(401);
		});

		test("reports the organization balance and spend", async () => {
			const token = await seedKeys("credits");

			const res = await app.request("/v1/credits", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			// The harness re-seeds the shared org with 100.00 credits per test.
			expect(Number(json.balance)).toBe(100);
			expect(Number(json.total_used)).toBeGreaterThanOrEqual(0);
		});
	});
});
