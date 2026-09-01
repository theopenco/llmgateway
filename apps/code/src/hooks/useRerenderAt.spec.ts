import { describe, expect, test } from "vitest";

import { getRerenderDelay } from "./useRerenderAt";

describe("getRerenderDelay", () => {
	test("schedules elapsed boundaries immediately", () => {
		expect(getRerenderDelay(1_000, 3_000)).toBe(0);
	});

	test("caps distant boundaries so they are rechecked", () => {
		expect(getRerenderDelay(30 * 24 * 60 * 60 * 1000, 0)).toBe(
			24 * 60 * 60 * 1000,
		);
	});
});
