import { describe, expect, test } from "vitest";

import {
	getPlaygroundKeyForRequest,
	getPlaygroundKeyCookieNamesToRemove,
	PLAYGROUND_KEY_COOKIE_NAME,
	PLAYGROUND_PROJECT_HEADER,
} from "@/lib/constants";

function cookieStore(values: Record<string, string>) {
	return {
		get(name: string) {
			const value = values[name];
			return value === undefined ? undefined : { value };
		},
	};
}

describe("getPlaygroundKeyForRequest", () => {
	test("prefers the requested project's scoped cookie", () => {
		const request = new Request("https://playground.example/api/chat", {
			headers: { [PLAYGROUND_PROJECT_HEADER]: "project-a" },
		});

		expect(
			getPlaygroundKeyForRequest(
				cookieStore({
					[PLAYGROUND_KEY_COOKIE_NAME]: "global-token",
					[`${PLAYGROUND_KEY_COOKIE_NAME}_project-a`]: "project-a-token",
					[`${PLAYGROUND_KEY_COOKIE_NAME}_project-b`]: "project-b-token",
				}),
				request,
			),
		).toBe("project-a-token");
	});

	test("does not fall back when the requested project has no scoped cookie", () => {
		const request = new Request("https://playground.example/api/chat", {
			headers: { [PLAYGROUND_PROJECT_HEADER]: "project-a" },
		});

		expect(
			getPlaygroundKeyForRequest(
				cookieStore({ [PLAYGROUND_KEY_COOKIE_NAME]: "global-token" }),
				request,
			),
		).toBeUndefined();
	});

	test("falls back to the global cookie when no project is specified", () => {
		const request = new Request("https://playground.example/api/chat");

		expect(
			getPlaygroundKeyForRequest(
				cookieStore({ [PLAYGROUND_KEY_COOKIE_NAME]: "global-token" }),
				request,
			),
		).toBe("global-token");
	});
});

describe("getPlaygroundKeyCookieNamesToRemove", () => {
	test("caps project-scoped cookies while retaining the current project", () => {
		const names = Array.from(
			{ length: 10 },
			(_, index) => `${PLAYGROUND_KEY_COOKIE_NAME}_project-${index}`,
		);

		expect(
			getPlaygroundKeyCookieNamesToRemove(names, "current-project"),
		).toEqual([`${PLAYGROUND_KEY_COOKIE_NAME}_project-0`]);
	});

	test("does not evict cookies below the limit", () => {
		expect(
			getPlaygroundKeyCookieNamesToRemove(
				[`${PLAYGROUND_KEY_COOKIE_NAME}_project-a`],
				"project-b",
			),
		).toEqual([]);
	});
});
