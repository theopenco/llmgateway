import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
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
		quality?: unknown;
	}> = [];
	let failOpenai = false;

	beforeEach(async () => {
		upstreamRequests.length = 0;
		failOpenai = false;
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
			upstreamRequests.push({
				provider,
				endpoint,
				n,
				stream: body.stream,
				partialImages: body.partial_images,
				quality: body.quality,
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
			if (stream && n > 1) {
				return Response.json(
					{ error: { message: "Streaming is only supported with n=1." } },
					{ status: 400 },
				);
			}
			const data = Array.from({ length: n }, (_, i) => ({
				b64_json: Buffer.from(`image-${i}`).toString("base64"),
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
