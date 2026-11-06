import { afterEach, describe, expect, test, vi } from "vitest";

import {
	AirsideGatewayInfrastructureError,
	createAirsideGatewayFetch,
	openAirsideInference,
	sealAirsideInference,
	signAirsideInferenceResponse,
} from "./airside-gateway-inference.js";

import type { AirsideInferencePayload } from "./airside-gateway-inference.js";

const payload: AirsideInferencePayload = {
	runId: "verification-run",
	target: {
		providerId: "openai",
		modelName: "unpublished-model",
		externalId: "exact-deployment",
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
	pricing: { inputPrice: "0.000001", outputPrice: "0.000002" },
	endpoint: "https://provider.example/v1/chat/completions",
	headers: {
		Authorization: `Bearer ${["provider", "credential", "fixture"].join("-")}`,
	},
	body: JSON.stringify({ model: "exact-deployment", messages: [] }),
};

const operatorToken = ["operator", "key", "fixture"].join("-");
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("internal Airside inference transport", () => {
	test("encrypts credentials and exact snapshot, binds run and operator key", () => {
		const envelope = sealAirsideInference(payload, operatorToken);
		expect(
			JSON.stringify(envelope).includes(payload.headers.Authorization),
		).toBe(false);
		expect(JSON.stringify(envelope).includes(payload.endpoint)).toBe(false);
		expect(openAirsideInference(envelope, operatorToken).payload).toEqual(
			payload,
		);
		expect(() =>
			openAirsideInference(envelope, "another-operator-key"),
		).toThrow("Invalid internal inference envelope");
		for (const field of [
			"runId",
			"nonce",
			"keyHash",
			"ciphertext",
			"signature",
		] as const) {
			expect(() =>
				openAirsideInference(
					{ ...envelope, [field]: `${envelope[field]}x` },
					operatorToken,
				),
			).toThrow("Invalid internal inference envelope");
		}
		expect(() =>
			openAirsideInference(
				{ ...envelope, expiresAt: Date.now() - 1 },
				operatorToken,
			),
		).toThrow("Invalid internal inference envelope");
	});

	test.each([401, 402, 403, 404, 409, 429, 500])(
		"classifies unmarked gateway %i as infrastructure, never provider failure",
		async (status) => {
			vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", operatorToken);
			vi.stubEnv("GATEWAY_URL", "https://gateway.example");
			const failed = vi.fn();
			const request = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response("unavailable", { status }));
			const transport = createAirsideGatewayFetch({
				...payload,
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
			expect(request).toHaveBeenCalledOnce();
		},
	);

	test("response signatures remain verifiable during hash-secret rotation", () => {
		const oldSecret = ["old", "rotation", "fixture"].join("-");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", oldSecret);
		const envelope = sealAirsideInference(payload, operatorToken);
		const expected = signAirsideInferenceResponse(envelope, 200);
		vi.stubEnv(
			"GATEWAY_API_KEY_HASH_SECRET",
			`${["new", "rotation", "fixture"].join("-")},${oldSecret}`,
		);
		expect(
			openAirsideInference(envelope, operatorToken).payload.target.externalId,
		).toBe(payload.target.externalId);
		expect(signAirsideInferenceResponse(envelope, 200) === expected).toBe(true);
	});

	test("preserves unbounded pricing tiers and peak prices through encryption", () => {
		const rates = { inputPrice: "0.000003", outputPrice: "0.000004" };
		const pricing = {
			...payload.pricing,
			peakPricing: {
				peak: rates,
				offPeak: rates,
				hoursUtc: [[0, 24] as [number, number]],
			},
			pricingTiers: [
				{
					name: "unbounded",
					upToTokens: Infinity,
					...rates,
					peakPricing: { peak: rates, offPeak: rates },
				},
			],
		};
		const opened = openAirsideInference(
			sealAirsideInference({ ...payload, pricing }, operatorToken),
			operatorToken,
		).payload;
		expect(opened.pricing.pricingTiers?.[0].upToTokens).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(opened.pricing.pricingTiers?.[0].peakPricing).toEqual(
			pricing.pricingTiers[0].peakPricing,
		);
		expect(opened.pricing.peakPricing).toEqual(pricing.peakPricing);
	});

	test.each([true, false])(
		"authenticates streamed infrastructure markers across chunk boundaries (valid %s)",
		async (valid) => {
			vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", operatorToken);
			vi.stubEnv("GATEWAY_URL", "https://gateway.example");
			const failed = vi.fn();
			vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
				const envelope = JSON.parse(String(init?.body)) as ReturnType<
					typeof sealAirsideInference
				>;
				const signature = valid
					? signAirsideInferenceResponse(envelope, 0)
					: "0".repeat(64);
				const text = `event: airside-infrastructure-error\ndata: ${signature}\n\n`;
				let offset = 0;
				return new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							if (offset >= text.length) {
								controller.close();
								return;
							}
							controller.enqueue(
								new TextEncoder().encode(text.slice(offset, offset + 7)),
							);
							offset += 7;
						},
					}),
					{
						headers: {
							"content-type": "text/event-stream",
							"x-airside-inference": signAirsideInferenceResponse(
								envelope,
								200,
							),
						},
					},
				);
			});
			const response = await createAirsideGatewayFetch({
				...payload,
				onInfrastructureError: failed,
			})(payload.endpoint, {
				method: "POST",
				headers: payload.headers,
				body: payload.body,
			});
			if (valid) {
				await expect(response.text()).rejects.toBeInstanceOf(
					AirsideGatewayInfrastructureError,
				);
				expect(failed).toHaveBeenCalledOnce();
			} else {
				expect(await response.text()).toContain("airside-infrastructure-error");
				expect(failed).not.toHaveBeenCalled();
			}
		},
	);

	test("missing configuration is infrastructure without a direct-fetch fallback", async () => {
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", "");
		const failed = vi.fn();
		const request = vi.spyOn(globalThis, "fetch");
		await expect(
			createAirsideGatewayFetch({ ...payload, onInfrastructureError: failed })(
				payload.endpoint,
				{ method: "POST", body: payload.body },
			),
		).rejects.toBeInstanceOf(AirsideGatewayInfrastructureError);
		expect(failed).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
	});

	test("sends only operator auth and ciphertext to gateway, preserves trusted IP header and signed provider errors", async () => {
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", operatorToken);
		vi.stubEnv("GATEWAY_URL", "https://gateway.example");
		vi.stubEnv("CLIENT_IP_HEADER", "x-client-ip");
		const failed = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			expect(new URL(request.url).pathname).toBe(
				"/v1/internal/airside/inference",
			);
			expect(
				request.headers.get("authorization") === `Bearer ${operatorToken}`,
			).toBe(true);
			expect(request.headers.has("x-forwarded-for")).toBe(false);
			expect(request.headers.get("x-client-ip")).toBe("198.51.100.20");
			const envelope = (await request.json()) as ReturnType<
				typeof sealAirsideInference
			>;
			expect(
				openAirsideInference(envelope, operatorToken).payload.target.externalId,
			).toBe("exact-deployment");
			return new Response("provider rejected capability", {
				status: 400,
				headers: {
					"x-airside-inference": signAirsideInferenceResponse(envelope, 400),
				},
			});
		});
		const response = await createAirsideGatewayFetch({
			...payload,
			incomingHeaders: {
				"x-client-ip": "198.51.100.20",
				"x-forwarded-for": "203.0.113.99",
			},
			onInfrastructureError: failed,
		})(payload.endpoint, {
			method: "POST",
			headers: payload.headers,
			body: payload.body,
		});
		expect(response.status).toBe(400);
		expect(failed).not.toHaveBeenCalled();
	});
});
