import "dotenv/config";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	type TestOptions,
} from "vitest";

import { createTestUser, deleteAll } from "@/testing";

import { db, tables } from "@llmgateway/db";
import {
	models,
	type ProviderModelMapping,
	providers,
} from "@llmgateway/models";

import { app } from "..";
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { getProviderEnvVar } from "../../../gateway/src/test-utils/test-helpers";

function getTestOptions(): TestOptions {
	const hasTestOnly = models.some((model) =>
		model.providers.some(
			(provider: ProviderModelMapping) => provider.test === "only",
		),
	);
	return process.env.CI
		? { retry: 3 }
		: { skip: hasTestOnly || !!process.env.TEST_MODELS };
}

describe("e2e tests for provider keys", getTestOptions(), () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			plan: "pro",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
			mode: "api-keys",
		});
	});

	const testProviders = providers
		.filter((provider) => provider.id !== "llmgateway")
		.map((provider) => ({
			providerId: provider.id,
			name: provider.name,
		}));

	test.each(testProviders)(
		"POST /keys/provider with $name key",
		async ({ providerId }) => {
			const envVarName = getProviderEnvVar(providerId);
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(`Skipping ${providerId} test - no API key provided`);
				return;
			}

			const res = await app.request("/keys/provider", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({
					provider: providerId,
					token: envVarValue,
					organizationId: "test-org-id",
				}),
			});

			const json = await res.json();
			console.log("json", json);
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("providerKey");
			expect(json.providerKey.provider).toBe(providerId);
			expect(json.providerKey.token).toBe(envVarValue);

			const providerKey = await db.query.providerKey.findFirst({
				where: {
					provider: {
						eq: providerId,
					},
					organizationId: {
						eq: "test-org-id",
					},
				},
			});
			expect(providerKey).not.toBeNull();
			expect(providerKey?.provider).toBe(providerId);
			expect(providerKey?.token).toBe(envVarValue);
		},
	);

	test.skip("POST /keys/provider with custom baseUrl", async () => {
		if (!process.env.OPENAI_API_KEY) {
			console.log("Skipping custom baseUrl test - no API key provided");
			return;
		}

		const customBaseUrl = "https://api.custom-openai.example.com";
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: process.env.OPENAI_API_KEY,
				baseUrl: customBaseUrl,
				organizationId: "test-org-id",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.provider).toBe("openai");
		expect(json.providerKey.baseUrl).toBe(customBaseUrl);

		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "openai",
				},
				organizationId: {
					eq: "test-org-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.provider).toBe("openai");
		expect(providerKey?.baseUrl).toBe(customBaseUrl);
	});

	test.skip("POST /keys/provider with custom baseUrl", async () => {
		if (!process.env.OPENAI_API_KEY) {
			console.log("Skipping custom baseUrl test - no API key provided");
			return;
		}

		const customBaseUrl = "https://api.custom-openai.example.com";
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: process.env.OPENAI_API_KEY,
				baseUrl: customBaseUrl,
				organizationId: "test-org-id",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.provider).toBe("openai");
		expect(json.providerKey.baseUrl).toBe(customBaseUrl);

		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "openai",
				},
				organizationId: {
					eq: "test-org-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.provider).toBe("openai");
		expect(providerKey?.baseUrl).toBe(customBaseUrl);
	});
});
