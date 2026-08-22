import { beforeEach, describe, expect, test, vi } from "vitest";

import { models } from "@llmgateway/models";

import type * as ProcessImageUrlModule from "./process-image-url.js";
import type { OpenAIRequestBody } from "@llmgateway/models";

const processImageUrl = vi.hoisted(() => vi.fn());

vi.mock("./process-image-url.js", async () => {
	const actual = await vi.importActual<typeof ProcessImageUrlModule>(
		"./process-image-url.js",
	);
	return { ...actual, processImageUrl };
});

const { prepareRequestBody } = await import("./prepare-request-body.js");

type ErnieRequestBody = OpenAIRequestBody & {
	chat_template_kwargs?: Record<string, boolean>;
};

const MODEL_ID = "ernie-4.5-vl-424b-a47b";
const EXTERNAL_ID = "baidu/ernie-4.5-vl-424b-a47b";

async function prepare(options: {
	content: unknown;
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "max";
}) {
	// Derive supportsReasoning from the catalog the same way chat.ts does, so a
	// regression in the mapping can't silently drop the thinking flag.
	const mapping = models
		.find((m) => m.id === MODEL_ID)
		?.providers.find((p) => p.providerId === "novita");

	return (await prepareRequestBody(
		"novita",
		MODEL_ID,
		null,
		EXTERNAL_ID,
		[{ role: "user", content: options.content }] as Parameters<
			typeof prepareRequestBody
		>[4],
		false, // stream
		undefined, // temperature
		undefined, // max_tokens
		undefined, // top_p
		undefined, // frequency_penalty
		undefined, // presence_penalty
		undefined, // response_format
		undefined, // tools
		undefined, // tool_choice
		options.reasoningEffort,
		mapping?.reasoning === true,
	)) as ErnieRequestBody;
}

function imagePart(url: string) {
	return { type: "image_url", image_url: { url } };
}

describe("prepareRequestBody - requiresBase64Images", () => {
	beforeEach(() => {
		processImageUrl.mockReset();
	});

	test("the ERNIE 4.5 VL mapping opts in", () => {
		const mapping = models
			.find((m) => m.id === MODEL_ID)
			?.providers.find((p) => p.providerId === "novita");

		expect(mapping?.vision).toBe(true);
		expect(mapping?.requiresBase64Images).toBe(true);
	});

	test("inlines a remote image URL as a data URL", async () => {
		processImageUrl.mockResolvedValue({
			data: "aGVsbG8=",
			mimeType: "image/png",
		});

		const requestBody = await prepare({
			content: [
				{ type: "text", text: "describe this image" },
				imagePart("https://example.com/logo.png"),
			],
		});

		expect(processImageUrl).toHaveBeenCalledWith(
			"https://example.com/logo.png",
			false,
			20,
			null,
		);
		expect(requestBody.messages[0].content).toEqual([
			{ type: "text", text: "describe this image" },
			imagePart("data:image/png;base64,aGVsbG8="),
		]);
	});

	test("sends an http URL through the guarded fetch instead of forwarding it", async () => {
		// The SSRF guard inside processImageUrl is what enforces https-only, so
		// the contract this test pins is that plain http never bypasses it and is
		// never handed to the provider to fetch on our behalf.
		processImageUrl.mockRejectedValue(new Error("Content URL must use https"));

		await expect(
			prepare({ content: [imagePart("http://cdn.example.com/logo.png")] }),
		).rejects.toThrow("Content URL must use https");

		expect(processImageUrl).toHaveBeenCalledWith(
			"http://cdn.example.com/logo.png",
			false,
			20,
			null,
		);
	});

	test("leaves a data URL untouched and never refetches it", async () => {
		const dataUrl = "data:image/png;base64,aGVsbG8=";

		const requestBody = await prepare({
			content: [{ type: "text", text: "hi" }, imagePart(dataUrl)],
		});

		expect(processImageUrl).not.toHaveBeenCalled();
		expect(requestBody.messages[0].content).toEqual([
			{ type: "text", text: "hi" },
			imagePart(dataUrl),
		]);
	});

	test("leaves plain string content untouched", async () => {
		const requestBody = await prepare({ content: "hi" });

		expect(processImageUrl).not.toHaveBeenCalled();
		expect(requestBody.messages[0].content).toBe("hi");
	});
});

describe("prepareRequestBody - ERNIE 4.5 VL thinking", () => {
	test("turns thinking on via the chat-template flag", async () => {
		const requestBody = await prepare({
			content: "hi",
			reasoningEffort: "medium",
		});

		expect(requestBody.chat_template_kwargs).toEqual({
			enable_thinking: true,
		});
		// Novita suppresses reasoning entirely when reasoning_effort arrives
		// alongside the flag, so the mapping's supportedParameters must keep it out.
		expect(requestBody.reasoning_effort).toBeUndefined();
	});

	test("leaves thinking off for reasoning_effort none", async () => {
		const requestBody = await prepare({
			content: "hi",
			reasoningEffort: "none",
		});

		// The mapping publishes no `reasoningEfforts`, so "none" is dropped before
		// the flag is derived. That lands on the same upstream behaviour the flag
		// would have produced — ERNIE thinks only when told to.
		expect(requestBody.chat_template_kwargs).toBeUndefined();
		expect(requestBody.reasoning_effort).toBeUndefined();
	});

	test("leaves the upstream default (thinking off) when no effort is requested", async () => {
		const requestBody = await prepare({ content: "hi" });

		expect(requestBody.chat_template_kwargs).toBeUndefined();
		expect(requestBody.reasoning_effort).toBeUndefined();
	});
});
