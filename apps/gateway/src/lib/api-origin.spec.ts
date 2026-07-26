import { describe, expect, it } from "vitest";

import { API_ORIGIN_HEADER, resolveChatApiOrigin } from "./api-origin.js";

import type { Context } from "hono";

function contextWithHeader(value?: string): Context {
	return {
		req: {
			header: (name: string) =>
				name === API_ORIGIN_HEADER ? value : undefined,
		},
	} as unknown as Context;
}

describe("resolveChatApiOrigin", () => {
	it("defaults to chat-completions when the header is absent", () => {
		expect(resolveChatApiOrigin(contextWithHeader())).toBe("chat-completions");
	});

	it.each(["messages", "responses", "images"])(
		"accepts %s from the internal proxies",
		(origin) => {
			expect(resolveChatApiOrigin(contextWithHeader(origin))).toBe(origin);
		},
	);

	it("trims surrounding whitespace", () => {
		expect(resolveChatApiOrigin(contextWithHeader(" messages "))).toBe(
			"messages",
		);
	});

	it.each(["videos", "embeddings", "chat-completions", "bogus", ""])(
		"falls back to chat-completions for %s",
		(origin) => {
			expect(resolveChatApiOrigin(contextWithHeader(origin))).toBe(
				"chat-completions",
			);
		},
	);
});
