import "dotenv/config";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import {
	getProviderEnvVar,
	getTestOptions,
	providers,
} from "@llmgateway/models";

// Helper function to generate unique IDs for tests
function generateTestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

describe(
	"e2e tests for provider keys",
	getTestOptions({ completions: false }),
	() => {
		beforeAll(async () => {
			// Clean the database once before all tests
			await deleteAll();
		});

		afterAll(async () => {
			// Clean up after all tests are done
			await deleteAll();
		});

		async function setupTestData() {
			const testId = generateTestId();
			const userId = `user-${testId}`;
			const orgId = `org-${testId}`;
			const projectId = `project-${testId}`;
			const userOrgId = `user-org-${testId}`;

			// Create test user with unique ID
			await db.insert(tables.user).values({
				id: userId,
				name: "Test User",
				email: `admin-${testId}@example.com`,
				emailVerified: true,
			});

			// Create test account with unique ID
			await db.insert(tables.account).values({
				id: `account-${testId}`,
				providerId: "credential",
				accountId: `account-${testId}`,
				userId: userId,
				password:
					"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
			});

			const auth = await app.request("/auth/sign-in/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: `admin-${testId}@example.com`,
					password: "admin@example.com1A",
				}),
			});

			if (auth.status !== 200) {
				throw new Error(`Failed to authenticate: ${auth.status}`);
			}

			const token = auth.headers.get("set-cookie")!;

			await db.insert(tables.organization).values({
				id: orgId,
				name: "Test Organization",
				plan: "pro",
			});

			await db.insert(tables.userOrganization).values({
				id: userOrgId,
				userId: userId,
				organizationId: orgId,
			});

			await db.insert(tables.project).values({
				id: projectId,
				name: "Test Project",
				organizationId: orgId,
				mode: "api-keys",
			});

			return { token, orgId };
		}

		const testProviders = providers
			.filter((provider) => provider.id !== "llmgateway")
			.map((provider) => ({
				providerId: provider.id,
				name: provider.name,
			}));

		test.each(testProviders)(
			"POST /keys/provider with $name key",
			async ({ providerId }) => {
				// TODO temporarily skip routeway and nanogpt
				if (providerId === "routeway" || providerId === "nanogpt") {
					return;
				}
				const envVarName = getProviderEnvVar(providerId);
				const envVarValue = envVarName ? process.env[envVarName] : undefined;
				if (!envVarValue) {
					console.log(`Skipping ${providerId} test - no API key provided`);
					return;
				}

				const { token, orgId } = await setupTestData();

				const res = await app.request("/keys/provider", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Cookie: token,
					},
					body: JSON.stringify({
						provider: providerId,
						token: envVarValue,
						organizationId: orgId,
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
							eq: orgId,
						},
					},
				});
				expect(providerKey).not.toBeNull();
				expect(providerKey?.provider).toBe(providerId);
				expect(providerKey?.token).toBe(envVarValue);
			},
		);

		// test.skip("POST /keys/provider with custom baseUrl", async () => {
		// 	if (!process.env.OPENAI_API_KEY) {
		// 		console.log("Skipping custom baseUrl test - no API key provided");
		// 		return;
		// 	}
		//
		// 	const { token, orgId } = await setupTestData();
		// 	const customBaseUrl = "https://api.custom-openai.example.com";
		// 	const res = await app.request("/keys/provider", {
		// 		method: "POST",
		// 		headers: {
		// 			"Content-Type": "application/json",
		// 			Cookie: token,
		// 		},
		// 		body: JSON.stringify({
		// 			provider: "openai",
		// 			token: process.env.OPENAI_API_KEY,
		// 			baseUrl: customBaseUrl,
		// 			organizationId: orgId,
		// 		}),
		// 	});
		//
		// 	expect(res.status).toBe(200);
		// 	const json = await res.json();
		// 	expect(json).toHaveProperty("providerKey");
		// 	expect(json.providerKey.provider).toBe("openai");
		// 	expect(json.providerKey.baseUrl).toBe(customBaseUrl);
		//
		// 	const providerKey = await db.query.providerKey.findFirst({
		// 		where: {
		// 			provider: {
		// 				eq: "openai",
		// 			},
		// 			organizationId: {
		// 				eq: orgId,
		// 			},
		// 		},
		// 	});
		// 	expect(providerKey).not.toBeNull();
		// 	expect(providerKey?.provider).toBe("openai");
		// 	expect(providerKey?.baseUrl).toBe(customBaseUrl);
		// });
	},
);
