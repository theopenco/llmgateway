import "dotenv/config";
import {
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	type TestOptions,
} from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
} from "@/chat-helpers.e2e";

import { getProviderEnvVar } from "@llmgateway/models";

import { app } from ".";
import { waitForLogByRequestId } from "./test-utils/test-helpers";

// Helper function to get test options with retry for CI environment
function getTestOptions(): TestOptions {
	return process.env.CI ? { retry: 3 } : {};
}

describe("Log Queue Processing E2E", () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

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
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
					"x-request-id": requestId,
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
			const log = await waitForLogByRequestId(requestId);
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
			const requestIds = [];
			for (let i = 0; i < 3; i++) {
				const requestId = generateTestRequestId();
				requestIds.push(requestId);
				promises.push(
					app.request("/v1/chat/completions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer real-token`,
							"x-request-id": requestId,
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
			const logs = await Promise.all(
				requestIds.map((requestId) => waitForLogByRequestId(requestId)),
			);
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
