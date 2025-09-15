import "dotenv/config";
import { beforeEach, describe, expect, test, type TestOptions } from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from ".";
import {
	clearCache,
	waitForLogs,
	getProviderEnvVar,
} from "./test-utils/test-helpers";

// Helper function to get test options with retry for CI environment
function getTestOptions(): TestOptions {
	return process.env.CI ? { retry: 3, timeout: 120000 } : {};
}

describe("Log Queue Processing E2E", () => {
	beforeEach(async () => {
		await clearCache();

		await Promise.all([
			db.delete(tables.log),
			db.delete(tables.apiKey),
			db.delete(tables.providerKey),
		]);

		await Promise.all([
			db.delete(tables.userOrganization),
			db.delete(tables.project),
		]);

		await Promise.all([
			db.delete(tables.organization),
			db.delete(tables.user),
			db.delete(tables.account),
			db.delete(tables.session),
			db.delete(tables.verification),
		]);

		await db.insert(tables.user).values({
			id: "user-id",
			name: "user",
			email: "user",
		});

		await db.insert(tables.organization).values({
			id: "org-id",
			name: "Test Organization",
			plan: "pro",
		});

		await db.insert(tables.userOrganization).values({
			id: "user-org-id",
			userId: "user-id",
			organizationId: "org-id",
		});

		await db.insert(tables.project).values({
			id: "project-id",
			name: "Test Project",
			organizationId: "org-id",
			mode: "api-keys",
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
		});

		// Set up a simple provider key for testing
		const envVarName = getProviderEnvVar("openai");
		const envVarValue = envVarName ? process.env[envVarName] : undefined;
		if (envVarValue) {
			await db.insert(tables.providerKey).values({
				id: "provider-key-openai",
				token: envVarValue,
				provider: "openai",
				organizationId: "org-id",
			});
		}
	});

	test(
		"process log queue processes logs correctly",
		getTestOptions(),
		async () => {
			const envVarName = getProviderEnvVar("openai");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log("Skipping log queue test - no OpenAI API key provided");
				return;
			}

			// Make a request that should generate a log entry
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: "Hello, test the log queue processing!",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("choices.[0].message.content");

			// Test that the log queue processing works as expected
			const logs = await waitForLogs(1);
			expect(logs.length).toBe(1);

			const log = logs[0];
			expect(log.usedProvider).toBeTruthy();
			expect(log.errorDetails).toBeNull();
			expect(log.finishReason).not.toBeNull();
			expect(log.unifiedFinishReason).not.toBeNull();
			expect(log.usedModel).toBeTruthy();
			expect(log.requestedModel).toBeTruthy();
		},
	);

	test(
		"process log queue handles multiple logs correctly",
		getTestOptions(),
		async () => {
			const envVarName = getProviderEnvVar("openai");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(
					"Skipping multiple logs queue test - no OpenAI API key provided",
				);
				return;
			}

			// Make multiple requests that should generate multiple log entries
			const promises = [];
			for (let i = 0; i < 3; i++) {
				promises.push(
					app.request("/v1/chat/completions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer real-token`,
						},
						body: JSON.stringify({
							model: "openai/gpt-4o-mini",
							messages: [
								{
									role: "user",
									content: `Hello, test message ${i + 1}!`,
								},
							],
						}),
					}),
				);
			}

			const responses = await Promise.all(promises);
			for (const res of responses) {
				expect(res.status).toBe(200);
			}

			// Test that the log queue processing handles multiple logs
			const logs = await waitForLogs(3);
			expect(logs.length).toBe(3);

			for (const log of logs) {
				expect(log.usedProvider).toBeTruthy();
				expect(log.errorDetails).toBeNull();
				expect(log.finishReason).not.toBeNull();
				expect(log.unifiedFinishReason).not.toBeNull();
				expect(log.usedModel).toBeTruthy();
				expect(log.requestedModel).toBeTruthy();
			}
		},
	);
});
