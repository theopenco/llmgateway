import { describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	disprovedCapabilities,
	runProviderModelVerification,
	hasMessageContentVerification,
} from "./model-verification.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

const target: ProviderModelVerificationTarget = {
	providerId: "custom-carrier",
	modelName: "verification-model",
	externalId: "verification-model-upstream",
	apiFormat: "openai-chat-completions",
	streaming: false,
	vision: false,
	audio: false,
	tools: false,
	jsonOutput: false,
	jsonOutputSchema: false,
	reasoning: false,
	reasoningMaxTokens: false,
	reasoningEfforts: null,
	webSearch: false,
};

interface Payload {
	messages: { role: string; content: unknown }[];
	stream?: boolean;
}

function completion(stream = false): Response {
	const usage = { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 };
	if (stream) {
		return new Response(
			[
				{
					choices: [
						{ index: 0, delta: { content: "OK" }, finish_reason: null },
					],
				},
				{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
				{ choices: [], usage },
			]
				.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
				.join("") + "data: [DONE]\n\n",
		);
	}
	return Response.json({
		id: "chatcmpl-verification",
		object: "chat.completion",
		created: 1700000000,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "OK" },
				finish_reason: "stop",
			},
		],
		usage,
	});
}

function verify(
	streaming: boolean,
	reject?: (payload: Payload) => boolean,
	format: {
		apiFormat?: ProviderModelVerificationTarget["apiFormat"];
		providerId?: string;
	} = {
		apiFormat: "openai-chat-completions",
	},
) {
	const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
		const payload = JSON.parse(String(init?.body)) as Payload;
		return reject?.(payload)
			? Response.json(
					{
						message: "Validation error",
						issues: [{ code: "invalid_union", path: ["messages", 0] }],
					},
					{ status: 400 },
				)
			: completion(payload.stream);
	});
	return runProviderModelVerification({
		target: { ...target, streaming, ...format },
		token: "provider-key",
		baseUrl: "https://carrier.example",
		fetchImplementation,
		requireOptionalChecks: false,
	}).then((result) => ({ result, fetchImplementation }));
}

describe("message content compatibility verification", () => {
	it("queues a mandatory check without optional capabilities", () => {
		expect(
			createQueuedModelVerificationChecks(target).map(({ id }) => id),
		).toEqual(["basic", "message_content"]);
	});

	it.each([false, true])(
		"accepts multi-part text arrays with streaming=%s",
		async (streaming) => {
			const { result, fetchImplementation } = await verify(streaming);
			expect(result.passed).toBe(true);
			const check = result.checks.find(({ id }) => id === "message_content");
			expect(check?.status).toBe("passed");
			expect(check?.probes).toHaveLength(streaming ? 6 : 3);
			const arrays = fetchImplementation.mock.calls
				.map(([, init]) => JSON.parse(String(init?.body)) as Payload)
				.filter(({ messages }) =>
					messages.some(({ content }) => Array.isArray(content)),
				);
			expect(arrays).toHaveLength(streaming ? 6 : 3);
			for (const payload of arrays) {
				const message = payload.messages.find(({ content }) =>
					Array.isArray(content),
				);
				expect(message?.content).toHaveLength(2);
			}
		},
	);

	it.each(["system", "assistant", "user"])(
		"fails when %s text arrays are rejected, even with optional checks disabled",
		async (role) => {
			const { result } = await verify(false, ({ messages }) =>
				messages.some(
					(message) => message.role === role && Array.isArray(message.content),
				),
			);
			expect(result.passed).toBe(false);
			const check = result.checks.find(({ id }) => id === "message_content");
			expect(check?.status).toBe("failed");
			expect(
				check?.probes?.filter(({ status }) => status === "failed"),
			).toMatchObject([{ label: expect.stringContaining(role) }]);
			expect(check?.feedback).toContain(role);
			expect(disprovedCapabilities(result.checks)).toEqual([]);
		},
	);

	it("checks all roles after a refusal and catches streaming-only failures", async () => {
		const { result } = await verify(
			true,
			({ messages, stream }) =>
				Boolean(stream) &&
				messages.some(
					({ role, content }) => role === "assistant" && Array.isArray(content),
				),
		);
		const check = result.checks.find(({ id }) => id === "message_content");
		expect(result.passed).toBe(false);
		expect(check?.probes).toHaveLength(6);
		expect(
			check?.probes?.filter(({ status }) => status === "failed"),
		).toMatchObject([{ label: expect.stringContaining("assistant") }]);
	});

	it("does not send Chat Completions compatibility probes to a native protocol", () => {
		expect(
			createQueuedModelVerificationChecks({
				...target,
				providerId: "anthropic",
				apiFormat: "provider-native",
			}).map(({ id }) => id),
		).toEqual(["basic"]);
	});
});

it.each([undefined, "provider-native", "openai-chat-completions"] as const)(
	"probes a custom carrier through %s",
	async (apiFormat) => {
		expect(
			createQueuedModelVerificationChecks({ ...target, apiFormat }).map(
				({ id }) => id,
			),
		).toContain("message_content");
		expect(hasMessageContentVerification({ ...target, apiFormat }, [])).toBe(
			false,
		);
		const { result } = await verify(false, undefined, { apiFormat });
		expect(
			result.checks.find(({ id }) => id === "message_content"),
		).toMatchObject({ status: "passed" });
	},
);

it.each(["openai", "together-ai"])(
	"checks registered %s native Chat Completions and rejects stale runs",
	async (providerId) => {
		const format = { providerId, apiFormat: "provider-native" as const };
		expect(hasMessageContentVerification({ ...target, ...format }, [])).toBe(
			false,
		);
		const { result } = await verify(
			false,
			({ messages }) =>
				messages.some(
					({ role, content }) => role === "system" && Array.isArray(content),
				),
			format,
		);
		expect(result.passed).toBe(false);
		expect(
			result.checks.find(({ id }) => id === "message_content"),
		).toMatchObject({
			status: "failed",
			feedback: expect.stringContaining("system"),
		});
	},
);

it.each([
	"anthropic",
	"vertex-anthropic",
	"azure-anthropic",
	"aws-bedrock",
	"google-ai-studio",
	"glacier",
	"google-vertex",
	"quartz",
])("does not probe OpenAI wire shapes on %s native protocol", (providerId) => {
	const nativeTarget = {
		...target,
		providerId,
		apiFormat: "provider-native" as const,
	};
	expect(
		createQueuedModelVerificationChecks(nativeTarget).map(({ id }) => id),
	).toEqual(["basic"]);
	expect(hasMessageContentVerification(nativeTarget, [])).toBe(true);
});
