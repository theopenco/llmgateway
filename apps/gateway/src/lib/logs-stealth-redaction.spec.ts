import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertLog } from "./logs.js";

import type { LogInsertData } from "@llmgateway/db";

const publishToQueue = vi.fn();

vi.mock(import("@llmgateway/cache"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		publishToQueue: (...args: unknown[]) => publishToQueue(...args),
	};
});

vi.mock("@llmgateway/instrumentation", () => ({
	recordChatCompletionMetrics: vi.fn(),
}));

function baseLogData(overrides: Partial<LogInsertData>): LogInsertData {
	return {
		requestId: "req-1",
		organizationId: "org-1",
		projectId: "project-1",
		apiKeyId: "api-key-1",
		duration: 100,
		requestedModel: "some-model",
		usedModel: "some-model",
		usedProvider: "openai",
		responseSize: 0,
		mode: "credits",
		usedMode: "credits",
		finishReason: "upstream_error",
		hasError: true,
		...overrides,
	} as LogInsertData;
}

const rawErrorDetails = {
	statusCode: 429,
	statusText: "SecretVendor rate limited",
	responseText: '{"error":{"message":"SecretVendor quota exceeded"}}',
};

describe("insertLog stealth provider error redaction", () => {
	beforeEach(() => {
		publishToQueue.mockClear();
	});

	it("moves the raw error to internalErrorDetails for stealth providers", async () => {
		await insertLog(
			baseLogData({
				usedProvider: "granite",
				errorDetails: { ...rawErrorDetails },
			}),
		);

		expect(publishToQueue).toHaveBeenCalledTimes(1);
		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.internalErrorDetails).toEqual(rawErrorDetails);
		expect(published.errorDetails).toEqual({
			statusCode: 429,
			statusText: "Too Many Requests",
			responseText: "Upstream provider error (429 Too Many Requests)",
		});
		expect(JSON.stringify(published.errorDetails)).not.toContain(
			"SecretVendor",
		);
	});

	it("leaves errorDetails untouched for regular providers", async () => {
		await insertLog(
			baseLogData({
				usedProvider: "openai",
				errorDetails: { ...rawErrorDetails },
			}),
		);

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.errorDetails).toEqual(rawErrorDetails);
		expect(published.internalErrorDetails).toBeUndefined();
	});

	it("does nothing when there are no error details", async () => {
		await insertLog(
			baseLogData({
				usedProvider: "granite",
				hasError: false,
				finishReason: "stop",
				errorDetails: null,
			}),
		);

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.errorDetails).toBeNull();
		expect(published.internalErrorDetails).toBeUndefined();
	});
});
