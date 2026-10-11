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
		usedModel: "openai/some-model",
		usedProvider: "openai",
		responseSize: 0,
		mode: "credits",
		usedMode: "credits",
		hasError: false,
		...overrides,
	} as LogInsertData;
}

async function publishedLog(overrides: Partial<LogInsertData>) {
	await insertLog(baseLogData(overrides));
	return publishToQueue.mock.calls[0][1] as LogInsertData;
}

describe("insertLog hasError", () => {
	beforeEach(() => {
		publishToQueue.mockClear();
	});

	it.each([
		["an upstream abort", { finishReason: "abort" }],
		["a dropped stream", { finishReason: "network_error" }],
		[
			"an explicit upstream error",
			{ finishReason: "stop", unifiedFinishReason: "upstream_error" },
		],
		["a gateway read fault", { finishReason: "gateway_error" }],
	])("marks %s as an error", async (_, overrides) => {
		const log = await publishedLog(overrides);
		expect(log.hasError).toBe(true);
		expect(log.errorCategory).not.toBeNull();
	});

	it.each([
		["a completion", { finishReason: "stop" }],
		["a canceled request", { finishReason: "stop", canceled: true }],
		["a content filter", { finishReason: "content_filter" }],
	])("leaves %s unmarked", async (_, overrides) => {
		const log = await publishedLog(overrides);
		expect(log.hasError).toBe(false);
	});
});
