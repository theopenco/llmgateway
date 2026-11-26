import { createHash } from "node:crypto";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getTestOptions,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import { getProviderEnvVar, models } from "@llmgateway/models";

import { app } from "./app.js";
import { readFixtureImageDataUrl } from "./test-utils/image-fixture.js";

import type { ProviderModelMapping } from "@llmgateway/models";

const selected = new Set(process.env.TEST_MODELS?.split(",") ?? []);
const profiles = [
	["openai", "gpt-4o-mini"],
	["openai", "gpt-5.4-mini"],
	["azure", "gpt-4.1-mini"],
	["aws-mantle", "gpt-5.6-luna"],
	["google-ai-studio", "gemini-3.1-flash-lite"],
	["google-vertex", "gemini-3.5-flash"],
	["anthropic", "claude-haiku-4-5"],
	["xiaomi", "mimo-v2.6-flash"],
	["mistral", "mistral-medium-3-5"],
	["xai", "grok-4-3"],
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function imageHashes(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap(imageHashes);
	}
	const part = record(value);
	if (!part) {
		return [];
	}
	let data: string | undefined;
	if (part.type === "image_url" || part.type === "input_image") {
		const url =
			typeof part.image_url === "string"
				? part.image_url
				: record(part.image_url)?.url;
		if (typeof url === "string" && url.startsWith("data:image/")) {
			data = url.slice(url.indexOf(",") + 1);
		}
	} else if (part.type === "image") {
		const source = record(part.source);
		if (source?.type === "base64" && typeof source.data === "string") {
			data = source.data;
		}
	} else {
		const inline = record(part.inline_data ?? part.inlineData);
		if (inline && typeof inline.data === "string") {
			data = inline.data;
		}
	}
	const own = data
		? [createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")]
		: [];
	return [...own, ...Object.values(part).flatMap(imageHashes)];
}

describe("tool-result image transport", () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);
	for (const [provider, id] of profiles) {
		const model = `${provider}/${id}`;
		const mapping = models
			.find((entry) => entry.id === id)
			?.providers.find((entry) => entry.providerId === provider) as
			ProviderModelMapping | undefined;
		for (const native of [false, true]) {
			for (const stream of [false, true]) {
				for (const parallel of [false, true]) {
					test.skipIf(!selected.has(model))(
						`${model} native=${native} stream=${stream} parallel=${parallel}`,
						getTestOptions(),
						async () => {
							const env = getProviderEnvVar(provider);
							expect(
								Boolean(env && process.env[env]),
								"Selected mapping requires a live provider credential",
							).toBe(true);
							const image = readFixtureImageDataUrl();
							const base64 = image.slice(image.indexOf(",") + 1);
							const calls = parallel ? ["call_one", "call_two"] : ["call_one"];
							const question =
								"Describe the image returned by the tool in one short sentence. Do not call more tools.";
							const messages: unknown[] = [
								{
									role: "user",
									content: `Take a screenshot. ${generateTestRequestId()}`,
								},
								native
									? {
											role: "assistant",
											content: calls.map((call) => ({
												type: "tool_use",
												id: call,
												name: "screenshot",
												input: {},
											})),
										}
									: {
											role: "assistant",
											content: "",
											tool_calls: calls.map((call) => ({
												id: call,
												type: "function",
												function: { name: "screenshot", arguments: "{}" },
											})),
										},
							];
							if (native) {
								messages.push({
									role: "user",
									content: [
										...calls.map((call) => ({
											type: "tool_result",
											tool_use_id: call,
											content: [
												{ type: "text", text: "Screenshot captured." },
												{
													type: "image",
													source: {
														type: "base64",
														media_type: "image/png",
														data: base64,
													},
												},
											],
										})),
										{ type: "text", text: question },
									],
								});
							} else {
								messages.push(
									...calls.map((call) => ({
										role: "tool",
										tool_call_id: call,
										content: [
											{ type: "text", text: "Screenshot captured." },
											{ type: "image_url", image_url: { url: image } },
										],
									})),
									{ role: "user", content: question },
								);
							}
							const schema = { type: "object", properties: {} };
							const requestId = generateTestRequestId();
							const response = await app.request(
								native ? "/v1/messages" : "/v1/chat/completions",
								{
									method: "POST",
									headers: {
										"content-type": "application/json",
										authorization: "Bearer real-token",
										"x-no-fallback": "true",
										"x-debug": "true",
										"x-request-id": requestId,
									},
									body: JSON.stringify({
										model,
										stream,
										max_tokens: 4096,
										messages,
										tools: [
											native
												? {
														name: "screenshot",
														description: "Capture an image",
														input_schema: schema,
													}
												: {
														type: "function",
														function: {
															name: "screenshot",
															description: "Capture an image",
															parameters: schema,
														},
													},
										],
										tool_choice: native ? { type: "none" } : "none",
										...(mapping?.reasoningEfforts?.includes("none")
											? native
												? { thinking: { type: "disabled" } }
												: { reasoning_effort: "none" }
											: {}),
									}),
								},
							);
							const body = await response.text();
							expect(response.status).toBe(200);
							if (stream) {
								expect(body).toContain(
									native ? "event: message_stop" : "data: [DONE]",
								);
								for (const line of body.split("\n")) {
									if (line.startsWith("data: ") && line !== "data: [DONE]") {
										const event = JSON.parse(line.slice(6)) as {
											type?: string;
											error?: unknown;
										};
										expect(event.type).not.toBe("error");
										expect(event.error).toBeUndefined();
									}
								}
							} else {
								const json = JSON.parse(body) as {
									content?: Array<{ type: string; text?: string }>;
									choices?: Array<{ message: { content?: string } }>;
								};
								const text = native
									? json.content
											?.filter((part) => part.type === "text")
											.map((part) => part.text)
											.join("")
									: json.choices?.[0]?.message.content;
								expect(text?.trim()).toBeTruthy();
							}
							const log = await validateLogByRequestId(requestId);
							expect(log.usedProvider).toBe(provider);
							const upstream =
								typeof log.upstreamRequest === "string"
									? JSON.parse(log.upstreamRequest)
									: log.upstreamRequest;
							const hash = createHash("sha256")
								.update(Buffer.from(base64, "base64"))
								.digest("hex");
							expect(imageHashes(upstream)).toEqual(calls.map(() => hash));
						},
					);
				}
			}
		}
	}
});

test.skipIf(
	!process.env.TEST_FILES?.split(",").includes(
		"apps/gateway/src/tool-result-images.e2e.ts",
	),
)("selected mappings exercise tool-result image transport", () => {
	expect(
		profiles.some(([provider, id]) => selected.has(`${provider}/${id}`)),
	).toBe(true);
});
