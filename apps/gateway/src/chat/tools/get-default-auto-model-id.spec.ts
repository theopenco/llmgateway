import { describe, expect, it } from "vitest";

import {
	AUTO_ROUTE_OPUS_CONTEXT_THRESHOLD,
	getAllowedAutoModelIds,
	getDefaultAutoModelId,
} from "./get-default-auto-model-id.js";

describe("getDefaultAutoModelId", () => {
	it("defaults to claude-sonnet-4-6 at or below the threshold", () => {
		expect(getDefaultAutoModelId(8_192)).toBe("claude-sonnet-4-6");
		expect(getDefaultAutoModelId(AUTO_ROUTE_OPUS_CONTEXT_THRESHOLD)).toBe(
			"claude-sonnet-4-6",
		);
	});

	it("switches to claude-opus-4-6 above the threshold", () => {
		expect(getDefaultAutoModelId(AUTO_ROUTE_OPUS_CONTEXT_THRESHOLD + 1)).toBe(
			"claude-opus-4-6",
		);
		expect(getDefaultAutoModelId(200_000)).toBe("claude-opus-4-6");
	});

	it("adds claude-haiku-4-5 when no_reasoning is enabled", () => {
		expect(getAllowedAutoModelIds(8_192, true)).toEqual([
			"claude-sonnet-4-6",
			"claude-haiku-4-5",
		]);
		expect(getAllowedAutoModelIds(200_000, true)).toEqual([
			"claude-opus-4-6",
			"claude-haiku-4-5",
		]);
	});

	it("uses the default Claude routing when reasoning is allowed", () => {
		expect(getAllowedAutoModelIds(8_192, false)).toEqual(["claude-sonnet-4-6"]);
		expect(getAllowedAutoModelIds(200_000, false)).toEqual(["claude-opus-4-6"]);
	});
});
