import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

interface CapturedRequest {
	url: string;
	authorization: string | undefined;
	body: Record<string, unknown>;
}

const QUESTIONS = [
	{
		type: "predicate" as const,
		name: "is_outage",
		instructions: "Does this describe a production outage?",
	},
	{
		type: "choice" as const,
		name: "team",
		instructions: "Which team should handle this?",
		choices: [{ value: "billing" }, { value: "engineering" }],
	},
];

/**
 * Airside decision listings are served on /v1/decisions by forwarding the
 * OpenAI-compatible body to the carrier's own `/v1/decisions`.
 */
describe("airside decision listings", () => {
	createGatewayApiTestHarness();

	let upstream: Server;
	let upstreamUrl = "";
	let captured: CapturedRequest[] = [];

	beforeAll(async () => {
		upstream = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
				captured.push({
					url: req.url ?? "",
					authorization: req.headers.authorization,
					body: parsed,
				});
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						model: parsed.model,
						answers: [
							{ type: "predicate", name: "is_outage", probability: 0.97 },
							{
								type: "choice",
								name: "team",
								choice: "engineering",
								probabilities: [
									{ value: "billing", probability: 0.05 },
									{ value: "engineering", probability: 0.95 },
								],
							},
						],
						usage: JSON.stringify(parsed).includes("negative usage")
							? { input_tokens: -5 }
							: { input_tokens: 400, output_tokens: 0, total_tokens: 400 },
					}),
				);
			});
		});
		upstreamUrl = await new Promise<string>((resolve) => {
			upstream.listen(0, () => {
				const address = upstream.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			upstream.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setupDecisionCarrier(
		token: string,
		options: { vision?: boolean; status?: "active" | "inactive" } = {},
	) {
		captured = [];
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Airside decision carrier test key",
			createdBy: "user-id",
		});
		await db
			.update(tables.project)
			.set({ mode: "credits" })
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Acme Decide",
		});
		await db.insert(tables.providerClaim).values({
			id: `${token}-claim`,
			providerCompanyId: `${token}-company`,
			providerId: "acme-decide",
			kind: "custom",
			matchedDomain: "acme-decide.ai",
			customName: "Acme Decide",
			customBaseUrl: upstreamUrl,
			status: "active",
		});
		await db
			.insert(tables.provider)
			.values({ id: "acme-decide", name: "Acme Decide", description: "" })
			.onConflictDoNothing();
		await db
			.insert(tables.model)
			.values({
				id: "decide-fast",
				name: "Decide Fast",
				family: "acme-decide",
				output: ["decision"],
			})
			.onConflictDoNothing();
		await db.insert(tables.modelProviderMapping).values({
			modelId: "decide-fast",
			providerId: "acme-decide",
			externalId: "decide-fast-2",
			source: "airside",
			decisions: true,
			inputPrice: "8e-8",
			outputPrice: "0",
			contextSize: 8000,
			streaming: false,
			vision: options.vision ?? false,
			status: options.status ?? "active",
		});
		await db.insert(tables.providerKey).values({
			id: `${token}-managed-key`,
			managed: true,
			organizationId: null,
			provider: "acme-decide",
			...encryptProviderKeyForStorage(
				"mock-acme-decide-key",
				`${token}-managed-key`,
				null,
			),
		});
		await clearCache();
	}

	async function postDecision(
		token: string,
		body: Record<string, unknown>,
		requestId?: string,
	) {
		return await app.request("/v1/decisions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...(requestId ? { "x-request-id": requestId } : {}),
			},
			body: JSON.stringify(body),
		});
	}

	test("forwards to the carrier's /v1/decisions and bills the filed input price", async () => {
		await setupDecisionCarrier("airside-decide-token");
		const requestId = "airside-decide-req-1";

		const res = await postDecision(
			"airside-decide-token",
			{
				model: "acme-decide/decide-fast",
				input: "Checkout returns 500 for every customer since 09:00.",
				questions: QUESTIONS,
				safety_identifier: "client-value",
			},
			requestId,
		);

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.model).toBe("acme-decide/decide-fast");
		expect(json.answers).toEqual([
			{ type: "predicate", name: "is_outage", probability: 0.97 },
			expect.objectContaining({ type: "choice", choice: "engineering" }),
		]);

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/v1/decisions");
		expect(captured[0].authorization).toBe("Bearer mock-acme-decide-key");
		// The OpenAI-compatible body goes through unchanged, with the upstream id.
		expect(captured[0].body).toEqual({
			model: "decide-fast-2",
			input: "Checkout returns 500 for every customer since 09:00.",
			questions: QUESTIONS,
		});

		const log = await waitForLogByRequestId(requestId);
		expect(log?.usedProvider).toBe("acme-decide");
		expect(log?.usedModel).toBe("acme-decide/decide-fast");
		expect(log?.apiOrigin).toBe("decisions");
		expect(log?.promptTokens).toBe("400");
		expect(Number(log?.cost)).toBeCloseTo(400 * 8e-8, 12);

		// The bare id resolves to the only listing.
		const bare = await postDecision("airside-decide-token", {
			model: "decide-fast",
			input: "Is this an outage?",
			questions: [QUESTIONS[0]],
		});
		expect(bare.status).toBe(200);
	});

	test("bills an estimate when the carrier reports no usable usage", async () => {
		await setupDecisionCarrier("airside-decide-usage-token");
		const requestId = "airside-decide-usage-req";
		const res = await postDecision(
			"airside-decide-usage-token",
			{
				model: "acme-decide/decide-fast",
				input: "negative usage please",
				questions: [QUESTIONS[0]],
			},
			requestId,
		);
		expect(res.status).toBe(200);
		const log = await waitForLogByRequestId(requestId);
		expect(log?.estimatedCost).toBe(true);
		expect(Number(log?.promptTokens)).toBeGreaterThan(0);
		expect(Number(log?.cost)).toBeGreaterThan(0);
	});

	test("is not served on chat completions or /v1/systemone", async () => {
		await setupDecisionCarrier("airside-decide-chat-token");

		const chat = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-decide-chat-token",
			},
			body: JSON.stringify({
				model: "acme-decide/decide-fast",
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(chat.status).toBe(400);
		expect(await chat.text()).toContain("/v1/decisions");

		const systemOne = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-decide-chat-token",
			},
			body: JSON.stringify({
				model: "decide-fast",
				state: "hi",
				questions: {
					q: { type: "noul", instructions: "Is this an outage?" },
				},
			}),
		});
		expect(systemOne.status).toBe(400);
		expect(await systemOne.text()).toContain(
			"Use /v1/decisions for this model.",
		);
		expect(captured).toHaveLength(0);
	});

	test("rejects image input unless the listing declares it", async () => {
		await setupDecisionCarrier("airside-decide-image-token");
		const imageInput = [
			{
				role: "user",
				content: [
					{ type: "input_text", text: "Inspect this photo." },
					{ type: "input_image", image_url: "data:image/png;base64,iVBORw0=" },
				],
			},
		];

		const res = await postDecision("airside-decide-image-token", {
			model: "acme-decide/decide-fast",
			input: imageInput,
			questions: [QUESTIONS[0]],
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);

		await db
			.update(tables.modelProviderMapping)
			.set({ vision: true })
			.where(eq(tables.modelProviderMapping.modelId, "decide-fast"));
		await clearCache();
		const allowed = await postDecision("airside-decide-image-token", {
			model: "acme-decide/decide-fast",
			input: imageInput,
			questions: [QUESTIONS[0]],
		});
		expect(allowed.status).toBe(200);
		expect(captured).toHaveLength(1);
	});

	test("does not serve a paused listing", async () => {
		await setupDecisionCarrier("airside-decide-paused-token", {
			status: "inactive",
		});

		const res = await postDecision("airside-decide-paused-token", {
			model: "acme-decide/decide-fast",
			input: "hi",
			questions: [QUESTIONS[0]],
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("applies the carrier's own rate limit", async () => {
		await setupDecisionCarrier("airside-decide-rate-token");
		await db.insert(tables.providerDraftModel).values({
			id: "airside-decide-rate-token-model",
			providerCompanyId: "airside-decide-rate-token-company",
			providerId: "acme-decide",
			modelName: "decide-fast",
			externalId: "decide-fast-2",
			decisions: true,
			streaming: false,
			maxRpm: 1,
			status: "active",
		});
		await clearCache();

		const send = async (input: string) =>
			await postDecision("airside-decide-rate-token", {
				model: "acme-decide/decide-fast",
				input,
				questions: [QUESTIONS[0]],
			});
		expect((await send("first")).status).toBe(200);
		expect((await send("second")).status).toBe(429);
		expect(captured).toHaveLength(1);
	});
});
