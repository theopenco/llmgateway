import { describe, expect, test } from "vitest";

import {
	getPlaygroundKeyForRequest,
	PLAYGROUND_KEY_COOKIE_NAME,
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
	test("uses the managed cookie", () => {
		expect(
			getPlaygroundKeyForRequest(
				cookieStore({
					[PLAYGROUND_KEY_COOKIE_NAME]: "global-token",
				}),
			),
		).toBe("global-token");
	});

	test("uses the secure managed cookie", () => {
		expect(
			getPlaygroundKeyForRequest(
				cookieStore({
					[`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`]: "secure-token",
				}),
			),
		).toBe("secure-token");
	});
});
