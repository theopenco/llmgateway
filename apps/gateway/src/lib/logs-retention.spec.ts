import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertLog } from "./logs.js";

import type { LogInsertData } from "@llmgateway/db";

const publishToQueue = vi.fn();
const dbInsertValues = vi.fn();

vi.mock(import("@llmgateway/cache"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		publishToQueue: (...args: unknown[]) => publishToQueue(...args),
	};
});

vi.mock(import("@llmgateway/db"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		db: {
			insert: () => ({
				values: (...args: unknown[]) => dbInsertValues(...args),
			}),
		} as unknown as typeof actual.db,
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
		finishReason: "stop",
		hasError: false,
		messages: [{ role: "user", content: "secret prompt" }],
		content: "secret completion",
		reasoningContent: "secret reasoning",
		tools: [{ type: "function", function: { name: "f" } }],
		toolChoice: "auto",
		toolResults: [{ id: "1" }],
		responsesApiData: { foo: "bar" },
		errorDetails: {
			statusCode: 400,
			statusText: "Bad Request",
			responseText: "secret echoed prompt",
		},
		...overrides,
	} as LogInsertData;
}

describe("insertLog retention stripping", () => {
	beforeEach(() => {
		publishToQueue.mockClear();
		dbInsertValues.mockClear();
	});

	it("strips payload fields before publishing when retention is none", async () => {
		await insertLog(baseLogData({}), { retentionLevel: "none" });

		expect(publishToQueue).toHaveBeenCalledTimes(1);
		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.messages).toBeNull();
		expect(published.content).toBeNull();
		expect(published.reasoningContent).toBeNull();
		expect(published.tools).toBeNull();
		expect(published.toolChoice).toBeNull();
		expect(published.toolResults).toBeNull();
		expect(published.responsesApiData).toBeNull();
		expect(published.errorDetails).toEqual({
			statusCode: 400,
			statusText: "Bad Request",
			responseText: "",
		});
		// Metadata is preserved.
		expect(published.requestId).toBe("req-1");
		expect(published.organizationId).toBe("org-1");
		expect(JSON.stringify(published)).not.toContain("secret");
	});

	it("keeps payload fields when retention is retain", async () => {
		await insertLog(baseLogData({}), { retentionLevel: "retain" });

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.content).toBe("secret completion");
		expect(published.messages).toEqual([
			{ role: "user", content: "secret prompt" },
		]);
	});

	it("strips payload fields when retention is unspecified (fail closed)", async () => {
		await insertLog(baseLogData({}));

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.messages).toBeNull();
		expect(published.content).toBeNull();
		expect(published.reasoningContent).toBeNull();
	});

	it("strips payload fields when retention is explicitly null (fail closed)", async () => {
		await insertLog(baseLogData({}), { retentionLevel: null });

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.messages).toBeNull();
		expect(published.content).toBeNull();
	});

	it("strips all payload fields when retention is none", async () => {
		await insertLog(baseLogData({}), { retentionLevel: "none" });

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.messages).toBeNull();
		expect(published.content).toBeNull();
		expect(published.tools).toBeNull();
		expect(published.responsesApiData).toBeNull();
	});

	it("keeps payload when retention is retain", async () => {
		await insertLog(baseLogData({}), { retentionLevel: "retain" });

		const published = publishToQueue.mock.calls[0][1] as LogInsertData;
		expect(published.content).toBe("secret completion");
	});
});
