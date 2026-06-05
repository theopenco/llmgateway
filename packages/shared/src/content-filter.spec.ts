import { describe, expect, test } from "vitest";

import { isContentFilterErrorText } from "./content-filter.js";

describe("isContentFilterErrorText", () => {
	test("detects ByteDance Seedance video output moderation", () => {
		expect(
			isContentFilterErrorText("OutputVideoSensitiveContentDetected"),
		).toBe(true);
		expect(
			isContentFilterErrorText(
				"OutputVideoSensitiveContentDetected.PolicyViolation: the output video may be related to copyright restrictions",
			),
		).toBe(true);
	});

	test("detects other provider moderation signals", () => {
		expect(isContentFilterErrorText("ResponsibleAIPolicyViolation")).toBe(true);
		expect(isContentFilterErrorText("data_inspection_failed")).toBe(true);
		expect(
			isContentFilterErrorText(
				"Your request was rejected by the safety system",
			),
		).toBe(true);
		expect(
			isContentFilterErrorText(
				"Blocked by Microsoft's content management policy",
			),
		).toBe(true);
	});

	test("returns false for generic upstream errors and empty input", () => {
		expect(isContentFilterErrorText("Internal server error")).toBe(false);
		expect(isContentFilterErrorText("the task id was not found")).toBe(false);
		expect(isContentFilterErrorText(null)).toBe(false);
		expect(isContentFilterErrorText(undefined)).toBe(false);
		expect(isContentFilterErrorText("")).toBe(false);
	});
});
