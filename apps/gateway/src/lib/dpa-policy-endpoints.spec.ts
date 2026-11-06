import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import * as cachedQueries from "@/lib/cached-queries.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const gdpr = { enabled: true, requireGdpr: true };
const enabled = { enabled: true };
const scopes: {
	name: string;
	org: ProviderCompliancePolicy | null;
	key: ProviderCompliancePolicy | null;
}[] = [
	{ name: "organization", org: gdpr, key: null },
	{ name: "key", org: null, key: gdpr },
	{ name: "organization with key", org: gdpr, key: enabled },
	{ name: "key with organization", org: enabled, key: gdpr },
	{ name: "both GDPR", org: gdpr, key: gdpr },
];
const headers = {
	Authorization: "Bearer dpa-scope-token",
	"Content-Type": "application/json",
	"x-no-fallback": "true",
	"x-no-cache": "true",
};
const body = () =>
	JSON.stringify({
		model: "openai/gpt-4o-mini",
		messages: [
			{ role: "user", content: `Synthetic DPA scope ${crypto.randomUUID()}` },
		],
		max_tokens: 1,
	});

describe("signed DPA request policy scopes", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(async () => {
		vi.stubEnv("REQUIRE_PROVIDER_DPA_FOR_GDPR", "true");
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "false");
		await harness.setProjectMode("api-keys");
		await harness.setContentFilterSettings({ providerIds: [] });
		await db.insert(tables.apiKey).values({
			id: "dpa-scope-key",
			...hashApiKeyForStorage("dpa-scope-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test DPA scope key",
		});
		await db.insert(tables.providerKey).values({
			id: "dpa-provider-key",
			...encryptProviderKeyForStorage(
				"synthetic-provider-key",
				"dpa-provider-key",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	async function configure(scope: (typeof scopes)[number]) {
		await cdb
			.update(tables.organization)
			.set({ providerCompliancePolicy: scope.org })
			.where(eq(tables.organization.id, "org-id"));
		await cdb
			.update(tables.apiKey)
			.set({ providerCompliancePolicy: scope.key })
			.where(eq(tables.apiKey.id, "dpa-scope-key"));
	}
	test.each(scopes)(
		"%s unsigned denies before any provider dispatch",
		async (scope) => {
			await configure(scope);
			const lookup = vi
				.spyOn(cachedQueries, "findDpaSignedProviderIds")
				.mockResolvedValue([]);
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("Unexpected upstream"));
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers,
				body: body(),
			});
			expect(response.status).toBe(403);
			expect(lookup).toHaveBeenCalled();
			expect(upstream).not.toHaveBeenCalled();
		},
	);
	test.each(scopes)("%s lookup failure does not dispatch", async (scope) => {
		await configure(scope);
		const lookup = vi
			.spyOn(cachedQueries, "findDpaSignedProviderIds")
			.mockRejectedValue(new Error("Synthetic DPA outage"));
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected upstream"));
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: body(),
		});
		expect(response.status).toBeGreaterThanOrEqual(500);
		expect(lookup).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	});
	test.each(scopes)(
		"$name SDK RPC retains the same DPA floor",
		async (scope) => {
			await configure(scope);
			const lookup = vi
				.spyOn(cachedQueries, "findDpaSignedProviderIds")
				.mockResolvedValue([]);
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("Unexpected upstream"));
			const response = await app.request("/v4/ai/language-model", {
				method: "POST",
				headers: {
					...headers,
					"ai-gateway-protocol-version": "0.0.1",
					"ai-language-model-specification-version": "4",
					"ai-language-model-id": "openai/gpt-4o-mini",
					"ai-language-model-streaming": "false",
				},
				body: JSON.stringify({
					prompt: [
						{
							role: "user",
							content: [{ type: "text", text: "Synthetic DPA RPC" }],
						},
					],
					maxOutputTokens: 1,
				}),
			});
			expect(response.status).toBe(403);
			expect(lookup).toHaveBeenCalled();
			expect(upstream).not.toHaveBeenCalled();
		},
	);
	test("waits for the signature decision before any egress", async () => {
		await configure(scopes[4]);
		let release!: (ids: string[]) => void;
		let entered!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const pending = new Promise<string[]>((resolve) => {
			release = resolve;
		});
		vi.spyOn(cachedQueries, "findDpaSignedProviderIds").mockImplementation(
			() => {
				entered();
				return pending;
			},
		);
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected upstream"));
		const request = Promise.resolve(
			app.request("/v1/chat/completions", {
				method: "POST",
				headers,
				body: body(),
			}),
		);
		expect(
			await Promise.race([reached.then(() => true), request.then(() => false)]),
		).toBe(true);
		expect(upstream).not.toHaveBeenCalled();
		release([]);
		expect((await request).status).toBe(403);
		expect(upstream).not.toHaveBeenCalled();
	});
	test("signed allOf reaches the actual synthetic provider transport", async () => {
		await configure(scopes[4]);
		vi.spyOn(cachedQueries, "findDpaSignedProviderIds").mockResolvedValue([
			"openai",
		]);
		const upstream = vi.spyOn(globalThis, "fetch");
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: body(),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).choices.length).toBeGreaterThan(0);
		expect(upstream).toHaveBeenCalled();
	});
	test("model reads still honor composed privacy when quota is exhausted", async () => {
		await configure(scopes[4]);
		await cdb
			.update(tables.apiKey)
			.set({ usageLimit: "0" })
			.where(eq(tables.apiKey.id, "dpa-scope-key"));
		const lookup = vi
			.spyOn(cachedQueries, "findDpaSignedProviderIds")
			.mockResolvedValue([]);
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected upstream"));
		const response = await app.request("/v1/models", { headers });
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual([]);
		expect(lookup).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	});
});
