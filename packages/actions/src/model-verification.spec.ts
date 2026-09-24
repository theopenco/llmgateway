import { describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	disprovedCapabilities,
	decryptModelVerificationCredential,
	encryptModelVerificationCredential,
	runProviderModelVerification,
} from "./model-verification.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

vi.mock("./gcp-access-token.js", () => ({
	getGcpServiceAccountAccessToken: vi.fn(async () => "derived-access-token"),
}));

const target: ProviderModelVerificationTarget = {
	providerId: "openai",
	modelName: "verification-model",
	externalId: "verification-model-upstream",
	streaming: true,
	vision: true,
	audio: true,
	tools: true,
	jsonOutput: true,
	jsonOutputSchema: true,
	reasoning: true,
	reasoningMaxTokens: true,
	reasoningEfforts: ["low"],
	webSearch: true,
};

describe("model verification", () => {
	it("keeps Chat Completions payloads when the base URL contains /responses", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ choices: [{ message: { content: "OK" } }] }),
			);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "openai-chat-completions",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example/responses-proxy",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledOnce();
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe(
			"https://carrier.example/responses-proxy/v1/chat/completions",
		);
		const payload = JSON.parse(String(request?.body));
		expect(payload).toMatchObject({
			model: "verification-model-upstream",
			messages: expect.any(Array),
		});
		expect(payload).not.toHaveProperty("input");
	});

	it("verifies a custom OpenAI Responses model with the selected protocol", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "OK" }],
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "openai-responses",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledOnce();
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe("https://carrier.example/v1/responses");
		expect(request?.headers).toMatchObject({
			Authorization: "Bearer provider-key",
		});
		expect(JSON.parse(String(request?.body))).toMatchObject({
			model: "verification-model-upstream",
			input: expect.any(Array),
		});
	});

	it("verifies a custom model through Google Vertex", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					candidates: [
						{
							content: { parts: [{ text: "OK" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "google-vertex",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		const [endpoint, request] = fetchImplementation.mock.calls[0];
		expect(endpoint).toBe(
			"https://carrier.example/v1/publishers/google/models/verification-model-upstream:generateContent?key=provider-key",
		);
		expect(request?.headers).not.toMatchObject({
			Authorization: expect.any(String),
		});
		expect(JSON.parse(String(request?.body))).toMatchObject({
			contents: expect.any(Array),
		});
	});

	it("omits reasoning from Responses payloads for a non-reasoning listing", async () => {
		const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				output: [
					{ type: "message", content: [{ type: "output_text", text: "OK" }] },
				],
			}),
		);
		const result = await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				apiFormat: "openai-responses",
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		const payload = JSON.parse(
			String(fetchImplementation.mock.calls[0][1]?.body),
		);
		expect(payload).not.toHaveProperty("reasoning");
		expect(payload).not.toHaveProperty("include");
	});

	// Tool calls are not tied to one upstream API: the carrier picks the format
	// and the preflight probes tools through whichever one it picked.
	it.each([
		{
			apiFormat: "provider-native" as const,
			endpoint: "https://carrier.example/v1/chat/completions",
			body: {
				choices: [
					{
						message: {
							tool_calls: [
								{
									type: "function",
									function: { name: "get_weather", arguments: "{}" },
								},
							],
						},
					},
				],
			},
			expectTools: [{ type: "function", function: { name: "get_weather" } }],
		},
		{
			apiFormat: "openai-chat-completions" as const,
			endpoint: "https://carrier.example/v1/chat/completions",
			body: {
				choices: [
					{
						message: {
							tool_calls: [
								{
									type: "function",
									function: { name: "get_weather", arguments: "{}" },
								},
							],
						},
					},
				],
			},
			expectTools: [{ type: "function", function: { name: "get_weather" } }],
		},
		{
			apiFormat: "openai-responses" as const,
			endpoint: "https://carrier.example/v1/responses",
			body: {
				output: [
					{ type: "function_call", name: "get_weather", arguments: "{}" },
				],
			},
			expectTools: [{ type: "function", name: "get_weather" }],
		},
		{
			apiFormat: "google-vertex" as const,
			endpoint:
				"https://carrier.example/v1/publishers/google/models/verification-model-upstream:generateContent?key=provider-key",
			body: {
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ functionCall: { name: "get_weather", args: {} } }],
						},
					},
				],
			},
			expectTools: [{ functionDeclarations: [{ name: "get_weather" }] }],
		},
	])(
		"verifies tool calls through the $apiFormat upstream API",
		async ({ apiFormat, endpoint, body, expectTools }) => {
			// The basic check answers first; the second call is the tool check.
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					Response.json({
						choices: [{ message: { content: "OK" } }],
						candidates: [
							{ content: { role: "model", parts: [{ text: "OK" }] } },
						],
						output: [
							{
								type: "message",
								content: [{ type: "output_text", text: "OK" }],
							},
						],
					}),
				)
				.mockResolvedValueOnce(Response.json(body));

			const result = await runProviderModelVerification({
				target: {
					...target,
					providerId: "custom-carrier",
					apiFormat,
					streaming: false,
					vision: false,
					audio: false,
					tools: true,
					jsonOutput: false,
					jsonOutputSchema: false,
					reasoning: false,
					reasoningMaxTokens: false,
					webSearch: false,
				},
				token: "provider-key",
				baseUrl: "https://carrier.example",
				fetchImplementation,
			});

			expect(result.checks.map((check) => check.id)).toEqual([
				"basic",
				"tools",
			]);
			expect(result.passed).toBe(true);
			const [toolEndpoint, toolRequest] = fetchImplementation.mock.calls[1];
			expect(toolEndpoint).toBe(endpoint);
			expect(JSON.parse(String(toolRequest?.body)).tools).toMatchObject(
				expectTools,
			);
		},
	);

	const toolOnly = {
		...target,
		providerId: "custom-carrier" as const,
		streaming: false,
		vision: false,
		audio: false,
		tools: true,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		webSearch: false,
	};
	const okResponse = () =>
		Response.json({ choices: [{ message: { content: "OK" } }] });
	// Serving stacks that mishandle a forcing mode leak the model's raw tool
	// markup into the assistant content instead of returning tool_calls.
	const markupResponse = () =>
		Response.json({
			choices: [
				{ message: { content: '<invoke name="get_weather">{}</invoke>' } },
			],
		});
	const toolCallResponse = () =>
		Response.json({
			choices: [
				{
					message: {
						tool_calls: [
							{
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
						],
					},
				},
			],
		});
	const toolChoiceOf = (call: Parameters<typeof fetch>[1] | undefined) =>
		JSON.parse(String(call?.body)).tool_choice;

	it("walks down the tool_choice ladder and reports what failed", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(okResponse())
			.mockResolvedValueOnce(markupResponse())
			.mockResolvedValueOnce(toolCallResponse());

		const result = await runProviderModelVerification({
			target: toolOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledTimes(3);
		expect(toolChoiceOf(fetchImplementation.mock.calls[1][1])).toBe("required");
		expect(toolChoiceOf(fetchImplementation.mock.calls[2][1])).toEqual({
			type: "function",
			function: { name: "get_weather" },
		});
		expect(result.unsupportedToolChoices).toEqual(["required"]);
	});

	it("only probes the tool_choice modes the listing declares", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(okResponse())
			.mockResolvedValueOnce(toolCallResponse());

		const result = await runProviderModelVerification({
			target: { ...toolOnly, supportedToolChoices: ["auto", "none"] },
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(toolChoiceOf(fetchImplementation.mock.calls[1][1])).toBe("auto");
		expect(result.unsupportedToolChoices).toBeUndefined();
	});

	it("fails the tool check when no tool_choice mode calls the tool", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockImplementation(async () =>
				Response.json({ choices: [{ message: { content: "It is sunny." } }] }),
			);

		const result = await runProviderModelVerification({
			target: toolOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(false);
		expect(fetchImplementation).toHaveBeenCalledTimes(4);
		expect(disprovedCapabilities(result.checks)).toEqual(["tools"]);
		expect(result.unsupportedToolChoices).toBeUndefined();
	});

	const reasoningOnly = {
		...target,
		providerId: "custom-carrier" as const,
		streaming: false,
		vision: false,
		audio: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: true,
		reasoningMaxTokens: false,
		reasoningEfforts: null,
		webSearch: false,
	};
	// Runware's DeepSeek V4.1 rejects the tier names it does not implement rather
	// than clamping them onto one it does.
	const refusedEffortResponse = () =>
		Response.json(
			{
				error: {
					message:
						"DeepSeek V4.1 reasoning_effort must be low, high, xhigh, max, or an integer within [1, 100] in chat_template_kwargs",
					type: "invalid_request_error",
				},
			},
			{ status: 400 },
		);
	const effortOf = (call: Parameters<typeof fetch>[1] | undefined) =>
		JSON.parse(String(call?.body)).reasoning_effort;
	const refusingEfforts = (refused: string[]) =>
		vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const effort = JSON.parse(String(init?.body)).reasoning_effort;
			return refused.includes(effort) ? refusedEffortResponse() : okResponse();
		});

	it("passes on the first effort without probing the rest", async () => {
		const fetchImplementation = refusingEfforts([]);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(effortOf(fetchImplementation.mock.calls[1][1])).toBe("medium");
		expect(result.unsupportedReasoningEfforts).toBeUndefined();
	});

	it("sweeps the ladder once a tier is refused", async () => {
		const fetchImplementation = refusingEfforts(["medium", "minimal"]);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		// basic, then the bounded sweep: a refusal means the tiers after it
		// cannot be assumed either.
		expect(fetchImplementation).toHaveBeenCalledTimes(5);
		expect(result.unsupportedReasoningEfforts).toEqual(["medium", "minimal"]);
		expect(disprovedCapabilities(result.checks)).toEqual([]);
		expect(
			result.checks.find((check) => check.id === "reasoning")?.feedback,
		).toBe("Passed at low effort. Refused: medium, minimal.");
	});

	it("only probes the reasoning efforts the listing declares", async () => {
		const fetchImplementation = refusingEfforts([]);

		const result = await runProviderModelVerification({
			target: { ...reasoningOnly, reasoningEfforts: ["none", "max"] },
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(effortOf(fetchImplementation.mock.calls[1][1])).toBe("max");
		expect(result.unsupportedReasoningEfforts).toBeUndefined();
	});

	it("disproves reasoning when every effort is refused", async () => {
		const fetchImplementation = refusingEfforts([
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(false);
		expect(fetchImplementation).toHaveBeenCalledTimes(5);
		expect(disprovedCapabilities(result.checks)).toEqual(["reasoning"]);
		expect(result.unsupportedReasoningEfforts).toBeUndefined();
	});

	it("does not narrow reasoning efforts on a server error", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(async () => okResponse())
			.mockImplementationOnce(async () =>
				Response.json({ error: { message: "upstream down" } }, { status: 503 }),
			);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(false);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(result.unsupportedReasoningEfforts).toBeUndefined();
	});

	it("skips tiers a previous reasoning check already ruled out", async () => {
		const fetchImplementation = refusingEfforts(["medium"]);

		const result = await runProviderModelVerification({
			target: { ...reasoningOnly, reasoningMaxTokens: true },
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		// basic + the swept ladder + the budget check, which no longer retries
		// the tier the reasoning check just saw refused.
		expect(fetchImplementation).toHaveBeenCalledTimes(6);
		expect(effortOf(fetchImplementation.mock.calls[5][1])).toBe("minimal");
		expect(result.unsupportedReasoningEfforts).toEqual(["medium"]);
	});

	it("sends a vision image the serving stack can decode", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockImplementation(async () =>
				Response.json({ choices: [{ message: { content: "It is red." } }] }),
			);

		await runProviderModelVerification({
			target: {
				...target,
				providerId: "custom-carrier",
				streaming: false,
				vision: true,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		const payload = JSON.parse(
			String(fetchImplementation.mock.calls[1][1]?.body),
		);
		const url = payload.messages[0].content[1].image_url.url;
		const png = Buffer.from(url.split(",")[1], "base64");
		expect(png.readUInt32BE(16)).toBeGreaterThan(1);
		expect(png.readUInt32BE(20)).toBeGreaterThan(1);
	});

	it("derives queued checks from mapping-level capabilities", () => {
		expect(
			createQueuedModelVerificationChecks(target).map(({ id }) => id),
		).toEqual([
			"basic",
			"streaming",
			"vision",
			"audio",
			"tools",
			"json_output",
			"structured_json",
			"reasoning",
			"reasoning_budget",
			"web_search",
		]);
	});

	it("validates every declared capability with provider responses", async () => {
		const response = (body: unknown) =>
			new Response(JSON.stringify(body), { status: 200 });
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "OK" } }] }),
			)
			.mockResolvedValueOnce(
				new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The image is red." } }] }),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "I hear a tone." } }] }),
			)
			.mockResolvedValueOnce(
				response({
					choices: [
						{
							message: {
								tool_calls: [
									{
										type: "function",
										function: { name: "get_weather", arguments: "{}" },
									},
								],
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				response({
					choices: [{ message: { content: '{"message":"Hello World"}' } }],
				}),
			)
			.mockResolvedValueOnce(
				response({
					choices: [
						{
							message: {
								content:
									'{"name":"France","capital":"Paris","continent":"Europe"}',
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The answer is 7/4." } }] }),
			)
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "The answer is 7/4." } }] }),
			)
			.mockResolvedValueOnce(
				response({
					output: [
						{ type: "web_search_call", status: "completed" },
						{
							type: "message",
							content: [{ type: "output_text", text: "Today." }],
						},
					],
				}),
			);

		const result = await runProviderModelVerification({
			target,
			token: "provider-key",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(10);
		expect(result.checks.every((check) => check.status === "passed")).toBe(
			true,
		);
		expect(fetchImplementation).toHaveBeenCalledTimes(10);
	});

	it("runs completion and streaming checks without the gateway test runner", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', {
					status: 200,
				}),
			);
		const updates: string[] = [];
		const result = await runProviderModelVerification({
			target: {
				...target,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
			},
			token: "one-run-secret",
			fetchImplementation,
			onCheck: (check) => {
				updates.push(`${check.id}:${check.status}`);
			},
		});

		expect(result).toMatchObject({
			passed: true,
			summary: "2 verification checks passed.",
		});
		expect(updates).toEqual([
			"basic:running",
			"basic:passed",
			"streaming:running",
			"streaming:passed",
		]);
		expect(fetchImplementation).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			name: "vision",
			overrides: { vision: true },
			body: { choices: [{ message: { content: "The image loaded." } }] },
		},
		{
			name: "audio",
			overrides: { audio: true },
			body: { choices: [{ message: { content: "The audio loaded." } }] },
		},
		{
			name: "unfinished web search",
			overrides: { webSearch: true },
			body: {
				output: [
					{ type: "web_search_call", status: "in_progress" },
					{
						type: "message",
						content: [{ type: "output_text", text: "Today." }],
					},
				],
			},
		},
	])("rejects generic $name evidence", async ({ overrides, body }) => {
		const response = (value: unknown) =>
			new Response(JSON.stringify(value), { status: 200 });
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({ choices: [{ message: { content: "OK" } }] }),
			)
			.mockResolvedValueOnce(response(body));
		const result = await runProviderModelVerification({
			target: {
				...target,
				streaming: false,
				vision: false,
				audio: false,
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				webSearch: false,
				...overrides,
			},
			token: "provider-key",
			fetchImplementation,
		});

		expect(result.passed).toBe(false);
		expect(result.checks[1]).toMatchObject({ status: "failed" });
	});

	it("redacts credentials and skips dependent checks after a basic failure", async () => {
		const result = await runProviderModelVerification({
			target: { ...target, vision: false },
			token: "do-not-persist-this",
			fetchImplementation: vi
				.fn<typeof fetch>()
				.mockResolvedValue(
					new Response(
						JSON.stringify({ error: { message: "bad do-not-persist-this" } }),
						{ status: 401 },
					),
				),
		});
		expect(result.passed).toBe(false);
		expect(JSON.stringify(result)).not.toContain("do-not-persist-this");
		expect(result.checks[0]).toMatchObject({ status: "failed" });
		expect(
			result.checks.slice(1).every((check) => check.status === "skipped"),
		).toBe(true);
	});

	it("redacts the derived access token on failure paths", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: "bad derived-access-token" } }),
					{ status: 401 },
				),
			);
		const result = await runProviderModelVerification({
			target: { ...target, providerId: "google-vertex" },
			token: '{"type":"service_account"}',
			providerKeyOptions: {
				google_vertex_project_id: "verification-project",
				google_vertex_token_type: "oauth",
			},
			skipEnvVars: true,
			fetchImplementation,
		});
		expect(result.passed).toBe(false);
		expect(fetchImplementation).toHaveBeenCalledTimes(1);
		const [, request] = fetchImplementation.mock.calls[0];
		expect(request?.headers).toMatchObject({
			Authorization: "Bearer derived-access-token",
		});
		expect(JSON.stringify(result)).not.toContain("derived-access-token");
		expect(result.checks[0]).toMatchObject({ status: "failed" });
	});

	it("binds supplied credentials to one verification and company", () => {
		const ciphertext = encryptModelVerificationCredential(
			"provider-key",
			"verification-1",
			"company-1",
		);
		expect(ciphertext).not.toContain("provider-key");
		expect(
			decryptModelVerificationCredential(
				ciphertext,
				"verification-1",
				"company-1",
			),
		).toBe("provider-key");
		expect(() =>
			decryptModelVerificationCredential(
				ciphertext,
				"verification-2",
				"company-1",
			),
		).toThrow();
	});
});
