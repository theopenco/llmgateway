import { describe, expect, test } from "vitest";

import {
	applyExtendedUsageFields,
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

	test("emits extended usage fields", () => {
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
						message: { role: "assistant", content: "hi" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
			},
			"hi",
			null,
			"stop",
			10,
			20,
			30,
			5,
			3,
			null,
			[],
			"openai/gpt-4o-mini",
			"openai",
			"gpt-4o-mini",
			{
				inputCost: 0.001,
				outputCost: 0.004,
				cachedInputCost: 0.0002,
				requestCost: 0,
				webSearchCost: 0,
				imageInputCost: null,
				imageOutputCost: null,
				totalCost: 0.0052,
			},
			false,
			null,
			null,
			"req_or_1",
			undefined,
			2,
		);

		expect(response.usage).toMatchObject({
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
			cost: 0.0052,
			cost_details: {
				upstream_inference_cost: 0.001 + 0.0002 + 0.004,
				upstream_inference_prompt_cost: 0.001 + 0.0002,
				upstream_inference_completions_cost: 0.004,
				total_cost: 0.0052,
				input_cost: 0.001,
				output_cost: 0.004,
				cached_input_cost: 0.0002,
				request_cost: 0,
				web_search_cost: 0,
				image_input_cost: null,
				image_output_cost: null,
			},
			prompt_tokens_details: {
				cached_tokens: 3,
				cache_write_tokens: 2,
				cache_creation_tokens: 2,
				audio_tokens: 0,
				video_tokens: 0,
			},
			completion_tokens_details: {
				reasoning_tokens: 5,
				image_tokens: 0,
				audio_tokens: 0,
			},
		});
	});

	test("emits data_storage_cost when provided", () => {
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
						message: { role: "assistant", content: "hi" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
			},
			"hi",
			null,
			"stop",
			10,
			20,
			30,
			null,
			null,
			null,
			[],
			"openai/gpt-4o-mini",
			"openai",
			"gpt-4o-mini",
			{
				inputCost: 0.001,
				outputCost: 0.004,
				cachedInputCost: 0,
				requestCost: 0,
				webSearchCost: 0,
				imageInputCost: null,
				imageOutputCost: null,
				totalCost: 0.005,
				dataStorageCost: 0.000003,
			},
			false,
			null,
			null,
			"req_or_2",
		);

		expect(response.usage).toMatchObject({
			cost_details: {
				data_storage_cost: 0.000003,
			},
		});
	});

	test("applyExtendedUsageFields defaults zeros when nothing is set", () => {
		const usage: Record<string, any> = {
			prompt_tokens: 5,
			completion_tokens: 7,
			total_tokens: 12,
		};
		applyExtendedUsageFields(usage, {
			costs: null,
			cachedTokens: null,
			cacheCreationTokens: null,
			reasoningTokens: null,
		});
		expect(usage.is_byok).toBeUndefined();
		expect(usage.prompt_tokens_details).toEqual({
			cached_tokens: 0,
			cache_write_tokens: 0,
			audio_tokens: 0,
			video_tokens: 0,
			image_tokens: 0,
		});
		expect(usage.completion_tokens_details).toEqual({
			reasoning_tokens: 0,
			image_tokens: 0,
			audio_tokens: 0,
		});
		expect(usage.cost).toBeUndefined();
		expect(usage.cost_details).toBeUndefined();
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
