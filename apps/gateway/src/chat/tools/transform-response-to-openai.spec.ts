import { describe, expect, test } from "vitest";

import {
	transformResponseToOpenai,
	stripRequestScopedMetadataFromOpenAiResponse,
	withCurrentRequestMetadataOnOpenAiResponse,
} from "./transform-response-to-openai.js";

describe("transformResponseToOpenai", () => {
	test("includes request_id in response metadata", () => {
		const response = transformResponseToOpenai(
			"openai",
			"gpt-4o-mini",
			{
				id: "chatcmpl-test",
				object: "chat.completion",
				created: 1,
				model: "gpt-4o-mini",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "OK",
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 1,
					total_tokens: 2,
				},
			},
			"OK",
			null,
			"stop",
			1,
			1,
			2,
			null,
			null,
			null,
			[],
			"openai/gpt-4o-mini",
			"openai",
			"gpt-4o-mini",
			null,
			false,
			null,
			null,
			"req_test_123",
		);

		expect(response.metadata).toMatchObject({
			request_id: "req_test_123",
			requested_model: "openai/gpt-4o-mini",
			requested_provider: "openai",
			used_model: "gpt-4o-mini",
			used_provider: "openai",
			underlying_used_model: "gpt-4o-mini",
		});
	});

	test("strips request-scoped metadata before caching", () => {
		const response = stripRequestScopedMetadataFromOpenAiResponse({
			metadata: {
				request_id: "req_old",
				routing: [
					{
						provider: "openai",
						model: "gpt-4o-mini",
						status_code: 500,
						error_type: "upstream_error",
						succeeded: false,
						apiKeyHash: "hash-a",
						logId: "log-a",
					},
				],
			},
		});

		expect(response.metadata).toEqual({
			routing: [
				{
					provider: "openai",
					model: "gpt-4o-mini",
					status_code: 500,
					error_type: "upstream_error",
					succeeded: false,
				},
			],
		});
	});

	test("applies the current request id to cached responses", () => {
		const response = withCurrentRequestMetadataOnOpenAiResponse(
			{
				metadata: {
					request_id: "req_old",
					routing: [
						{
							provider: "openai",
							model: "gpt-4o-mini",
							status_code: 500,
							error_type: "upstream_error",
							succeeded: false,
							apiKeyHash: "hash-a",
							logId: "log-a",
						},
					],
				},
			},
			"req_new",
		);

		expect(response.metadata).toEqual({
			request_id: "req_new",
			routing: [
				{
					provider: "openai",
					model: "gpt-4o-mini",
					status_code: 500,
					error_type: "upstream_error",
					succeeded: false,
				},
			],
		});
	});
});
