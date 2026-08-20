import { describe, expect, test } from "vitest";

import {
	getPlaygroundKeyForRequest,
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

	test("falls back to the global cookie for older sessions", () => {
		const request = new Request("https://playground.example/api/chat", {
			headers: { [PLAYGROUND_PROJECT_HEADER]: "project-a" },
		});

		expect(
			getPlaygroundKeyForRequest(
				cookieStore({ [PLAYGROUND_KEY_COOKIE_NAME]: "global-token" }),
				request,
			),
		).toBe("global-token");
	});
});
