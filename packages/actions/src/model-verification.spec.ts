import { describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	disprovedCapabilities,
	decryptModelVerificationCredential,
	encryptModelVerificationCredential,
	runProviderKeySmokeTest,
	runProviderModelVerification,
} from "./model-verification.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

vi.mock("./gcp-access-token.js", () => ({
	getGcpServiceAccountAccessToken: vi.fn(async () => "derived-access-token"),
}));

// What a well-behaved Chat Completions endpoint returns: the fields the
// gateway passes through and the usage it bills from.
const chatUsage = { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 };
const chatBody = (
	message: Record<string, unknown>,
	finishReason = "stop",
	usage: Record<string, unknown> = chatUsage,
) => ({
	id: "chatcmpl-verification",
	object: "chat.completion",
	created: 1_700_000_000,
	choices: [
		{
			index: 0,
			message: { role: "assistant", ...message },
			finish_reason: finishReason,
		},
	],
	usage,
});
// An OpenAI-compatible stream honouring stream_options.include_usage.
const chatStream = (usage: Record<string, unknown> | null = chatUsage) =>
	[
		{ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] },
		{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		...(usage ? [{ choices: [], usage }] : []),
	]
		.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
		.join("") + "data: [DONE]\n\n";
const responsesUsage = { input_tokens: 20, output_tokens: 2, total_tokens: 22 };
const googleUsage = {
	promptTokenCount: 20,
	candidatesTokenCount: 2,
	totalTokenCount: 22,
};

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
			.mockResolvedValue(Response.json(chatBody({ content: "OK" })));
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
					usage: responsesUsage,
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
					usageMetadata: googleUsage,
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
				usage: responsesUsage,
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
			body: chatBody(
				{
					tool_calls: [
						{
							type: "function",
							function: { name: "get_weather", arguments: "{}" },
						},
					],
				},
				"tool_calls",
			),
			expectTools: [{ type: "function", function: { name: "get_weather" } }],
		},
		{
			apiFormat: "openai-chat-completions" as const,
			endpoint: "https://carrier.example/v1/chat/completions",
			body: chatBody(
				{
					tool_calls: [
						{
							type: "function",
							function: { name: "get_weather", arguments: "{}" },
						},
					],
				},
				"tool_calls",
			),
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
						...chatBody({ content: "OK" }),
						usageMetadata: googleUsage,
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
	const okResponse = () => Response.json(chatBody({ content: "OK" }));
	// Serving stacks that mishandle a forcing mode leak the model's raw tool
	// markup into the assistant content instead of returning tool_calls.
	const markupResponse = () =>
		Response.json({
			choices: [
				{ message: { content: '<invoke name="get_weather">{}</invoke>' } },
			],
		});
	const toolCall = {
		type: "function",
		function: { name: "get_weather", arguments: "{}" },
	};
	const toolCallResponse = (finishReason = "tool_calls") =>
		Response.json(chatBody({ tool_calls: [toolCall] }, finishReason));
	const toolChoiceOf = (call: Parameters<typeof fetch>[1] | undefined) =>
		JSON.parse(String(call?.body)).tool_choice;

	it.each([429, 500, 503])(
		"does not narrow tool choices after HTTP %i",
		async (status) => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(okResponse())
				.mockResolvedValueOnce(
					new Response("Temporarily unavailable", { status }),
				)
				.mockResolvedValue(toolCallResponse());
			const result = await runProviderModelVerification({
				target: toolOnly,
				token: "provider-key",
				baseUrl: "https://carrier.example",
				fetchImplementation,
			});
			expect(result.passed).toBe(false);
			expect(result.unsupportedToolChoices).toBeUndefined();
			expect(fetchImplementation).toHaveBeenCalledTimes(2);
		},
	);
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
		expect(
			result.checks
				.find((check) => check.id === "tools")
				?.probes?.map((probe) => [probe.label, probe.status]),
		).toEqual([
			["tool_choice: required", "failed"],
			["tool_choice: function", "passed"],
		]);
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
				Response.json(chatBody({ content: "It is sunny." })),
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
	const reasoningResponse = () =>
		Response.json(
			chatBody({
				content: "7/4",
				reasoning_content: "2/3 + 1/4 + 5/6 = 21/12",
			}),
		);
	const effortOf = (call: Parameters<typeof fetch>[1] | undefined) =>
		JSON.parse(String(call?.body)).reasoning_effort;
	const refusingEfforts = (refused: string[]) =>
		vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const effort = JSON.parse(String(init?.body)).reasoning_effort;
			return refused.includes(effort)
				? refusedEffortResponse()
				: reasoningResponse();
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
		// basic, then every tier: a refusal means the ones after it cannot be
		// assumed either.
		expect(fetchImplementation).toHaveBeenCalledTimes(7);
		expect(result.unsupportedReasoningEfforts).toEqual(["medium", "minimal"]);
		expect(disprovedCapabilities(result.checks)).toEqual([]);
		expect(
			result.checks.find((check) => check.id === "reasoning")?.feedback,
		).toBe("Passed at low effort. Refused: medium, minimal.");
	});

	it("stops sweeping once the time budget is spent", async () => {
		const fetchImplementation = refusingEfforts(["medium"]);
		// Hold the clock still until basic, the refused medium and the passing
		// minimal have gone out, then jump past the four-minute budget.
		const nowSpy = vi
			.spyOn(Date, "now")
			.mockImplementation(() =>
				fetchImplementation.mock.calls.length >= 3 ? 10 * 60 * 1000 : 0,
			);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		// basic, medium (refused), minimal (passed), then the budget cuts it off.
		expect(fetchImplementation).toHaveBeenCalledTimes(3);
		expect(result.unsupportedReasoningEfforts).toEqual(["medium"]);
		expect(disprovedCapabilities(result.checks)).toEqual([]);
		nowSpy.mockRestore();
	});

	it("keeps probing past the budget until a tier has passed", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10 * 60 * 1000);
		const fetchImplementation = refusingEfforts(["medium", "minimal", "low"]);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		// The budget curtails the search for more refusals, never the verdict.
		expect(result.passed).toBe(true);
		expect(result.unsupportedReasoningEfforts).toEqual([
			"medium",
			"minimal",
			"low",
		]);
		nowSpy.mockRestore();
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
		expect(fetchImplementation).toHaveBeenCalledTimes(7);
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
		expect(fetchImplementation).toHaveBeenCalledTimes(8);
		expect(effortOf(fetchImplementation.mock.calls[7][1])).toBe("minimal");
		expect(result.unsupportedReasoningEfforts).toEqual(["medium"]);
	});

	it("reports every probed reasoning tier and its outcome", async () => {
		const fetchImplementation = refusingEfforts(["medium", "minimal"]);

		const result = await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		const reasoning = result.checks.find((check) => check.id === "reasoning");
		expect(
			reasoning?.probes?.map((probe) => [probe.label, probe.status]),
		).toEqual([
			["reasoning_effort: medium", "failed"],
			["reasoning_effort: minimal", "failed"],
			["reasoning_effort: low", "passed"],
			["reasoning_effort: high", "passed"],
			["reasoning_effort: xhigh", "passed"],
			["reasoning_effort: max", "passed"],
		]);
		expect(reasoning?.probes?.[0].feedback).toContain(
			"reasoning_effort must be",
		);
	});

	it("carries the tiers an earlier check ruled out into the breakdown", async () => {
		const fetchImplementation = refusingEfforts(["medium"]);

		const result = await runProviderModelVerification({
			target: { ...reasoningOnly, reasoningMaxTokens: true },
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
		});

		const budget = result.checks.find(
			(check) => check.id === "reasoning_budget",
		);
		expect(budget?.probes?.[0]).toEqual({
			label: "reasoning_effort: medium",
			status: "failed",
			feedback: "Refused by an earlier reasoning check.",
		});
	});

	it("streams the probe breakdown while the check is still running", async () => {
		const fetchImplementation = refusingEfforts(["medium", "minimal"]);
		const running: (string[] | undefined)[] = [];

		await runProviderModelVerification({
			target: reasoningOnly,
			token: "provider-key",
			baseUrl: "https://carrier.example",
			fetchImplementation,
			onCheck: (check) => {
				if (check.id === "reasoning" && check.status === "running") {
					running.push(check.probes?.map((probe) => probe.label));
				}
			},
		});

		expect(running[0]).toBeUndefined();
		expect(running[1]).toEqual(["reasoning_effort: medium"]);
		expect(running.at(-1)).toHaveLength(6);
	});

	it("sends a vision image the serving stack can decode", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockImplementation(async () =>
				Response.json(chatBody({ content: "It is red." })),
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

	describe("optional checks", () => {
		const basicOnly: ProviderModelVerificationTarget = {
			...target,
			providerId: "custom-carrier",
			streaming: false,
			vision: false,
			audio: false,
			tools: false,
			jsonOutput: false,
			jsonOutputSchema: false,
			reasoning: false,
			reasoningMaxTokens: false,
			webSearch: false,
		};
		const streamingOnly = { ...basicOnly, streaming: true };
		// Runs with optional checks required.
		const run = (
			verificationTarget: ProviderModelVerificationTarget,
			...bodies: (string | Record<string, unknown>)[]
		) => runOptional(verificationTarget, true, ...bodies);
		const runOptional = (
			verificationTarget: ProviderModelVerificationTarget,
			requireOptionalChecks: boolean | undefined,
			...bodies: (string | Record<string, unknown>)[]
		) => {
			const fetchImplementation = vi.fn<typeof fetch>();
			for (const body of bodies) {
				fetchImplementation.mockResolvedValueOnce(
					typeof body === "string"
						? new Response(body, { status: 200 })
						: Response.json(body),
				);
			}
			return runProviderModelVerification({
				target: verificationTarget,
				token: "provider-key",
				baseUrl: "https://carrier.example",
				fetchImplementation,
				requireOptionalChecks,
			}).then((result) => ({ result, fetchImplementation }));
		};

		it("only warns about optional checks until they are required", async () => {
			const { result } = await runOptional(
				{ ...streamingOnly, reasoning: true, reasoningEfforts: ["high"] },
				undefined,
				{ ...chatBody({ content: "OK" }), usage: undefined },
				chatStream(null),
				chatBody({ content: "The answer is 7/4." }),
			);

			expect(result.passed).toBe(true);
			expect(result.summary).toBe(
				"3 verification checks passed (3 with a warning).",
			);
			expect(result.checks).toMatchObject([
				{
					id: "basic",
					status: "passed",
					optionalWarnings: [
						expect.stringContaining("The response did not report token usage"),
					],
				},
				{
					id: "streaming",
					status: "passed",
					optionalWarnings: [
						expect.stringContaining("stream_options.include_usage"),
					],
				},
				{
					id: "reasoning",
					status: "passed",
					optionalWarnings: [
						expect.stringContaining("The response showed no reasoning"),
					],
				},
			]);
		});

		it.each([
			{
				name: "text",
				stream: `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: chatUsage })}\n\n`,
				feedback: "The stream did not contain any assistant text.",
			},
			{
				name: "a finish reason",
				stream: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" } }], usage: chatUsage })}\n\n`,
				feedback: "The stream ended without a finish reason.",
			},
		])(
			"fails a stream without $name even while other checks are optional",
			async ({ stream, feedback }) => {
				const { result } = await runOptional(
					streamingOnly,
					undefined,
					chatBody({ content: "OK" }),
					stream,
				);

				expect(result.checks[1]).toMatchObject({
					id: "streaming",
					status: "failed",
					feedback,
				});
			},
		);

		it("does not warn about a probe that failed for another reason", async () => {
			const { result } = await runOptional(
				{ ...basicOnly, tools: true },
				false,
				chatBody({ content: "OK" }),
				{ choices: [{ message: { content: "It is sunny." } }] },
				chatBody({ tool_calls: [toolCall] }, "tool_calls"),
			);

			expect(result.passed).toBe(true);
			expect(result.checks[1].optionalWarnings).toBeUndefined();
		});

		it.each([
			{
				name: "no usage",
				body: { ...chatBody({ content: "OK" }), usage: undefined },
				feedback: "The response did not report token usage",
			},
			{
				name: "zero output tokens",
				body: chatBody({ content: "OK" }, "stop", {
					prompt_tokens: 20,
					completion_tokens: 0,
				}),
				feedback: "The response reported 0 output tokens",
			},
			{
				name: "more cached than input tokens",
				body: chatBody({ content: "OK" }, "stop", {
					...chatUsage,
					prompt_tokens_details: { cached_tokens: 50 },
				}),
				feedback: "50 cached input tokens out of 20 input tokens",
			},
			{
				name: "a negative cached token count",
				body: chatBody({ content: "OK" }, "stop", {
					...chatUsage,
					prompt_tokens_details: { cached_tokens: -3 },
				}),
				feedback: "reported -3 cached tokens",
			},
			{
				name: "a fractional token count",
				body: chatBody({ content: "OK" }, "stop", {
					prompt_tokens: 20.5,
					completion_tokens: 2,
				}),
				feedback: "reported 20.5 input tokens",
			},
			{
				name: "no response id",
				body: { ...chatBody({ content: "OK" }), id: undefined },
				feedback: "The response has no id",
			},
		])(
			"fails the basic check on $name but still runs the rest",
			async ({ body, feedback }) => {
				const { result } = await run(streamingOnly, body, chatStream());

				expect(result.passed).toBe(false);
				expect(result.checks).toMatchObject([
					{
						id: "basic",
						status: "failed",
						feedback: expect.stringContaining(feedback),
					},
					{ id: "streaming", status: "passed" },
				]);
			},
		);

		it.each([
			{
				name: "Anthropic Messages",
				body: {
					content: [{ type: "text", text: "OK" }],
					usage: {
						input_tokens: 5,
						cache_read_input_tokens: 15,
						output_tokens: 2,
					},
				},
			},
			{
				name: "Bedrock Converse",
				body: {
					output: { message: { content: [{ text: "OK" }] } },
					usage: { inputTokens: 20, outputTokens: 2 },
				},
			},
		])("reads $name usage", async ({ body }) => {
			const { result } = await run(basicOnly, body);

			expect(result.passed).toBe(true);
		});

		it("requests usage on the stream and checks it against the basic run", async () => {
			const { result, fetchImplementation } = await run(
				streamingOnly,
				chatBody({ content: "OK" }),
				chatStream(),
			);

			expect(result.passed).toBe(true);
			expect(
				JSON.parse(String(fetchImplementation.mock.calls[1][1]?.body)),
			).toMatchObject({
				stream: true,
				stream_options: { include_usage: true },
			});
		});

		it.each([
			{
				name: "a stream without a usage chunk",
				stream: chatStream(null),
				feedback:
					"The stream did not report token usage. Input and output token counts are needed for billing. OpenAI-compatible streams must honour stream_options.include_usage with a final usage chunk.",
			},
			{
				name: "usage sent as per-chunk increments",
				stream: [
					{
						choices: [{ index: 0, delta: { content: "O" } }],
						usage: { prompt_tokens: 20, completion_tokens: 1 },
					},
					{
						choices: [
							{ index: 0, delta: { content: "K" }, finish_reason: "stop" },
						],
						usage: { prompt_tokens: 0, completion_tokens: 1 },
					},
				]
					.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
					.join(""),
				feedback: "The stream reported 0 input tokens",
			},
			{
				name: "stream usage that disagrees with the basic run",
				stream: chatStream({ prompt_tokens: 200, completion_tokens: 2 }),
				feedback:
					"The stream reported 200 input tokens for the prompt the non-streaming request reported 20 input tokens for.",
			},
			{
				name: "usage reported only before the finish reason",
				stream: [
					{
						choices: [{ index: 0, delta: { content: "O" } }],
						usage: chatUsage,
					},
					{
						choices: [
							{ index: 0, delta: { content: "K" }, finish_reason: "stop" },
						],
					},
				]
					.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
					.join(""),
				feedback: "The stream reported usage only before its finish reason.",
			},
			{
				name: "a stream without a finish reason",
				stream: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" } }], usage: chatUsage })}\n\n`,
				feedback: "The stream ended without a finish reason.",
			},
			{
				name: "a stream without text",
				stream: `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: chatUsage })}\n\n`,
				feedback: "The stream did not contain any assistant text.",
			},
		])("fails the streaming check on $name", async ({ stream, feedback }) => {
			const { result } = await run(
				streamingOnly,
				chatBody({ content: "OK" }),
				stream,
			);

			expect(result.checks[1]).toMatchObject({
				id: "streaming",
				status: "failed",
				feedback: expect.stringContaining(feedback),
			});
			expect(disprovedCapabilities(result.checks)).toEqual(["streaming"]);
		});

		it("reads usage from an Anthropic Messages stream", async () => {
			const events = [
				{
					type: "message_start",
					message: { usage: { input_tokens: 20, output_tokens: 1 } },
				},
				{
					type: "content_block_delta",
					delta: { type: "text_delta", text: "OK" },
				},
				{
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 2 },
				},
				{ type: "message_stop" },
			];
			const { result } = await run(
				streamingOnly,
				{
					content: [{ type: "text", text: "OK" }],
					usage: { input_tokens: 20, output_tokens: 2 },
				},
				events
					.map(
						(event) =>
							`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
					)
					.join(""),
			);

			expect(result.passed).toBe(true);
		});

		it("leaves optional checks out of a key smoke test", async () => {
			const failure = await runProviderKeySmokeTest({
				target: basicOnly,
				token: "provider-key",
				baseUrl: "https://carrier.example",
				fetchImplementation: vi
					.fn<typeof fetch>()
					.mockResolvedValue(
						Response.json({ choices: [{ message: { content: "OK" } }] }),
					),
			});

			expect(failure).toBeNull();
		});

		it("fails tools without narrowing when tool calls finish with stop", async () => {
			const { result, fetchImplementation } = await run(
				{ ...basicOnly, tools: true },
				chatBody({ content: "OK" }),
				chatBody({ tool_calls: [toolCall] }, "stop"),
			);

			expect(fetchImplementation).toHaveBeenCalledTimes(2);
			expect(result.checks[1]).toMatchObject({
				id: "tools",
				status: "failed",
				feedback: expect.stringContaining(
					'finish_reason is "stop". It must be "tool_calls"',
				),
			});
			expect(result.unsupportedToolChoices).toBeUndefined();
		});

		it("fails tool calls finishing with stop even while other checks are optional", async () => {
			const { result } = await runOptional(
				{ ...basicOnly, tools: true },
				undefined,
				chatBody({ content: "OK" }),
				chatBody({ tool_calls: [toolCall] }, "stop"),
			);

			expect(result.passed).toBe(false);
			expect(result.checks[1]).toMatchObject({
				id: "tools",
				status: "failed",
				feedback: expect.stringContaining('It must be "tool_calls"'),
			});
			expect(result.checks[1].optionalWarnings).toBeUndefined();
		});

		it("accepts stop for a named tool_choice, as OpenAI returns it", async () => {
			const { result } = await run(
				{ ...basicOnly, tools: true, supportedToolChoices: ["function"] },
				chatBody({ content: "OK" }),
				chatBody({ tool_calls: [toolCall] }, "stop"),
			);

			expect(result.passed).toBe(true);
		});

		it("fails reasoning when the endpoint ignores reasoning_effort", async () => {
			const { result, fetchImplementation } = await run(
				{ ...basicOnly, reasoning: true, reasoningEfforts: null },
				chatBody({ content: "OK" }),
				chatBody({ content: "The answer is 7/4." }),
			);

			expect(fetchImplementation).toHaveBeenCalledTimes(2);
			expect(result.checks[1]).toMatchObject({
				id: "reasoning",
				status: "failed",
				feedback: expect.stringContaining("The response showed no reasoning"),
			});
			expect(result.unsupportedReasoningEfforts).toBeUndefined();
		});

		it.each([
			{
				name: "reasoning text",
				message: { content: "7/4", reasoning: "2/3 = 8/12" },
			},
			{
				name: "inline think tags",
				message: { content: "<think>8/12</think>7/4" },
			},
		])("accepts $name as reasoning evidence", async ({ message }) => {
			const { result } = await run(
				{ ...basicOnly, reasoning: true, reasoningEfforts: ["high"] },
				chatBody({ content: "OK" }),
				chatBody(message),
			);

			expect(result.passed).toBe(true);
		});

		it("does not take a Responses reasoning echo for evidence", async () => {
			const { result } = await run(
				{
					...basicOnly,
					apiFormat: "openai-responses",
					reasoning: true,
					reasoningEfforts: ["high"],
				},
				{
					output: [
						{ type: "message", content: [{ type: "output_text", text: "OK" }] },
					],
					usage: responsesUsage,
				},
				{
					reasoning: { effort: "high", summary: null },
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "7/4" }],
						},
					],
					usage: responsesUsage,
				},
			);

			expect(disprovedCapabilities(result.checks)).toEqual(["reasoning"]);
		});
	});

	describe("declared limits", () => {
		const limitsTarget: ProviderModelVerificationTarget = {
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
			contextSize: 10_000,
			maxOutput: 4_096,
		};
		const respond = (promptTokens: number) =>
			vi.fn<typeof fetch>().mockImplementation(async () =>
				Response.json({
					...chatBody({ content: "OK" }),
					usage: { prompt_tokens: promptTokens, completion_tokens: 1 },
				}),
			);

		it("queues a check per declared limit", () => {
			expect(
				createQueuedModelVerificationChecks(limitsTarget).map(({ id }) => id),
			).toEqual(["basic", "context_size", "max_output"]);
		});

		it("fills the declared window and requests the declared output", async () => {
			const fetchImplementation = respond(5_000);
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation,
			});

			expect(result.passed).toBe(true);
			const [, context, output] = fetchImplementation.mock.calls.map(
				([, request]) => JSON.parse(String(request?.body)),
			);
			// 70% of the window at 3 chars per token.
			expect(context.messages[0].content.length).toBeGreaterThan(21_000);
			expect(JSON.stringify(output)).toContain("4096");
		});

		it("fails the context check when the upstream refuses the prompt", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockImplementation(async (_url, request) =>
					String(request?.body).length > 20_000
						? Response.json(
								{ error: { message: "maximum context length is 4096" } },
								{ status: 400 },
							)
						: Response.json(chatBody({ content: "OK" })),
				);
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation,
			});

			expect(result.passed).toBe(false);
			expect(result.checks).toMatchObject([
				{ id: "basic", status: "passed" },
				{
					id: "context_size",
					status: "failed",
					feedback:
						'Your endpoint refused a test prompt filling about 70% of the declared 10,000-token context size. It answered: "maximum context length is 4096"',
				},
				{ id: "max_output", status: "passed" },
			]);
		});

		it("fails the context check when the reported input was truncated", async () => {
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation: respond(1_000),
			});

			expect(result.checks[1]).toMatchObject({
				id: "context_size",
				status: "failed",
				feedback: expect.stringContaining("1000 input tokens"),
			});
		});

		it("caps the prompt for an oversized declared window", async () => {
			const fetchImplementation = respond(1_500_000);
			const result = await runProviderModelVerification({
				target: { ...limitsTarget, contextSize: 100_000_000 },
				token: "provider-key",
				fetchImplementation,
			});

			expect(result.passed).toBe(true);
			const context = String(fetchImplementation.mock.calls[1][1]?.body);
			expect(context.length).toBeLessThan(6_100_000);
		});

		it("fails the context check on a failed response envelope", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockImplementation(async (_url, request) =>
					String(request?.body).length > 20_000
						? Response.json({
								status: "failed",
								error: { message: "context window exceeded" },
							})
						: Response.json(chatBody({ content: "OK" })),
				);
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation,
			});

			expect(result.checks[1]).toMatchObject({
				id: "context_size",
				status: "failed",
				feedback: "context window exceeded",
			});
		});

		it("counts cached input tokens towards the processed prompt", async () => {
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation: vi
					.fn<typeof fetch>()
					.mockImplementation(async () =>
						Response.json({
							...chatBody({ content: "OK" }),
							usage: {
								input_tokens: 10,
								cache_creation_input_tokens: 5_000,
								output_tokens: 1,
							},
						}),
					),
			});

			expect(result.passed).toBe(true);
		});

		it("fails the output check when the upstream refuses the budget", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockImplementation(async (_url, request) =>
					String(request?.body).includes("4096")
						? Response.json(
								{ error: { message: "max_tokens must be <= 2048" } },
								{ status: 400 },
							)
						: Response.json(chatBody({ content: "OK" })),
				);
			const result = await runProviderModelVerification({
				target: limitsTarget,
				token: "provider-key",
				fetchImplementation,
			});

			expect(result.checks[2]).toMatchObject({
				id: "max_output",
				status: "failed",
				feedback:
					'Your endpoint refused a request for the declared max output of 4,096 tokens. It answered: "max_tokens must be <= 2048"',
			});
		});
	});

	it("validates every declared capability with provider responses", async () => {
		const response = (body: unknown) =>
			new Response(JSON.stringify(body), { status: 200 });
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(chatBody({ content: "OK" })))
			.mockResolvedValueOnce(new Response(chatStream(), { status: 200 }))
			.mockResolvedValueOnce(
				response(chatBody({ content: "The image is red." })),
			)
			.mockResolvedValueOnce(response(chatBody({ content: "I hear a tone." })))
			.mockResolvedValueOnce(
				response(
					chatBody(
						{
							tool_calls: [
								{
									type: "function",
									function: { name: "get_weather", arguments: "{}" },
								},
							],
						},
						"tool_calls",
					),
				),
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
				response(
					chatBody({ content: "The answer is 7/4." }, "stop", {
						...chatUsage,
						completion_tokens_details: { reasoning_tokens: 12 },
					}),
				),
			)
			.mockResolvedValueOnce(
				response(
					chatBody({ content: "The answer is 7/4." }, "stop", {
						...chatUsage,
						completion_tokens_details: { reasoning_tokens: 12 },
					}),
				),
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
				new Response(JSON.stringify(chatBody({ content: "OK" })), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(chatStream(), { status: 200 }));
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
			body: chatBody({ content: "The image loaded." }),
		},
		{
			name: "audio",
			overrides: { audio: true },
			body: chatBody({ content: "The audio loaded." }),
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
			.mockResolvedValueOnce(response(chatBody({ content: "OK" })))
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

	describe("timeouts", () => {
		const basicOnly: ProviderModelVerificationTarget = {
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
		};
		const timeout = () =>
			new DOMException(
				"The operation was aborted due to timeout",
				"TimeoutError",
			);

		it("passes with a warning when a retry succeeds", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockRejectedValueOnce(timeout())
				.mockRejectedValueOnce(timeout())
				.mockResolvedValue(Response.json(chatBody({ content: "OK" })));
			const onCheck = vi.fn();
			const result = await runProviderModelVerification({
				target: basicOnly,
				token: "provider-key",
				fetchImplementation,
				onCheck,
			});
			expect(fetchImplementation).toHaveBeenCalledTimes(3);
			expect(result.passed).toBe(true);
			expect(result.checks[0]).toMatchObject({
				status: "passed",
				warning: expect.stringContaining("2 timed-out requests"),
			});
			expect(result.summary).toBe(
				"1 verification check passed (1 with a warning).",
			);
			expect(onCheck).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "running",
					warning: expect.stringContaining("attempt 3 of 3"),
				}),
			);
		});

		it("fails after three timed-out attempts", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockImplementation(() => Promise.reject(timeout()));
			const result = await runProviderModelVerification({
				target: basicOnly,
				token: "provider-key",
				fetchImplementation,
			});
			expect(fetchImplementation).toHaveBeenCalledTimes(3);
			expect(result.passed).toBe(false);
			expect(result.checks[0]).toMatchObject({
				status: "failed",
				feedback:
					"The operation was aborted due to timeout (timed out on all 3 attempts)",
			});
			expect(result.checks[0]).not.toHaveProperty("warning");
		});

		it("does not retry other transport errors", async () => {
			const fetchImplementation = vi
				.fn<typeof fetch>()
				.mockRejectedValue(new TypeError("fetch failed"));
			const result = await runProviderModelVerification({
				target: basicOnly,
				token: "provider-key",
				fetchImplementation,
			});
			expect(fetchImplementation).toHaveBeenCalledOnce();
			expect(result.checks[0]).toMatchObject({
				status: "failed",
				feedback: "fetch failed",
			});
		});
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
