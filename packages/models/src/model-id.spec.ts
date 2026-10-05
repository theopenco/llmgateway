import { describe, expect, it } from "vitest";

import {
	isValidModelId,
	MODEL_ID_PATTERN,
	modelIdProblem,
	suggestModelId,
} from "./model-id.js";
import { models } from "./models.js";

describe("model ids", () => {
	it("accepts every catalogue model id", () => {
		const invalid = models
			.map((model) => model.id)
			.filter((id) => !isValidModelId(id));
		expect(invalid).toEqual([]);
	});

	it.each([
		"deepseek/deepseek-v4.1-flash",
		"DeepSeek-V4",
		"deepseek v4",
		"deepseek_v4",
		"-deepseek",
		"deepseek.",
		"deepseek-",
		"",
		"model:region",
	])("rejects %j", (id) => {
		expect(isValidModelId(id)).toBe(false);
		expect(MODEL_ID_PATTERN.test(id)).toBe(false);
		expect(modelIdProblem(id)).toEqual(expect.any(String));
	});

	it("reports no problem for a valid id", () => {
		expect(modelIdProblem("deepseek-v4.1-flash")).toBeNull();
	});

	it("suggests a catalogue-style id", () => {
		expect(suggestModelId("deepseek/DeepSeek V4.1 Flash")).toBe(
			"deepseek-v4.1-flash",
		);
		expect(suggestModelId("  Llama_3.3__70B  ")).toBe("llama-3.3-70b");
		expect(suggestModelId("org/--Model..v2--")).toBe("model.v2");
		expect(suggestModelId("deepseek/")).toBeNull();
		expect(suggestModelId("!!!")).toBeNull();
	});

	it("prefers known ids", () => {
		const known = ["gpt-4o-mini", "deepseek-v4.1-flash"];
		expect(suggestModelId("openai/GPT 4o Mini", known)).toBe("gpt-4o-mini");
		expect(suggestModelId("gpt4o-mini", known)).toBe("gpt-4o-mini");
		expect(suggestModelId("brand new model", known)).toBe("brand-new-model");
	});

	it("explains the problem with a suggestion", () => {
		expect(modelIdProblem("deepseek/DeepSeek V4.1 Flash")).toContain(
			'"deepseek-v4.1-flash"',
		);
	});
});
