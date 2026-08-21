import { describe, expect, it } from "vitest";

import {
	RETENTION_SENSITIVE_LOG_FIELDS,
	stripRetentionSensitiveLogFields,
} from "./log-retention.js";

import type { LogInsertData } from "./types.js";

function baseLogData(overrides: Partial<LogInsertData> = {}): LogInsertData {
	return {
		requestId: "req-1",
		organizationId: "org-1",
		projectId: "project-1",
		apiKeyId: "api-key-1",
		duration: 100,
		requestedModel: "some-model",
		usedModel: "some-model",
		usedProvider: "openai",
		responseSize: 42,
		mode: "credits",
		usedMode: "credits",
		finishReason: "stop",
		hasError: false,
		promptTokens: "10",
		completionTokens: "20",
		messages: [{ role: "user", content: "secret prompt" }],
		content: "secret completion",
		reasoningContent: "secret reasoning",
		tools: [{ type: "function", function: { name: "f" } }],
		toolChoice: "auto",
		toolResults: [{ id: "1" }],
		responsesApiData: { foo: "bar" },
		// Debug payloads (captured under `x-debug`) hold the full request and
		// response bodies exchanged with the provider.
		rawRequest: { messages: [{ role: "user", content: "secret prompt" }] },
		rawResponse: { choices: [{ message: { content: "secret completion" } }] },
		upstreamRequest: { input: [{ type: "reasoning", encrypted_content: "s" }] },
		upstreamResponse: { output: [{ type: "message" }] },
		...overrides,
	} as LogInsertData;
}

describe("stripRetentionSensitiveLogFields", () => {
	it("clears every retention-sensitive payload field", () => {
		const stripped = stripRetentionSensitiveLogFields(baseLogData());

		expect(stripped.messages).toBeNull();
		expect(stripped.content).toBeNull();
		expect(stripped.reasoningContent).toBeNull();
		expect(stripped.tools).toBeNull();
		expect(stripped.toolChoice).toBeNull();
		expect(stripped.toolResults).toBeNull();
		expect(stripped.responsesApiData).toBeNull();
		expect(stripped.rawRequest).toBeNull();
		expect(stripped.rawResponse).toBeNull();
		expect(stripped.upstreamRequest).toBeNull();
		expect(stripped.upstreamResponse).toBeNull();
	});

	it("nulls exactly the documented field list and nothing else", () => {
		const input = baseLogData();
		const stripped = stripRetentionSensitiveLogFields(input);

		for (const key of Object.keys(input) as (keyof LogInsertData)[]) {
			if (
				(RETENTION_SENSITIVE_LOG_FIELDS as readonly string[]).includes(
					key as string,
				)
			) {
				expect(stripped[key]).toBeNull();
			} else {
				expect(stripped[key]).toEqual(input[key]);
			}
		}
	});

	it("preserves all metadata / metering fields", () => {
		const stripped = stripRetentionSensitiveLogFields(baseLogData());

		expect(stripped.requestId).toBe("req-1");
		expect(stripped.organizationId).toBe("org-1");
		expect(stripped.projectId).toBe("project-1");
		expect(stripped.usedProvider).toBe("openai");
		expect(stripped.responseSize).toBe(42);
		expect(stripped.promptTokens).toBe("10");
		expect(stripped.completionTokens).toBe("20");
		expect(stripped.finishReason).toBe("stop");
	});

	it("does not mutate the input object", () => {
		const input = baseLogData();
		const strippedContent = input.content;
		stripRetentionSensitiveLogFields(input);

		expect(input.content).toBe(strippedContent);
		expect(input.messages).toEqual([
			{ role: "user", content: "secret prompt" },
		]);
	});

	it("is idempotent on already-stripped data", () => {
		const once = stripRetentionSensitiveLogFields(baseLogData());
		const twice = stripRetentionSensitiveLogFields(once);

		expect(twice).toEqual(once);
	});

	it("leaves no secret payload strings in the result", () => {
		const stripped = stripRetentionSensitiveLogFields(baseLogData());
		expect(JSON.stringify(stripped)).not.toContain("secret");
	});
});
