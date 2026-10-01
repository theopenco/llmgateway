import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestError } from "./request-error.js";
import { transformAnthropicMessages } from "./transform-anthropic-messages.js";

import type { BaseMessage } from "@llmgateway/models";

function imageMessage(url: string): BaseMessage[] {
	return [
		{
			role: "user",
			content: [
				{ type: "text", text: "describe" },
				{ type: "image_url", image_url: { url } },
			],
		},
	];
}

describe("transformAnthropicMessages image failures", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("rejects a malformed data URL as a client error", async () => {
		const error = await transformAnthropicMessages(
			imageMessage("data:undefined;base64,undefined"),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(RequestError);
		expect((error as RequestError).statusCode).toBe(400);
	});

	it("keeps the URL out of the placeholder on a non-client failure", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("socket hang up")),
		);
		const url = "https://example.com/secret-token.png";

		const [message] = await transformAnthropicMessages(imageMessage(url));

		expect(message.content).toContainEqual({
			type: "text",
			text: "[Image failed to load]",
		});
		expect(JSON.stringify(message)).not.toContain(url);
	});
});
