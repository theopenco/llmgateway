import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { airsideInferenceUsage } from "@/internal/airside-inference.js";
import { waitForPendingWork } from "@/lib/pending-work.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "@/test-utils/test-helpers.js";

import {
	AIRSIDE_INFERENCE_PATH,
	AirsideGatewayInfrastructureError,
	createAirsideGatewayFetch,
	sealAirsideInference,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { resolvePathRateLimit } from "@llmgateway/shared";
import {
	hashApiKeyForStorage,
	getApiKeyFingerprint,
} from "@llmgateway/shared/api-key-hash";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import type { AirsideInferencePayload } from "@llmgateway/actions";

const operatorToken = ["airside", "operator", "fixture"].join("-");
const providerToken = ["provider", "pending", "fixture"].join("-");
const payload: AirsideInferencePayload = {
	runId: "unpublished-verification",
	providerKeyId: "pending-key-fixture",
	target: {
		providerId: "openai",
		modelName: "unpublished-model-fixture",
		externalId: "pending-deployment",
		apiFormat: "openai-chat-completions",
		streaming: true,
		vision: false,
		audio: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		reasoningEfforts: null,
		webSearch: false,
	},
	pricing: {
		inputPrice: "0.000001",
		outputPrice: "0.000002",
		cachedInputPrice: "0.0000005",
		requestPrice: "0.001",
	},
	endpoint: "http://localhost:19091/pending/chat/completions",
	headers: {
		Authorization: `Bearer ${providerToken}`,
		"content-type": "application/json",
	},
	body: JSON.stringify({
		model: "pending-deployment",
		stream: false,
		messages: [{ role: "user", content: "fixture" }],
	}),
};

function request(
	envelope = sealAirsideInference(payload, operatorToken),
	token = operatorToken,
) {
	return app.request(AIRSIDE_INFERENCE_PATH, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(envelope),
	});
}

function installUpstream(
	upstream: (request: Request) => Promise<Response> | Response,
) {
	const calls: Request[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const req = new Request(input, init);
		if (new URL(req.url).hostname === "gateway.example") {
			return await app.fetch(req);
		}
		calls.push(req);
		return await upstream(req);
	});
	return calls;
}

describe("signed exact Airside inference", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", operatorToken);
		vi.stubEnv("GATEWAY_URL", "https://gateway.example");
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "operator-api-key",
			...hashApiKeyForStorage(operatorToken),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Operator fixture",
		});
		await db.insert(tables.providerKey).values({
			id: payload.providerKeyId!,
			provider: "openai",
			managed: true,
			status: "inactive",
			tokenCiphertext: encryptProviderKey(
				providerToken,
				payload.providerKeyId!,
				"managed",
			),
			tokenHash: getApiKeyFingerprint(providerToken),
			tokenMasked: "fixture",
		});
	});
	afterEach(async () => {
		await waitForPendingWork(5000);
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test("logs and bills the operator project with exact pending target and credential, no cache", async () => {
		const calls = installUpstream(async (req) => {
			expect(req.url).toBe(payload.endpoint);
			expect(
				req.headers.get("authorization") === `Bearer ${providerToken}`,
			).toBe(true);
			expect(await req.json()).toEqual(JSON.parse(payload.body));
			return Response.json({
				choices: [{ message: { content: "verified" } }],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					prompt_tokens_details: { cached_tokens: 10 },
				},
			});
		});
		const transport = createAirsideGatewayFetch(payload);
		for (let index = 0; index < 2; index++) {
			const response = await transport(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: payload.body,
			});
			expect(response.status).toBe(200);
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.projectId).toBe("project-id");
			expect(log.apiKeyId).toBe("operator-api-key");
			expect(log.usedMode).toBe("credits");
			expect(log.providerKeyId).toBe(payload.providerKeyId);
			expect(log.usedModelMapping).toBe(payload.target.externalId);
			expect(log.cached).toBe(false);
			expect(log.cost).toBeCloseTo(0.001135);
			expect(JSON.stringify(log).includes(providerToken)).toBe(false);
			expect(log.rawRequest).toBeNull();
		}
		expect(calls).toHaveLength(2);
	});

	test.each([undefined, "eu-west-1"])(
		"stores canonical provider/model attribution including region %s",
		async (region) => {
			installUpstream(() =>
				Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
			);
			const response = await request(
				sealAirsideInference(
					{ ...payload, target: { ...payload.target, region } },
					operatorToken,
				),
			);
			expect(response.status).toBe(200);
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.usedModel).toBe(
				region
					? "openai/unpublished-model-fixture:eu-west-1"
					: "openai/unpublished-model-fixture",
			);
			expect(log.usedProvider).toBe(payload.target.providerId);
			expect(log.usedModelMapping).toBe(payload.target.externalId);
		},
	);

	test("public operator auth alone, tampering, expired envelope and wrong key cannot override deployment", async () => {
		const calls = installUpstream(() => Response.json({}));
		const envelope = sealAirsideInference(payload, operatorToken);
		for (const invalid of [
			{},
			{ ...envelope, runId: "different-run" },
			{ ...envelope, expiresAt: Date.now() - 1 },
			{ ...envelope, ciphertext: `${envelope.ciphertext}x` },
		]) {
			const response = await request(invalid as typeof envelope);
			expect(response.status).toBe(403);
		}
		expect((await request(envelope, "invalid-customer-key")).status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test.each([
		{ format: "json", reported: false, normalized: false },
		{ format: "sse", reported: false, normalized: false },
		{ format: "sse", reported: false, normalized: true },
		{ format: "response.failed", reported: false, normalized: true },
		{ format: "json", reported: true, normalized: false },
		{ format: "sse", reported: true, normalized: true },
	])(
		"accounts explicit HTTP200 $format provider errors (usage $reported, normalized $normalized)",
		async ({ format, reported, normalized }) => {
			const error = { message: `provider failed ${providerToken}` };
			const usage = reported
				? { usage: { prompt_tokens: 10, completion_tokens: 2 } }
				: {};
			const body =
				format === "response.failed"
					? { type: "response.failed", response: { error } }
					: { type: "error", error, ...usage };
			installUpstream(() =>
				format === "json"
					? Response.json(body)
					: new Response(`event: error\ndata: ${JSON.stringify(body)}\n\n`, {
							headers: { "content-type": "text/event-stream" },
						}),
			);
			const infrastructure = vi.fn();
			const response = await createAirsideGatewayFetch({
				...payload,
				responseFormat: normalized ? "openai-chat-completions" : undefined,
				onInfrastructureError: infrastructure,
			})(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: JSON.stringify({
					messages: [{ role: "user", content: "x".repeat(80_000) }],
				}),
			});
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).not.toContain(providerToken);
			if (normalized) {
				expect(text).toContain("provider_error");
			}
			expect(infrastructure).not.toHaveBeenCalled();
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.hasError).toBe(true);
			expect(log.providerKeyId).toBe(payload.providerKeyId);
			expect(log.promptTokens).toBe(reported ? "10" : "0");
			expect(log.completionTokens).toBe(reported ? "2" : null);
			expect(log.estimatedCost).toBe(false);
			expect(log.cost).toBeCloseTo(reported ? 0.001014 : 0);
		},
	);

	test("replay fails closed and no fallback follows provider failure", async () => {
		const calls = installUpstream(
			() => new Response(`bad ${providerToken}`, { status: 500 }),
		);
		const envelope = sealAirsideInference(payload, operatorToken);
		const first = await request(envelope);
		expect(first.status).toBe(500);
		expect((await first.text()).includes(providerToken)).toBe(false);
		expect((await request(envelope)).status).toBe(409);
		expect(calls).toHaveLength(1);
		const log = await waitForLogByRequestId(first.headers.get("x-request-id")!);
		expect(log.hasError).toBe(true);
		expect(log.cost).toBe(0);
	});

	test.each(["credits", "IAM", "customer credential", "deleted credential"])(
		"enforces %s before upstream dispatch",
		async (gate) => {
			const calls = installUpstream(() => Response.json({}));
			if (gate === "credits") {
				await harness.setOrganizationCredits("0");
			}
			if (gate === "IAM") {
				await db.insert(tables.apiKeyIamRule).values({
					id: "deny-pending-model",
					apiKeyId: "operator-api-key",
					ruleType: "deny_models",
					ruleValue: { models: [payload.target.modelName] },
					status: "active",
				});
			}
			if (gate === "customer credential") {
				await db
					.update(tables.providerKey)
					.set({ managed: false, organizationId: "org-id" })
					.where(eq(tables.providerKey.id, payload.providerKeyId!));
			}
			if (gate === "deleted credential") {
				await db
					.update(tables.providerKey)
					.set({ status: "deleted" })
					.where(eq(tables.providerKey.id, payload.providerKeyId!));
			}
			await clearCache();
			expect((await request()).status).toBe(gate === "credits" ? 402 : 403);
			expect(calls).toHaveLength(0);
		},
	);

	test("forwards only the configured client IP through transport and enforces IP IAM", async () => {
		vi.stubEnv("CLIENT_IP_HEADER", "x-client-ip");
		await db.insert(tables.apiKeyIamRule).values({
			id: "operator-ip-rule",
			apiKeyId: "operator-api-key",
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["198.51.100.0/24"] },
			status: "active",
		});
		const calls = installUpstream(() =>
			Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
		);
		const failed = vi.fn();
		const transport = createAirsideGatewayFetch({
			...payload,
			incomingHeaders: {
				"x-client-ip": "203.0.113.5",
				"x-forwarded-for": "198.51.100.5",
			},
			onInfrastructureError: failed,
		});
		await expect(
			transport(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: payload.body,
			}),
		).rejects.toBeInstanceOf(AirsideGatewayInfrastructureError);
		expect(failed).toHaveBeenCalledOnce();
		expect(calls).toHaveLength(0);
	});

	test("rejects private upstream destinations without a provider marker", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const calls = installUpstream(() => Response.json({}));
		const response = await request(
			sealAirsideInference(
				{ ...payload, endpoint: "https://169.254.169.254/latest/meta-data" },
				operatorToken,
			),
		);
		expect(response.status).toBe(502);
		expect(response.headers.has("x-airside-inference")).toBe(false);
		expect(calls).toHaveLength(0);
	});

	test.each([false, true])(
		"delivers streaming frames before upstream completes (normalization %s), logs final usage",
		async (normalize) => {
			let release: (() => void) | undefined;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			installUpstream(
				() =>
					new Response(
						new ReadableStream<Uint8Array>({
							async start(controller) {
								const encode = (value: unknown) =>
									new TextEncoder().encode(
										`data: ${JSON.stringify(value)}\n\n`,
									);
								controller.enqueue(
									encode({
										id: "fixture",
										choices: [{ delta: { content: "first token" } }],
									}),
								);
								await gate;
								controller.enqueue(
									encode({
										id: "fixture",
										choices: [],
										usage: { prompt_tokens: 100, completion_tokens: 20 },
									}),
								);
								controller.enqueue(
									new TextEncoder().encode("data: [DONE]\n\n"),
								);
								controller.close();
							},
						}),
						{ headers: { "content-type": "text/event-stream" } },
					),
			);
			const transport = createAirsideGatewayFetch({
				...payload,
				responseFormat: normalize ? "openai-chat-completions" : undefined,
			});
			const response = await transport(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: JSON.stringify({ ...JSON.parse(payload.body), stream: true }),
			});
			const reader = response.body!.getReader();
			try {
				const first = await reader.read();
				expect(new TextDecoder().decode(first.value)).toContain("first token");
			} finally {
				release!();
			}
			while (!(await reader.read()).done) {
				/* drain accounting tail */
			}
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.promptTokens).toBe("100");
			expect(log.completionTokens).toBe("20");
			expect(log.streamed).toBe(true);
			expect(log.hasError).toBe(false);
		},
	);

	test.each([
		{
			provider: "anthropic",
			apiFormat: "provider-native" as const,
			frames: [
				{
					type: "message_start",
					message: { id: "fixture", usage: { input_tokens: 12 } },
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "native content" },
				},
				{
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 4 },
				},
			],
		},
		{
			provider: "google-vertex",
			apiFormat: "google-vertex" as const,
			frames: [
				{
					candidates: [
						{
							index: 0,
							content: { role: "model", parts: [{ text: "native content" }] },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 12,
						candidatesTokenCount: 4,
						totalTokenCount: 16,
					},
				},
			],
		},
		{
			provider: "openai",
			apiFormat: "openai-responses" as const,
			frames: [
				{
					type: "response.output_text.delta",
					delta: "native content",
					output_index: 0,
				},
				{
					type: "response.completed",
					response: {
						id: "fixture",
						status: "completed",
						usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
					},
				},
			],
		},
	])(
		"normalizes exact $provider native streams without capability inheritance",
		async ({ provider, apiFormat, frames }) => {
			await db
				.update(tables.providerKey)
				.set({ provider })
				.where(eq(tables.providerKey.id, payload.providerKeyId!));
			const calls = installUpstream(
				() =>
					new Response(
						frames
							.map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
							.join(""),
						{ headers: { "content-type": "text/event-stream" } },
					),
			);
			const transport = createAirsideGatewayFetch({
				...payload,
				target: { ...payload.target, providerId: provider, apiFormat },
				responseFormat: "openai-chat-completions",
			});
			const response = await transport(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: payload.body,
			});
			const text = await response.text();
			expect(text).toContain("native content");
			expect(text).toContain("[DONE]");
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.promptTokens).toBe("12");
			expect(log.completionTokens).toBe("4");
			expect(calls).toHaveLength(1);
		},
	);

	test("bills unbounded context tier and peak rates from the signed snapshot", async () => {
		installUpstream(() =>
			Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 } }),
		);
		const rates = { inputPrice: "0.000003", outputPrice: "0.000004" };
		const pricing = {
			...payload.pricing,
			requestPrice: "0",
			peakPricing: {
				peak: rates,
				offPeak: rates,
				hoursUtc: [[0, 24] as [number, number]],
			},
			pricingTiers: [
				{
					name: "all-contexts",
					upToTokens: Infinity,
					inputPrice: "1",
					outputPrice: "1",
					peakPricing: { peak: rates, offPeak: rates },
				},
			],
		};
		const response = await request(
			sealAirsideInference({ ...payload, pricing }, operatorToken),
		);
		expect(response.status).toBe(200);
		const log = await waitForLogByRequestId(
			response.headers.get("x-request-id")!,
		);
		expect(log.cost).toBeCloseTo(0.00038);
		expect(log.pricingTier).toBe("all-contexts");
	});

	test.each(["openai-chat-completions", "google-vertex"] as const)(
		"bills mixed text/audio and reasoning details using exact %s usage",
		async (apiFormat) => {
			installUpstream(() =>
				Response.json(
					apiFormat === "google-vertex"
						? {
								usageMetadata: {
									promptTokenCount: 100,
									candidatesTokenCount: 15,
									thoughtsTokenCount: 5,
									totalTokenCount: 120,
									cachedContentTokenCount: 20,
									promptTokensDetails: [
										{ modality: "TEXT", tokenCount: 60 },
										{ modality: "AUDIO", tokenCount: 40 },
									],
									cacheTokensDetails: [
										{ modality: "TEXT", tokenCount: 10 },
										{ modality: "AUDIO", tokenCount: 10 },
									],
								},
							}
						: {
								usage: {
									prompt_tokens: 100,
									completion_tokens: 20,
									total_tokens: 120,
									prompt_tokens_details: {
										cached_tokens: 20,
										audio_tokens: 40,
										cached_tokens_details: { audio_tokens: 10 },
									},
									completion_tokens_details: { reasoning_tokens: 5 },
								},
							},
				),
			);
			const pricing = {
				...payload.pricing,
				requestPrice: "0",
				inputAudioPrice: "0.00001",
				cachedInputAudioPrice: "0.000002",
			};
			const body =
				apiFormat === "google-vertex"
					? {
							contents: [
								{
									parts: [
										{ text: "fixture" },
										{ inlineData: { mimeType: "audio/wav", data: "fixture" } },
									],
								},
							],
						}
					: {
							messages: [
								{
									role: "user",
									content: [
										{ type: "text", text: "fixture" },
										{
											type: "input_audio",
											input_audio: { format: "wav", data: "fixture" },
										},
									],
								},
							],
						};
			const response = await createAirsideGatewayFetch({
				...payload,
				target: { ...payload.target, apiFormat, audio: true },
				pricing,
			})(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: JSON.stringify(body),
			});
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.audioInputTokens).toBe("40");
			expect(log.reasoningTokens).toBe("5");
			expect(log.completionTokens).toBe("20");
			expect(log.inputCost).toBeCloseTo(0.00005);
			expect(log.audioInputCost).toBeCloseTo(0.0003);
			expect(log.cachedInputCost).toBeCloseTo(0.000025);
			expect(log.cost).toBeCloseTo(0.000415);
		},
	);

	test.each([false, true])(
		"derives explicit cache-read billing structurally (marker %s)",
		async (explicit) => {
			installUpstream(() =>
				Response.json({
					usage: {
						prompt_tokens: 100,
						completion_tokens: 0,
						prompt_tokens_details: { cached_tokens: 80 },
					},
				}),
			);
			const body = {
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "cache_control is ordinary text",
								...(explicit ? { cache_control: { type: "ephemeral" } } : {}),
							},
						],
					},
				],
			};
			const pricing = {
				...payload.pricing,
				requestPrice: "0",
				cachedInputPrice: "0.0000002",
				cacheReadInputPrice: "0.0000001",
			};
			const response = await createAirsideGatewayFetch({ ...payload, pricing })(
				payload.endpoint,
				{
					method: "POST",
					headers: payload.headers,
					body: JSON.stringify(body),
				},
			);
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.cost).toBeCloseTo(explicit ? 0.000028 : 0.000036);
		},
	);

	test.each([false, true])(
		"counts actual native vision input, not target capability (image %s)",
		async (image) => {
			installUpstream(() =>
				Response.json({
					usage: {
						prompt_tokens: 100,
						completion_tokens: 0,
						prompt_tokens_details: image ? { image_tokens: 50 } : {},
					},
				}),
			);
			const body = {
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "fixture" },
							...(image
								? [
										{
											type: "image_url",
											image_url: { url: "data:image/png;base64,fixture" },
										},
									]
								: []),
						],
					},
				],
			};
			const pricing = {
				...payload.pricing,
				requestPrice: "0",
				imageInputPrice: "0.000001",
				cachedImageInputPrice: "0.0000005",
				imageInputTokensByResolution: { default: 7 },
			};
			const response = await createAirsideGatewayFetch({
				...payload,
				target: { ...payload.target, vision: true },
				pricing,
			})(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: JSON.stringify(body),
			});
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.imageInputTokens).toBe(image ? "50" : null);
			if (image) {
				expect(log.imageInputCost).toBeCloseTo(0.000007);
			} else {
				expect(log.imageInputCost).toBeNull();
			}
		},
	);

	test("streams beyond 32MiB of framing with bounded frames and numeric output accounting", async () => {
		const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }], metadata: "m".repeat(300_000) })}\n\n`;
		const batch = new TextEncoder().encode(frame.repeat(4));
		let batches = 0;
		installUpstream(
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							if (batches++ < 32) {
								controller.enqueue(batch);
							} else {
								controller.close();
							}
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const response = await createAirsideGatewayFetch(payload)(
			payload.endpoint,
			{ method: "POST", headers: payload.headers, body: payload.body },
		);
		const reader = response.body!.getReader();
		let bytes = 0;
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			bytes += chunk.value.byteLength;
		}
		expect(bytes).toBeGreaterThan(32 * 1024 * 1024);
		const log = await waitForLogByRequestId(
			response.headers.get("x-request-id")!,
		);
		expect(log.hasError).toBe(false);
		expect(log.completionTokens).toBe("32");
	});

	test.each(["frame limit", "normalization"])(
		"signed internal %s failures notify infrastructure, not provider health",
		async (kind) => {
			installUpstream(
				() =>
					new Response(
						kind === "frame limit"
							? `data: ${JSON.stringify({ metadata: "x".repeat(1024 * 1024) })}\n\n`
							: "data: null\n\n",
						{ headers: { "content-type": "text/event-stream" } },
					),
			);
			const failed = vi.fn();
			const response = await createAirsideGatewayFetch({
				...payload,
				responseFormat:
					kind === "normalization" ? "openai-chat-completions" : undefined,
				onInfrastructureError: failed,
			})(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: payload.body,
			});
			await expect(response.text()).rejects.toBeInstanceOf(
				AirsideGatewayInfrastructureError,
			);
			expect(failed).toHaveBeenCalledOnce();
		},
	);

	test("nonstream internal body limit returns an unsigned infrastructure response", async () => {
		const chunk = new Uint8Array(1024 * 1024).fill(120);
		let chunks = 0;
		installUpstream(
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							if (chunks++ < 33) {
								controller.enqueue(chunk);
							} else {
								controller.close();
							}
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
		);
		const response = await request();
		expect(response.status).toBe(503);
		expect(response.headers.has("x-airside-inference")).toBe(false);
	});

	test.each([false, true])(
		"estimates only rendered text, excluding request/response framing (streaming %s)",
		async (streaming) => {
			const metadata = "metadata".repeat(10_000);
			installUpstream(() =>
				streaming
					? new Response(
							`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }], metadata })}\n\ndata: [DONE]\n\n`,
							{ headers: { "content-type": "text/event-stream" } },
						)
					: Response.json({
							choices: [{ message: { content: "ok" } }],
							metadata,
						}),
			);
			const body = JSON.stringify({
				...JSON.parse(payload.body),
				stream: streaming,
				metadata,
			});
			const response = await createAirsideGatewayFetch(payload)(
				payload.endpoint,
				{ method: "POST", headers: payload.headers, body },
			);
			await response.text();
			const log = await waitForLogByRequestId(
				response.headers.get("x-request-id")!,
			);
			expect(log.promptTokens).toBe("2");
			expect(log.completionTokens).toBe("1");
			expect(log.estimatedCost).toBe(true);
		},
	);

	test("cancel without output usage records unavailable count and never estimates unseen output", async () => {
		installUpstream(
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								new TextEncoder().encode(
									`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
								),
							);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const abort = new AbortController();
		const response = await createAirsideGatewayFetch(payload)(
			payload.endpoint,
			{
				method: "POST",
				headers: payload.headers,
				body: payload.body,
				signal: abort.signal,
			},
		);
		const reader = response.body!.getReader();
		await reader.read();
		abort.abort();
		await reader.cancel();
		await waitForPendingWork(5000);
		const log = await waitForLogByRequestId(
			response.headers.get("x-request-id")!,
		);
		expect(log.canceled).toBe(true);
		expect(log.completionTokens).toBeNull();
		expect(log.outputCost).toBe(0);
		expect(log.estimatedCost).toBe(true);
	});

	test("cancel logs reported partial usage without fabricating unseen output", async () => {
		let canceled = false;
		installUpstream(
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								new TextEncoder().encode(
									`data: ${JSON.stringify({ id: "fixture", choices: [{ delta: { content: "partial" } }], usage: { prompt_tokens: 40, completion_tokens: 3 } })}\n\n`,
								),
							);
						},
						cancel() {
							canceled = true;
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const abort = new AbortController();
		const response = await createAirsideGatewayFetch(payload)(
			payload.endpoint,
			{
				method: "POST",
				headers: payload.headers,
				body: payload.body,
				signal: abort.signal,
			},
		);
		const reader = response.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"partial",
		);
		abort.abort();
		await reader.cancel();
		await waitForPendingWork(5000);
		const log = await waitForLogByRequestId(
			response.headers.get("x-request-id")!,
		);
		expect(canceled).toBe(true);
		expect(log.canceled).toBe(true);
		expect(log.completionTokens).toBe("3");
		expect(log.outputCost).toBeCloseTo(0.000006);
	});

	test("native usage keeps Anthropic message_start input across output-only frames", () => {
		const text = [
			'data: {"type":"message_start","message":{"usage":{"input_tokens":80,"cache_read_input_tokens":20}}}',
			"",
			'data: {"type":"message_delta","usage":{"output_tokens":12}}',
			"",
		].join("\n");
		expect(
			airsideInferenceUsage(text, "anthropic", "text/event-stream"),
		).toMatchObject({ input: 100, output: 12, cached: 20 });
		expect(resolvePathRateLimit(AIRSIDE_INFERENCE_PATH)?.key).toBe(
			resolvePathRateLimit("/v1/chat/completions")?.key,
		);
	});
});

test("native search accounting counts operations and respects authoritative counters", () => {
	const events = [
		'data: {"type":"response.web_search_call.completed"}',
		"",
		'data: {"type":"response.web_search_call.completed"}',
		"",
		'data: {"type":"response.completed","response":{"usage":{"server_tool_use":{"tool_search":0,"tool_fetch":0}}}}',
		"",
	].join("\n");
	expect(
		airsideInferenceUsage(events, "openai", "text/event-stream"),
	).toMatchObject({ searchEvents: 2, billedSearches: 0 });
	expect(
		airsideInferenceUsage(
			JSON.stringify({
				candidates: [
					{ groundingMetadata: { webSearchQueries: ["first", "second"] } },
				],
			}),
			"google-vertex",
			"application/json",
		),
	).toMatchObject({ searches: 2 });
	expect(
		airsideInferenceUsage(
			JSON.stringify({
				content: [
					{ type: "web_search_tool_result", content: [] },
					{
						type: "web_search_tool_result",
						content: { type: "web_search_tool_result_error" },
					},
				],
			}),
			"anthropic",
			"application/json",
		),
	).toMatchObject({ searches: 1 });
});
