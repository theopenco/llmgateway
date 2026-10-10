import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as playgroundKey from "@/utils/playground-key.js";

let cookie: string;
beforeEach(async () => {
	cookie = await createTestUser();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await deleteAll();
});

const draft = {
	name: "clear-writing",
	description: "Write concise explanations.",
	instructions: "Use short sentences and concrete examples.",
};

test.each([true, false])(
	"generates a draft with the supplied billing key or personal fallback: %s",
	async (explicitKey) => {
		const resolveKey = vi
			.spyOn(playgroundKey, "resolvePlaygroundToken")
			.mockResolvedValue("test-token-no-retention");
		const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl-skill",
					object: "chat.completion",
					created: 1,
					model: "openai/gpt-5-mini",
					choices: [
						{
							index: 0,
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										id: "call-skill",
										type: "function",
										function: {
											name: "save_skill",
											arguments: JSON.stringify(draft),
										},
									},
								],
							},
						},
					],
					usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
		);
		const response = await app.request("/skills/generate", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				...(explicitKey ? { "x-llmgateway-key": "test-token" } : {}),
			},
			body: JSON.stringify({ prompt: "Help me write concise explanations." }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ skill: draft });
		expect(resolveKey).toHaveBeenCalledTimes(explicitKey ? 0 : 1);
		expect(
			new Headers(upstream.mock.calls[0][1]?.headers).get("Authorization"),
		).toBe(`Bearer ${explicitKey ? "test-token" : "test-token-no-retention"}`);
		const skills = await app.request("/skills", {
			headers: { Cookie: cookie },
		});
		expect(await skills.json()).toEqual({ skills: [] });
	},
);

test("rejects an empty prompt before resolving a billing key", async () => {
	const resolveKey = vi.spyOn(playgroundKey, "resolvePlaygroundToken");
	const response = await app.request("/skills/generate", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({ prompt: "  " }),
	});
	expect(response.status).toBe(400);
	expect(resolveKey).not.toHaveBeenCalled();
});

test("forwards request cancellation to the model request", async () => {
	const aborted = vi.fn();
	const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(
		(_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						aborted();
						reject(new DOMException("Aborted", "AbortError"));
					},
					{ once: true },
				);
			}),
	);
	const controller = new AbortController();
	const response = app.request("/skills/generate", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: cookie,
			"x-llmgateway-key": "test-token",
		},
		body: JSON.stringify({ prompt: "Write clearly" }),
		signal: controller.signal,
	});
	await vi.waitFor(() => expect(upstream).toHaveBeenCalled());
	controller.abort();
	await response;
	expect(aborted).toHaveBeenCalledOnce();
});
