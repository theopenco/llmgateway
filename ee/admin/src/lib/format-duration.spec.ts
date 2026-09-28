import { describe, expect, test } from "vitest";

import { formatDurationMs } from "./format-duration";

describe("formatDurationMs", () => {
	test("renders an em dash when there is no sample", () => {
		expect(formatDurationMs(null)).toBe("—");
		expect(formatDurationMs(undefined)).toBe("—");
		expect(formatDurationMs(Number.NaN)).toBe("—");
	});

	test("keeps sub-second latency in milliseconds", () => {
		expect(formatDurationMs(0)).toBe("0 ms");
		expect(formatDurationMs(412.4)).toBe("412 ms");
		expect(formatDurationMs(999)).toBe("999 ms");
	});

	test("switches to seconds at a second, with magnitude-adaptive precision", () => {
		expect(formatDurationMs(1000)).toBe("1.00 s");
		expect(formatDurationMs(1432)).toBe("1.43 s");
		expect(formatDurationMs(42_500)).toBe("42.5 s");
		expect(formatDurationMs(1_234_000)).toBe("1,234 s");
	});
});
