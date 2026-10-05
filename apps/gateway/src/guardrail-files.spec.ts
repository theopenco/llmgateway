import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, defaultSystemRulesConfig, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

const IMAGE_URL = "https://example.com/guardrail-image.png";

describe("gateway attachment policy", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		await harness.setOrganizationPlan("enterprise");
		await db.insert(tables.apiKey).values({
			id: "attachment-token",
			...hashApiKeyForStorage("attachment-test-token"),
			projectId: "project-id",
			description: "Attachment test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "attachment-provider",
			...encryptProviderKeyForStorage(
				"attachment-provider-key",
				"attachment-provider",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		await db.insert(tables.guardrailConfig).values({
			organizationId: "org-id",
			enabled: true,
			allowedFileTypes: ["image/png"],
			systemRules: {
				...defaultSystemRulesConfig,
				file_types: { enabled: true, action: "block" },
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	function request(content: unknown[]) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer attachment-test-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content }],
			}),
		});
	}

	it("downloads an allowed remote image once and forwards the checked bytes", async () => {
		const originalFetch = globalThis.fetch;
		let downloads = 0;
		let upstreamBody = "";
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
			if (String(url) === IMAGE_URL) {
				downloads++;
				return new Response(new Uint8Array([97]), {
					headers: { "content-type": "Image/PNG; charset=binary" },
				});
			}
			if (String(url).startsWith(harness.mockServerUrl)) {
				upstreamBody = String(options?.body ?? "");
			}
			return await originalFetch(url, options);
		});
		const response = await request([
			{ type: "text", text: "describe the checked attachment" },
			{ type: "image_url", image_url: { url: IMAGE_URL } },
		]);
		expect(await response.text()).toContain("chat.completion");
		expect(response.status).toBe(200);
		expect(downloads).toBe(1);
		expect(upstreamBody).toContain("data:image/png;base64,YQ==");
	});

	describe.each(["remote", "inline"])("%s image policy limits", (source) => {
		it.each(["block", "redact", "warn", "allow"] as const)(
			"honors the %s action and records the violation",
			async (action) => {
				vi.stubEnv("IMAGE_SIZE_LIMIT_ENTERPRISE_MB", "2");
				await db
					.update(tables.guardrailConfig)
					.set({
						maxFileSizeMb: 1,
						systemRules: {
							...defaultSystemRulesConfig,
							file_types: { enabled: true, action },
						},
					})
					.where(eq(tables.guardrailConfig.organizationId, "org-id"));
				const oneMegabyte = 1024 * 1024;
				const bytes = Buffer.alloc(oneMegabyte + 1, 97);
				const originalFetch = globalThis.fetch;
				let downloads = 0;
				const upstream = vi.fn();
				vi.spyOn(globalThis, "fetch").mockImplementation(
					async (url, options) => {
						if (String(url) === IMAGE_URL) {
							downloads++;
							return new Response(bytes, {
								headers: { "content-type": "image/png" },
							});
						}
						if (String(url).startsWith(harness.mockServerUrl)) {
							upstream();
						}
						return await originalFetch(url, options);
					},
				);
				const response = await request([
					{
						type: "image_url",
						image_url: {
							url:
								source === "remote"
									? IMAGE_URL
									: `data:image/png;base64,${bytes.toString("base64")}`,
						},
					},
				]);
				const text = await response.text();
				const blocked = action === "block" || action === "redact";
				expect(response.status, text).toBe(blocked ? 400 : 200);
				expect(downloads).toBe(source === "remote" ? 1 : 0);
				expect(upstream).toHaveBeenCalledTimes(blocked ? 0 : 1);
				const violation = await db.query.guardrailViolation.findFirst({
					where: {
						organizationId: { eq: "org-id" },
						ruleId: { eq: "system:file_types" },
					},
				});
				expect(violation?.matchedPattern).toBe("File exceeds 1MB");
				if (blocked) {
					expect(text).toContain("guardrail_violation");
					const [log] = await waitForLogs(1);
					expect(log?.errorDetails?.cause).toBe("guardrail_violation");
				}
			},
		);
	});

	it("logs and rejects downloads over the safety cap even in warn mode", async () => {
		vi.stubEnv("IMAGE_SIZE_LIMIT_ENTERPRISE_MB", "1");
		await db
			.update(tables.guardrailConfig)
			.set({
				maxFileSizeMb: 2,
				systemRules: {
					...defaultSystemRulesConfig,
					file_types: { enabled: true, action: "warn" },
				},
			})
			.where(eq(tables.guardrailConfig.organizationId, "org-id"));
		const originalFetch = globalThis.fetch;
		const canceled = vi.fn();
		const upstream = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
			if (String(url) === IMAGE_URL) {
				return new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(1024 * 1024));
						},
						cancel: canceled,
					}),
					{ headers: { "content-type": "image/png" } },
				);
			}
			if (String(url).startsWith(harness.mockServerUrl)) {
				upstream();
			}
			return await originalFetch(url, options);
		});
		const response = await request([
			{ type: "image_url", image_url: { url: IMAGE_URL } },
		]);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain(
			"exceeds your current limit of 1MB",
		);
		expect(canceled).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
		const [log] = await waitForLogs(1);
		expect(log?.errorDetails?.cause).toBe("attachment_validation_failed");
	});

	it("logs unsafe image URL rejections without forwarding them", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const upstream = vi.spyOn(globalThis, "fetch");
		const response = await request([
			{ type: "image_url", image_url: { url: "http://127.0.0.1/image.png" } },
		]);
		expect(response.status).toBe(400);
		await response.text();
		expect(upstream).not.toHaveBeenCalled();
		const [log] = await waitForLogs(1);
		expect(log?.errorDetails?.cause).toBe("attachment_validation_failed");
	});

	it("rejects a remote MIME type outside the organization policy", async () => {
		const originalFetch = globalThis.fetch;
		const upstream = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
			if (String(url) === IMAGE_URL) {
				return new Response(new Uint8Array([97]), {
					headers: { "content-type": "image/jpeg" },
				});
			}
			if (String(url).startsWith(harness.mockServerUrl)) {
				upstream();
			}
			return await originalFetch(url, options);
		});
		const response = await request([
			{ type: "image_url", image_url: { url: IMAGE_URL } },
		]);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("system:file_types");
		expect(upstream).not.toHaveBeenCalled();
	});

	it("bounds OpenAI image-edit uploads even without a Content-Length header", async () => {
		await db
			.update(tables.guardrailConfig)
			.set({ enabled: false })
			.where(eq(tables.guardrailConfig.organizationId, "org-id"));
		vi.stubEnv("IMAGE_SIZE_LIMIT_ENTERPRISE_MB", "1");
		const originalFetch = globalThis.fetch;
		const canceled = vi.fn();
		const upstream = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
			if (String(url) === IMAGE_URL) {
				return new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(1024 * 1024));
						},
						cancel: canceled,
					}),
					{ headers: { "content-type": "image/png" } },
				);
			}
			if (String(url).startsWith(harness.mockServerUrl)) {
				upstream();
			}
			return await originalFetch(url, options);
		});
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer attachment-test-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-image-2",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "edit this image" },
							{ type: "image_url", image_url: { url: IMAGE_URL } },
						],
					},
				],
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("exceeds the 1MB limit");
		expect(canceled).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	});

	it("rejects opaque provider file identifiers whose MIME cannot be checked", async () => {
		const response = await request([
			{ type: "file", file: { file_id: "provider-file" } },
		]);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("system:file_types");
	});
});
