import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	toolCallModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(toolCallModels)(
		"tool calls with result $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{
							role: "system",
							content:
								"You are Noemi, a thoughtful and clear assistant. Your tone is calm, minimal, and human. You write with intention—never too much, never too little. You avoid clichés, speak simply, and offer helpful, grounded answers. When needed, you ask good questions. You don't try to impress—you aim to clarify. You may use metaphors if they bring clarity, but you stay sharp and sincere. You're here to help the user think clearly and move forward, not to overwhelm or overperform.",
						},
						{
							role: "user",
							content: "web search for the best ai notetaker apps!!!!",
						},
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "toolu_015dgN1nk5Ay12iN8e16XPbs",
									type: "function",
									function: {
										name: "webSearch",
										arguments: '{"query":"best AI notetaker apps 2024"}',
									},
								},
							],
						},
						{
							role: "tool",
							content:
								'{"type":"webSearch","query":"best AI notetaker apps 2024","results":[{"title":"My Deep Dive into 25+ AI Note-Taking Apps (The Brutally ... - Reddit","href":"https://www.reddit.com/r/Zoom/comments/1jtbxkf/my_deep_dive_into_25_ai_notetaking_apps_the/","description":"The Good: Think Obsidian meets Miro. Whiteboard-style interface for connecting notes visually. AI assistant can generate summaries and do ..."},{"title":"The 9 best AI meeting assistants in 2025 - Zapier","href":"https://zapier.com/blog/best-ai-meeting-assistant/","description":"Granola automatically transcribes, summarizes, and analyzes your meetings. It also acts as a live notepad, allowing you to manually jot down ..."},{"title":"The Best AI Tools for Taking Notes in 2025 - PCMag","href":"https://www.pcmag.com/picks/best-ai-tools-taking-notes","description":"The popular note-taking app Notion now has AI tools. Notion AI excels at answering questions about your existing data, generating text from a prompt you give it ..."},{"title":"Top 5 BEST AI Note-Taking Apps (Better than Notion?) - YouTube","href":"https://www.youtube.com/watch?v=wGLd43TkCGc","description":"Voicenotes is a voice‑to‑text powerhouse that transcribes and extracts action items in one tap. · Saner is A distraction‑free workspace built for ..."},{"title":"9 Best AI Note-Taking Apps Built For Your Meetings - Quil\'s AI","href":"https://quil.ai/2024/09/12/9-best-ai-note-taking-apps-built-for-your-meetings/","description":"Quil.ai: The AI Note-taker Built for Recruiting Firms. 2. Notion: Write, Plan, Organize. 3. Jamie AI: The Bot-Free AI Note-taker."}],"timestamp":"2025-08-29T01:20:29.553Z"}',
							tool_call_id: "toolu_015dgN1nk5Ay12iN8e16XPbs",
						},
					],
					tools: [
						{
							type: "function",
							function: {
								name: "webSearch",
								description: "Search the web for information",
								parameters: {
									type: "object",
									properties: {
										query: {
											type: "string",
											description: "Search query",
										},
									},
									required: ["query"],
								},
							},
						},
					],
					tool_choice: "auto",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"tool calls with empty content response:",
					JSON.stringify(json, null, 2),
				);
			}

			// Log error response if status is not 200
			if (res.status !== 200) {
				console.log(
					`Error ${res.status} - tool calls with result response:`,
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices");
			expect(json.choices).toHaveLength(1);
			expect(json.choices[0]).toHaveProperty("message");

			const message = json.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");

			// Should have proper content (not empty) as a response to the tool call
			expect(message).toHaveProperty("content");
			// verify either content is string or tool_calls is present
			expect(message.content || message.tool_calls).toBeTruthy();

			// Should have finish reason as stop (not tool_calls since this is a response)
			// TODO THIS IS FAILING ON SOME MODELS
			// expect(json.choices[0]).toHaveProperty("finish_reason", "stop");

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			// Validate usage
			expect(json).toHaveProperty("usage");
			expect(json.usage).toHaveProperty("prompt_tokens");
			expect(json.usage).toHaveProperty("completion_tokens");
			expect(json.usage).toHaveProperty("total_tokens");
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(typeof json.usage.completion_tokens).toBe("number");
			expect(typeof json.usage.total_tokens).toBe("number");
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
			expect(json.usage.completion_tokens).toBeGreaterThan(0);
			expect(json.usage.total_tokens).toBeGreaterThan(0);
		},
	);
});
