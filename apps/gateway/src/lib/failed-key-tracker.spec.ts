import { describe, expect, test } from "vitest";

import { createFailedKeyTracker } from "./failed-key-tracker.js";

describe("createFailedKeyTracker", () => {
	test("tracks env-var indices separately per provider+region", () => {
		const tracker = createFailedKeyTracker();

		tracker.remember("openai", undefined, {
			envVarName: "LLM_OPENAI_API_KEY",
			configIndex: 0,
		});
		tracker.remember("openai", undefined, {
			envVarName: "LLM_OPENAI_API_KEY",
			configIndex: 2,
		});
		tracker.remember("alibaba", "cn-beijing", {
			envVarName: "LLM_ALIBABA_API_KEY",
			configIndex: 1,
		});

		expect(
			Array.from(tracker.envKeyIndicesFor("openai", undefined) ?? []),
		).toEqual([0, 2]);
		expect(
			Array.from(tracker.envKeyIndicesFor("alibaba", "cn-beijing") ?? []),
		).toEqual([1]);
		expect(tracker.envKeyIndicesFor("alibaba", "singapore")).toBeUndefined();
	});

	test("tracks BYOK provider-key ids separately from env indices", () => {
		const tracker = createFailedKeyTracker();

		tracker.remember("together-ai", undefined, {
			providerKeyId: "key-primary",
		});
		tracker.remember("together-ai", undefined, {
			providerKeyId: "key-secondary",
		});

		expect(
			Array.from(tracker.providerKeyIdsFor("together-ai", undefined) ?? []),
		).toEqual(["key-primary", "key-secondary"]);
		expect(tracker.envKeyIndicesFor("together-ai", undefined)).toBeUndefined();
	});

	test("ignores incomplete env-var entries (missing configIndex or envVarName)", () => {
		const tracker = createFailedKeyTracker();

		// envVarName without configIndex — not enough to identify the slot
		tracker.remember("openai", undefined, { envVarName: "LLM_OPENAI_API_KEY" });
		// configIndex without envVarName — same
		tracker.remember("openai", undefined, { configIndex: 0 });

		expect(tracker.envKeyIndicesFor("openai", undefined)).toBeUndefined();
	});
});
