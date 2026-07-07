import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { silenceSamlifySloWarning } from "./silence-samlify-warnings.js";

describe("silenceSamlifySloWarning", () => {
	let original: typeof console.warn;

	beforeEach(() => {
		original = console.warn;
	});

	afterEach(() => {
		console.warn = original;
	});

	it("drops the samlify warning but passes other warnings through", () => {
		// The underlying sink stands in for stderr; the patch wraps it once.
		const sink = vi.fn();
		console.warn = sink;
		silenceSamlifySloWarning();

		console.warn(
			"Construct identity  provider - missing endpoint of SingleLogoutService",
		);
		expect(sink).not.toHaveBeenCalled();

		console.warn("something else entirely", 42);
		expect(sink).toHaveBeenCalledTimes(1);
		expect(sink).toHaveBeenCalledWith("something else entirely", 42);
	});
});
