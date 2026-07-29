import { describe, expect, it } from "vitest";

import {
	API_ORIGIN_HEADER,
	internalApiOriginHeaders,
	resolveChatApiOrigin,
} from "./api-origin.js";

import type { ApiOrigin } from "@llmgateway/db";
import type { Context } from "hono";

function contextWithHeader(value?: string): Context {
	return {
		req: {
			header: (name: string) =>
				name === API_ORIGIN_HEADER ? value : undefined,
		},
	} as unknown as Context;
}

function internalContext(origin: ApiOrigin): Context {
	return contextWithHeader(internalApiOriginHeaders(origin)[API_ORIGIN_HEADER]);
}

describe("resolveChatApiOrigin", () => {
	it("defaults to chat-completions when the header is absent", () => {
		expect(resolveChatApiOrigin(contextWithHeader())).toBe("chat-completions");
	});

	it.each(["messages", "responses", "images"] as const)(
		"accepts %s from the internal proxies",
		(origin) => {
			expect(resolveChatApiOrigin(internalContext(origin))).toBe(origin);
		},
	);

	it.each(["messages", "responses", "images", "videos", "bogus", ""])(
		"ignores %s when sent without the internal token",
		(origin) => {
			expect(resolveChatApiOrigin(contextWithHeader(origin))).toBe(
				"chat-completions",
			);
		},
	);

	it("ignores a guessed token", () => {
		expect(
			resolveChatApiOrigin(contextWithHeader("not-the-token:messages")),
		).toBe("chat-completions");
	});

	it("ignores an origin that never proxies through chat completions", () => {
		const token =
			internalApiOriginHeaders("messages")[API_ORIGIN_HEADER].split(":")[0];

		expect(resolveChatApiOrigin(contextWithHeader(`${token}:videos`))).toBe(
			"chat-completions",
		);
	});
});
