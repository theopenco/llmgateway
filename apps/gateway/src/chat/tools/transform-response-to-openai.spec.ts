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

	test("preserves returned service_tier", () => {
		const response = transformResponseToOpenai(
			"openai",
			"gpt-5.5",
			{
				id: "chatcmpl-test",
				object: "chat.completion",
				created: 1,
				model: "gpt-5.5",
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
			"openai/gpt-5.5",
			"openai",
			"gpt-5.5",
			null,
			false,
			null,
			null,
			"req_tier_123",
			undefined,
			null,
			null,
			null,
			null,
			null,
			null,
			"priority",
		);

		expect(response.service_tier).toBe("priority");
	});

	test("maps Google multi-candidate responses to per-choice output", () => {
		const json = {
			candidates: [
				{
					content: {
						parts: [
							{ text: "thought A", thought: true },
							{ text: "Variant one." },
							// AI Studio quirk: candidate 0 carries duplicated copies
							// of the other candidates' parts as a suffix.
							{ text: "Variant two." },
							{ text: "Variant three." },
						],
						role: "model",
					},
					finishReason: "STOP",
					// index omitted: Vertex drops the proto3 zero value on
					// candidate 0, so the transform must fall back to position.
				},
				{
					content: { parts: [{ text: "Variant two." }], role: "model" },
					finishReason: "STOP",
					index: 1,
				},
				{
					content: { parts: [{ text: "Variant three." }], role: "model" },
					finishReason: "MAX_TOKENS",
					index: 2,
				},
			],
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 60,
				totalTokenCount: 70,
			},
		};

		const response = transformResponseToOpenai(
			"google-ai-studio",
			"gemini-2.5-flash",
			json,
			// parse-provider-response aggregates every candidate for the log
			// row; the transform must NOT write this back into choice 0.
			"Variant one.Variant two.Variant three.",
			"thought A",
			"STOP",
			10,
			60,
			70,
			null,
			null,
			null,
			[],
			"gemini-2.5-flash",
			null,
			"gemini-2.5-flash",
			null,
			false,
			null,
			null,
			"req_google_n",
		);

		expect(response.choices).toHaveLength(3);
		expect(response.choices[0].index).toBe(0);
		expect(response.choices[0].message.content).toBe("Variant one.");
		expect(response.choices[0].message.reasoning).toBe("thought A");
		expect(response.choices[0].finish_reason).toBe("stop");
		expect(response.choices[1].index).toBe(1);
		expect(response.choices[1].message.content).toBe("Variant two.");
		expect(response.choices[1].message.reasoning).toBeUndefined();
		expect(response.choices[1].finish_reason).toBe("stop");
		expect(response.choices[2].index).toBe(2);
		expect(response.choices[2].message.content).toBe("Variant three.");
		expect(response.choices[2].finish_reason).toBe("length");
		expect(response.usage.prompt_tokens).toBe(10);
		expect(response.usage.completion_tokens).toBe(60);
	});

	test("keys Google multi-candidate tool calls to their own choice", () => {
		const json = {
			candidates: [
				{
					content: {
						parts: [
							{
								functionCall: { name: "get_weather", args: { city: "Paris" } },
							},
							// duplicated copy of candidate 1's part
							{
								functionCall: { name: "get_weather", args: { city: "Rome" } },
							},
						],
						role: "model",
					},
					finishReason: "STOP",
					index: 0,
				},
				{
					content: {
						parts: [
							{
								functionCall: { name: "get_weather", args: { city: "Rome" } },
							},
						],
						role: "model",
					},
					finishReason: "STOP",
					index: 1,
				},
			],
		};

		const response = transformResponseToOpenai(
			"google-ai-studio",
			"gemini-2.5-flash",
			json,
			null,
			null,
			"STOP",
			10,
			20,
			30,
			null,
			null,
			null,
			[],
			"gemini-2.5-flash",
			null,
			"gemini-2.5-flash",
			null,
			false,
			null,
			null,
			"req_google_n_tools",
		);

		expect(response.choices).toHaveLength(2);
		expect(response.choices[0].message.tool_calls).toHaveLength(1);
		expect(response.choices[0].message.tool_calls[0]).toMatchObject({
			id: "get_weather_0_0",
			function: {
				name: "get_weather",
				arguments: JSON.stringify({ city: "Paris" }),
			},
		});
		expect(response.choices[0].finish_reason).toBe("tool_calls");
		expect(response.choices[1].message.tool_calls).toHaveLength(1);
		expect(response.choices[1].message.tool_calls[0]).toMatchObject({
			id: "get_weather_1_0",
			function: {
				name: "get_weather",
				arguments: JSON.stringify({ city: "Rome" }),
			},
		});
		expect(response.choices[1].finish_reason).toBe("tool_calls");
	});

	test("does not overwrite choice 0 content on multi-choice OpenAI responses", () => {
		const json = {
			id: "chatcmpl-multi",
			object: "chat.completion",
			created: 1,
			model: "gpt-4o-mini",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "variant 1" },
					finish_reason: "stop",
				},
				{
					index: 1,
					message: { role: "assistant", content: "variant 2" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
		};

		const response = transformResponseToOpenai(
			"openai",
			"gpt-4o-mini",
			json,
			// Aggregated across choices for the log row — must not leak into
			// choice 0 of the client response.
			"variant 1variant 2",
			null,
			"stop",
			10,
			20,
			30,
			null,
			null,
			null,
			[],
			"gpt-4o-mini",
			null,
			"gpt-4o-mini",
			null,
			false,
			null,
			null,
			"req_openai_n",
		);

		expect(response.choices[0].message.content).toBe("variant 1");
		expect(response.choices[1].message.content).toBe("variant 2");
	});

	test("strips request-scoped metadata before caching", () => {
		const response = stripRequestScopedMetadataFromOpenAiResponse({
			metadata: {
				request_id: "req_old",
				log_id: "log-old",
				organization_id: "org-old",
				project_id: "project-old",
				discount: 0.2,
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
					log_id: "log-old",
					organization_id: "org-old",
					project_id: "project-old",
					discount: 0.2,
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
			{
				logId: "log-new",
				organizationId: "org-new",
				projectId: "project-new",
				discount: 0.1,
			},
		);

		expect(response.metadata).toEqual({
			request_id: "req_new",
			log_id: "log-new",
			organization_id: "org-new",
			project_id: "project-new",
			discount: 0.1,
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
