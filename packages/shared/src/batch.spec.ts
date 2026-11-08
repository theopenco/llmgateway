import { describe, expect, test } from "vitest";

import {
	BATCH_MAX_REQUESTS,
	buildBatchOutputLine,
	newBatchFileId,
	newBatchId,
	newBatchRequestId,
	parseBatchInput,
	toStoredResponseBody,
} from "./batch.js";

function line(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		custom_id: "req-1",
		method: "POST",
		url: "/v1/chat/completions",
		body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
		...overrides,
	});
}

describe("parseBatchInput", () => {
	test("parses valid lines and skips blank ones", () => {
		const result = parseBatchInput(
			`${line()}\n\n${line({ custom_id: "req-2" })}\r\n`,
			"/v1/chat/completions",
		);

		expect(result).toEqual({
			ok: true,
			requests: [
				{
					lineNumber: 1,
					customId: "req-1",
					body: JSON.stringify({
						model: "gpt-4o-mini",
						messages: [{ role: "user", content: "hi" }],
					}),
				},
				expect.objectContaining({ lineNumber: 3, customId: "req-2" }),
			],
		});
	});

	test.each([
		["not json", "{oops", "invalid_json_line"],
		["an array", "[]", "invalid_request"],
		[
			"a missing custom_id",
			line({ custom_id: undefined }),
			"invalid_custom_id",
		],
		[
			"a NUL in custom_id",
			line({ custom_id: "a\u0000b" }),
			"invalid_custom_id",
		],
		["a GET", line({ method: "GET" }), "invalid_method"],
		["another endpoint", line({ url: "/v1/embeddings" }), "mismatched_url"],
		["a non-object body", line({ body: "hi" }), "invalid_body"],
		[
			"streaming",
			line({ body: { model: "gpt-4o-mini", stream: true } }),
			"streaming_unsupported",
		],
	])("rejects %s", (_label, content, code) => {
		const result = parseBatchInput(content, "/v1/chat/completions");

		expect(result.ok).toBe(false);
		expect(!result.ok && result.errors[0]).toMatchObject({ code, line: 1 });
	});

	test("rejects duplicate custom ids with the line number", () => {
		const result = parseBatchInput(
			`${line()}\n${line()}`,
			"/v1/chat/completions",
		);

		expect(!result.ok && result.errors).toEqual([
			expect.objectContaining({ code: "duplicate_custom_id", line: 2 }),
		]);
	});

	test("rejects empty files and caps reported errors", () => {
		expect(parseBatchInput("\n\n", "/v1/responses")).toMatchObject({
			ok: false,
			errors: [{ code: "empty_file" }],
		});
		const bad = Array.from({ length: 250 }, () => "{oops").join("\n");
		const result = parseBatchInput(bad, "/v1/responses");
		expect(!result.ok && result.errors).toHaveLength(100);
	});

	test("rejects files over the request limit", () => {
		const content = Array.from({ length: BATCH_MAX_REQUESTS + 1 }, (_, index) =>
			line({ custom_id: `req-${index}` }),
		).join("\n");

		const result = parseBatchInput(content, "/v1/chat/completions");

		expect(!result.ok && result.errors).toEqual([
			expect.objectContaining({ code: "too_many_requests" }),
		]);
	});
});

describe("output lines", () => {
	test("embeds the stored body verbatim and parses as the OpenAI shape", () => {
		const body = toStoredResponseBody('{ "id": "chatcmpl-1", "n": 1e2 }');
		const output = buildBatchOutputLine({
			id: "batch_req_1",
			customId: "req-1",
			responseStatus: 200,
			responseBody: body,
			requestId: "abc",
			error: null,
		});

		expect(output.endsWith("\n")).toBe(true);
		expect(output).toContain(`"body":${body}`);
		expect(JSON.parse(output)).toEqual({
			id: "batch_req_1",
			custom_id: "req-1",
			response: {
				status_code: 200,
				request_id: "abc",
				body: { id: "chatcmpl-1", n: 100 },
			},
			error: null,
		});
	});

	test("writes errors without a response", () => {
		const output = buildBatchOutputLine({
			id: "batch_req_2",
			customId: 'quote "id"',
			responseStatus: null,
			responseBody: null,
			requestId: null,
			error: { code: "batch_expired", message: "Too late" },
		});

		expect(JSON.parse(output)).toEqual({
			id: "batch_req_2",
			custom_id: 'quote "id"',
			response: null,
			error: { code: "batch_expired", message: "Too late" },
		});
	});

	test("stores non-JSON upstream bodies as JSON strings", () => {
		expect(JSON.parse(toStoredResponseBody("Bad Gateway"))).toBe("Bad Gateway");
	});
});

test("ids use OpenAI prefixes", () => {
	expect(newBatchFileId()).toMatch(/^file-[0-9A-Za-z]{24}$/);
	expect(newBatchId()).toMatch(/^batch_[0-9A-Za-z]{24}$/);
	expect(newBatchRequestId()).toMatch(/^batch_req_[0-9A-Za-z]{24}$/);
});
