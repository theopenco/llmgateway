import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

const inputImage = "data:image/png;base64,aGVsbG8=";
const usage = {
	input_tokens: 10,
	output_tokens: 400,
	total_tokens: 410,
	input_tokens_details: { text_tokens: 10, image_tokens: 0 },
	output_tokens_details: { image_tokens: 400 },
};

describe("image generation upstream streaming", () => {
	const harness = createGatewayApiTestHarness();
	const upstreamRequests: Array<{
		provider: string;
		endpoint: string;
		n: number;
		stream: unknown;
		partialImages: unknown;
		size?: unknown;
		quality?: unknown;
		moderation?: unknown;
		background?: unknown;
		outputFormat?: unknown;
		outputCompression?: unknown;
	}> = [];
	let failOpenai = false;
	let imageBase64Prefix = "";
	let rejectWith: string | undefined;
	let upstreamPrompt: unknown;

	beforeEach(async () => {
		upstreamRequests.length = 0;
		upstreamPrompt = undefined;
		failOpenai = false;
		imageBase64Prefix = "";
		rejectWith = undefined;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		for (const provider of ["openai", "azure"]) {
			const id = `provider-key-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				...encryptProviderKeyForStorage("test-token", id, "org-id"),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (!url.href.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}

			const multipart = init?.body instanceof FormData;
			const body =
				init?.body instanceof FormData
					? Object.fromEntries(init.body.entries())
					: (JSON.parse(String(init?.body)) as Record<string, unknown>);
			const n = Number(body.n ?? 1);
			const stream = body.stream === true || body.stream === "True";
			const provider = url.pathname.startsWith("/openai/") ? "azure" : "openai";
			const endpoint = url.pathname.includes("/images/edits")
				? "edits"
				: "generations";
			upstreamPrompt = body.prompt;
			upstreamRequests.push({
				provider,
				endpoint,
				n,
				stream: body.stream,
				partialImages: body.partial_images,
				size: body.size,
				quality: body.quality,
				moderation: body.moderation,
				background: body.background,
				outputFormat: body.output_format,
				outputCompression: body.output_compression,
			});
			if (endpoint === "edits") {
				expect(multipart).toBe(true);
				expect(body.image).toBeInstanceOf(Blob);
			}
			if (provider === "openai" && failOpenai) {
				return Response.json(
					{ error: { message: "Service unavailable" } },
					{ status: 503 },
				);
			}
			if (rejectWith) {
				return Response.json(
					{
						error: {
							message: rejectWith,
							type: "image_generation_user_error",
							code: "invalid_value",
						},
					},
					{ status: 400 },
				);
			}
			if (stream && n > 1) {
				return Response.json(
					{ error: { message: "Streaming is only supported with n=1." } },
					{ status: 400 },
				);
			}
			const data = Array.from({ length: n }, (_, i) => ({
				b64_json:
					imageBase64Prefix + Buffer.from(`image-${i}`).toString("base64"),
			}));
			if (stream) {
				const event = endpoint === "edits" ? "image_edit" : "image_generation";
				return new Response(
					`data: ${JSON.stringify({ type: `${event}.partial_image`, b64_json: "cGFydGlhbA==" })}\n\n` +
						`data: ${JSON.stringify({ type: `${event}.completed`, ...data[0], created_at: 1, usage })}\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			}
			return Response.json({ created: 1, data, usage });
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test.each(["openai", "azure"])(
		"%s returns multiple images to streaming chat clients",
		async (provider) => {
			const requestId = randomUUID();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-request-id": requestId,
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: `${provider}/gpt-image-2`,
					messages: [{ role: "user", content: "A blue circle" }],
					image_config: { n: 4 },
					stream: true,
				}),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
			const text = await res.text();
			for (let i = 0; i < 4; i++) {
				expect(text).toContain(Buffer.from(`image-${i}`).toString("base64"));
			}
			expect(text).toContain("data: [DONE]");
			expect(upstreamRequests).toEqual([
				{
					provider,
					endpoint: "generations",
					n: 4,
					stream: undefined,
					partialImages: undefined,
				},
			]);
			const log = await waitForLogByRequestId(requestId);
			expect(log.hasError).toBe(false);
		},
	);

	async function requestImages(
		endpoint: "generations" | "edits",
		provider: string,
		n: number | undefined,
		fallback = false,
	) {
		const requestId = randomUUID();
		const res = await app.request(`/v1/images/${endpoint}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
				...(fallback ? {} : { "x-no-fallback": "true" }),
			},
			body: JSON.stringify({
				model: fallback ? "gpt-image-2" : `${provider}/gpt-image-2`,
				prompt: "A blue circle",
				n,
				stream: false,
				...(endpoint === "edits" && { images: [{ image_url: inputImage }] }),
			}),
		});
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toEqual(
			Array.from({ length: n ?? 1 }, (_, i) =>
				expect.objectContaining({
					b64_json: Buffer.from(`image-${i}`).toString("base64"),
				}),
			),
		);
		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(false);
		expect(Number(log.promptTokens)).toBe(usage.input_tokens);
		expect(Number(log.completionTokens)).toBe(usage.output_tokens);
		expect(json.usage).toMatchObject({
			input_tokens: usage.input_tokens,
			output_tokens: usage.output_tokens,
			output_tokens_details: { image_tokens: 400, text_tokens: 0 },
		});
		expect(json.usage.cost).toBeGreaterThan(0);
		expect(json.usage.cost).toBeCloseTo(Number(log.cost), 6);
	}

	describe.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])(
		"%s quality",
		(model) => {
			describe.each(["generations", "edits", "chat"])("%s", (endpoint) => {
				test.each(["xhigh", "max"])("forwards %s upstream", async (quality) => {
					const requestId = randomUUID();
					const res = await app.request(
						endpoint === "chat"
							? "/v1/chat/completions"
							: `/v1/images/${endpoint}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: "Bearer test-token",
								"x-request-id": requestId,
								"x-no-fallback": "true",
							},
							body: JSON.stringify({
								model: `openai/${model}`,
								...(endpoint === "chat"
									? {
											messages: [{ role: "user", content: "A blue circle" }],
											image_config: { image_quality: quality },
										}
									: { prompt: "A blue circle", quality }),
								...(endpoint === "edits" && {
									images: [{ image_url: inputImage }],
								}),
							}),
						},
					);
					const json = await res.json();
					expect(res.status, JSON.stringify(json)).toBe(200);
					expect(upstreamRequests).toHaveLength(1);
					expect(upstreamRequests[0]).toMatchObject({
						provider: "openai",
						endpoint: endpoint === "edits" ? "edits" : "generations",
						quality,
					});
					const log = await waitForLogByRequestId(requestId);
					expect(log.hasError).toBe(false);
					expect(Number(log.cost)).toBeCloseTo(0.01205, 10);
				});
			});
		},
	);

	describe.each(["openai", "azure"])("%s image output options", (provider) => {
		const model = `${provider}/gpt-image-2.5-sunburst`;
		const headers = {
			Authorization: "Bearer test-token",
			"x-no-fallback": "true",
		};
		const forwarded = {
			background: "transparent",
			outputFormat: "webp",
			outputCompression: "80",
		};

		test("forwards JSON edit options upstream", async () => {
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					prompt: "A blue circle",
					images: [{ image_url: inputImage }],
					background: "transparent",
					output_format: "webp",
					output_compression: 80,
				}),
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(upstreamRequests[0]).toMatchObject(forwarded);
			expect(upstreamPrompt).not.toContain("Background:");
			expect(upstreamPrompt).not.toContain("Output format:");
			expect(upstreamPrompt).not.toContain("Output compression:");
			expect(json).toMatchObject({
				background: "transparent",
				output_format: "webp",
			});
		});

		test("forwards multipart edit options upstream", async () => {
			const form = new FormData();
			form.append("model", model);
			form.append("prompt", "A blue circle");
			form.append(
				"image",
				new File([Buffer.from("hello")], "in.png", { type: "image/png" }),
			);
			form.append("background", "transparent");
			form.append("output_format", "webp");
			form.append("output_compression", "80");
			form.append("size", "1024x1024");
			form.append("quality", "low");
			form.append("moderation", "low");
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers,
				body: form,
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(upstreamRequests[0]).toMatchObject({
				...forwarded,
				size: "1024x1024",
				quality: "low",
				moderation: "low",
			});
		});

		test("returns the provider's rejection to the client", async () => {
			const message = "Transparent background is not supported for this model.";
			rejectWith = message;
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					prompt: "A blue circle",
					images: [{ image_url: inputImage }],
					background: "transparent",
				}),
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(400);
			expect(JSON.stringify(json)).toContain(message);
			expect(upstreamRequests).toHaveLength(1);
		});

		test("leaves chat image_config values for the provider to judge", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: "A blue circle" }],
					image_config: {
						background: "white",
						output_format: "jpg",
						output_compression: 85.5,
					},
				}),
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(upstreamRequests[0]).toMatchObject({
				background: "white",
				outputFormat: "jpg",
				outputCompression: 85.5,
			});
		});

		test("rejects an invalid multipart output_compression", async () => {
			const form = new FormData();
			form.append("model", model);
			form.append("prompt", "A blue circle");
			form.append(
				"image",
				new File([Buffer.from("hello")], "in.png", { type: "image/png" }),
			);
			form.append("output_compression", "high");
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers,
				body: form,
			});
			expect(res.status).toBe(400);
			expect(upstreamRequests).toHaveLength(0);
		});

		test.each([
			["background", "transparent", "background", "transparent"],
			["output_format", "webp", "outputFormat", "webp"],
			["output_compression", 0, "outputCompression", "0"],
		] as const)(
			"forwards %s=%s as the only option",
			async (field, value, captured, expected) => {
				const res = await app.request("/v1/images/edits", {
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({
						model,
						prompt: "A blue circle",
						images: [{ image_url: inputImage }],
						[field]: value,
					}),
				});
				expect(res.status).toBe(200);
				expect(upstreamRequests[0][captured]).toBe(expected);
			},
		);

		test("forwards chat image_config options on generations", async () => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: "A blue circle" }],
					image_config: {
						background: "transparent",
						output_format: "webp",
						output_compression: 80,
					},
				}),
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(upstreamRequests[0]).toMatchObject({
				background: "transparent",
				outputFormat: "webp",
				outputCompression: 80,
			});
		});

		test.each([
			["background", "transparent"],
			["output_format", "png"],
			["output_compression", 0],
		] as const)("records %s=%s on the log", async (field, value) => {
			const requestId = randomUUID();
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model,
					prompt: "A blue circle",
					images: [{ image_url: inputImage }],
					[field]: value,
				}),
			});
			expect(res.status).toBe(200);
			const log = await waitForLogByRequestId(requestId);
			expect(log.params).toMatchObject({ image_config: { [field]: value } });
		});

		test("omits the options when not requested", async () => {
			const res = await app.request("/v1/images/edits", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					prompt: "A blue circle",
					images: [{ image_url: inputImage }],
					quality: "low",
				}),
			});
			expect(res.status).toBe(200);
			expect(upstreamRequests[0].quality).toBe("low");
			expect(upstreamRequests[0].background).toBeUndefined();
			expect(upstreamRequests[0].outputFormat).toBeUndefined();
			expect(upstreamRequests[0].outputCompression).toBeUndefined();
		});

		test.each([
			[1, "UklGR", "webp"],
			[2, "UklGR", "webp"],
			[1, "/9j/", "jpeg"],
			[2, "/9j/", "jpeg"],
			[1, "iVBORw0KGgo", "png"],
			[1, "", "png"],
		])(
			"with n=%s labels bytes starting %s as image/%s",
			async (n, prefix, subtype) => {
				imageBase64Prefix = prefix;
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: "A blue circle" }],
						image_config: { n },
					}),
				});
				const json = await res.json();
				expect(res.status, JSON.stringify(json)).toBe(200);
				expect(json.choices[0].message.images[0].image_url.url).toMatch(
					new RegExp(`^data:image/${subtype};base64,`),
				);
			},
		);
	});

	describe.each(["openai", "azure"])("%s moderation", (provider) => {
		describe.each(["generations", "edits", "chat"])("%s", (endpoint) => {
			test.each(["auto", "low"])(
				"forwards moderation=%s upstream",
				async (moderation) => {
					const res = await app.request(
						endpoint === "chat"
							? "/v1/chat/completions"
							: `/v1/images/${endpoint}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: "Bearer test-token",
								"x-no-fallback": "true",
							},
							body: JSON.stringify({
								model: `${provider}/gpt-image-2`,
								...(endpoint === "chat"
									? {
											messages: [{ role: "user", content: "A blue circle" }],
											image_config: { moderation },
										}
									: { prompt: "A blue circle", moderation }),
								...(endpoint === "edits" && {
									images: [{ image_url: inputImage }],
								}),
							}),
						},
					);
					const json = await res.json();
					expect(res.status, JSON.stringify(json)).toBe(200);
					expect(upstreamRequests).toHaveLength(1);
					expect(upstreamRequests[0]).toMatchObject({
						provider,
						endpoint: endpoint === "edits" ? "edits" : "generations",
						moderation,
					});
				},
			);
		});

		test("omits moderation when not requested", async () => {
			const res = await app.request("/v1/images/generations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: `${provider}/gpt-image-2`,
					prompt: "A blue circle",
				}),
			});
			expect(res.status).toBe(200);
			expect(upstreamRequests[0].moderation).toBeUndefined();
		});

		test("rejects an unsupported moderation value", async () => {
			const res = await app.request("/v1/images/generations", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
				},
				body: JSON.stringify({
					model: `${provider}/gpt-image-2`,
					prompt: "A blue circle",
					moderation: "strict",
				}),
			});
			expect(res.status).toBe(400);
			expect(upstreamRequests).toHaveLength(0);
		});
	});

	describe.each(["generations", "edits"] as const)("%s", (endpoint) => {
		describe.each(["openai", "azure"])("%s", (provider) => {
			test.each([undefined, 1, 4, 10])(
				"returns images with n=%s",
				async (n) => {
					await requestImages(endpoint, provider, n);
					expect(upstreamRequests).toEqual([
						{
							provider,
							endpoint,
							n: n ?? 1,
							stream:
								(n ?? 1) > 1 ? undefined : endpoint === "edits" ? "True" : true,
							partialImages:
								(n ?? 1) > 1 ? undefined : endpoint === "edits" ? "1" : 1,
						},
					]);
				},
			);
		});

		test.each([1, 4])("preserves n=%s after provider fallback", async (n) => {
			failOpenai = true;
			await harness.setRoutingMetrics("gpt-image-2", "openai", {
				uptime: 100,
				latency: 1,
				throughput: 1000,
			});
			await harness.setRoutingMetrics("gpt-image-2", "azure", {
				uptime: 99,
				latency: 1000,
				throughput: 10,
			});
			await requestImages(endpoint, "openai", n, true);
			expect(upstreamRequests.map((request) => request.provider)).toEqual([
				"openai",
				"azure",
			]);
			for (const request of upstreamRequests) {
				expect(request).toMatchObject({
					endpoint,
					n,
					stream: n > 1 ? undefined : endpoint === "edits" ? "True" : true,
					partialImages: n > 1 ? undefined : endpoint === "edits" ? "1" : 1,
				});
			}
		});
	});
});

describe("image service tiers", () => {
	const harness = createGatewayApiTestHarness();
	const upstreamBodies: Array<Record<string, unknown>> = [];
	let textOnly = false;

	beforeEach(async () => {
		upstreamBodies.length = 0;
		textOnly = false;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		for (const provider of ["openai", "google-ai-studio"]) {
			const id = `provider-key-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				...encryptProviderKeyForStorage("test-token", id, "org-id"),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (!url.href.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			upstreamBodies.push(JSON.parse(String(init?.body)));
			return Response.json(
				{
					candidates: [
						{
							content: {
								parts: textOnly
									? [{ text: "I cannot draw that." }]
									: [
											{
												inlineData: {
													mimeType: "image/png",
													data: Buffer.from("image").toString("base64"),
												},
											},
										],
								role: "model",
							},
							finishReason: "STOP",
							index: 0,
						},
					],
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 1120,
						totalTokenCount: 1130,
					},
				},
				{ headers: { "x-gemini-service-tier": "flex" } },
			);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe.each(["generations", "edits"])("%s", (endpoint) => {
		const requestImages = (
			model: string,
			service_tier: string,
			requestId = randomUUID(),
		) =>
			app.request(`/v1/images/${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-request-id": requestId,
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model,
					prompt: "A blue circle",
					service_tier,
					...(endpoint === "edits" && {
						images: [{ image_url: inputImage }],
					}),
				}),
			});

		test("forwards flex to Google AI Studio", async () => {
			const requestId = randomUUID();
			const res = await requestImages(
				"google-ai-studio/gemini-3-pro-image",
				"flex",
				requestId,
			);
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(json.data).toHaveLength(1);
			expect(upstreamBodies).toHaveLength(1);
			expect(upstreamBodies[0].service_tier).toBe("flex");
			const log = await waitForLogByRequestId(requestId);
			expect(log.hasError).toBe(false);
			expect(log.requestedServiceTier).toBe("flex");
			expect(log.usedServiceTier).toBe("flex");
		});

		test("returns 500 when the model replies without an image", async () => {
			textOnly = true;
			const errorSpy = vi.spyOn(logger, "error");
			const res = await requestImages(
				"google-ai-studio/gemini-3-pro-image",
				"flex",
			);
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(500);
			expect(JSON.stringify(json)).toContain(
				"The model did not generate any images",
			);
			expect(errorSpy).not.toHaveBeenCalled();
		});

		test("rejects a tier the pinned mapping does not offer", async () => {
			const res = await requestImages("openai/gpt-image-2", "flex");
			const json = await res.json();
			expect(res.status).toBe(400);
			expect(JSON.stringify(json)).toContain(
				"Service tier 'flex' is not available for model openai/gpt-image-2",
			);
			expect(upstreamBodies).toHaveLength(0);
		});
	});

	test("reports the delivered format when the provider ignores output options", async () => {
		const res = await app.request("/v1/images/edits", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "google-ai-studio/gemini-3-pro-image",
				prompt: "A blue circle",
				images: [{ image_url: inputImage }],
				background: "transparent",
				output_format: "webp",
			}),
		});
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.background).toBeUndefined();
		expect(json.output_format).toBe("png");
		expect(JSON.stringify(upstreamBodies[0])).toContain(
			"Background: transparent.",
		);
	});
});
