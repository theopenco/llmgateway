import { describe, it, expect, afterEach } from "vitest";

import {
	checkContentFilter,
	getContentFilterModels,
	getContentFilterMethod,
	getContentFilterMode,
	shouldApplyContentFilterToModel,
} from "./check-content-filter.js";

describe("checkContentFilter", () => {
	const originalEnv = process.env.LLM_CONTENT_FILTER_KEYWORDS;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_KEYWORDS;
		} else {
			process.env.LLM_CONTENT_FILTER_KEYWORDS = originalEnv;
		}
	});

	it("returns null when no keywords are configured", () => {
		delete process.env.LLM_CONTENT_FILTER_KEYWORDS;
		expect(
			checkContentFilter([{ role: "user", content: "hello world" }]),
		).toBeNull();
	});

	it("returns null when keywords env var is empty", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "";
		expect(
			checkContentFilter([{ role: "user", content: "hello world" }]),
		).toBeNull();
	});

	it("returns matched keyword when content contains it", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "banned,blocked";
		expect(
			checkContentFilter([{ role: "user", content: "this is a banned word" }]),
		).toBe("banned");
	});

	it("matches case-insensitively", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "forbidden";
		expect(
			checkContentFilter([
				{ role: "user", content: "This is FORBIDDEN content" },
			]),
		).toBe("forbidden");
	});

	it("returns null when no keywords match", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "banned,blocked";
		expect(
			checkContentFilter([{ role: "user", content: "hello world" }]),
		).toBeNull();
	});

	it("checks all messages", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "secret";
		expect(
			checkContentFilter([
				{ role: "system", content: "you are helpful" },
				{ role: "user", content: "tell me the secret" },
			]),
		).toBe("secret");
	});

	it("handles array content with text parts", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "blocked";
		expect(
			checkContentFilter([
				{
					role: "user",
					content: [{ type: "text" as const, text: "this is blocked content" }],
				},
			]),
		).toBe("blocked");
	});

	it("ignores messages with null content", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "blocked";
		expect(
			checkContentFilter([
				{ role: "user", content: null as unknown as string },
				{ role: "user", content: "safe content" },
			]),
		).toBeNull();
	});

	it("trims whitespace from keywords", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = " banned , blocked ";
		expect(
			checkContentFilter([{ role: "user", content: "this is banned" }]),
		).toBe("banned");
	});

	it("ignores empty keywords from trailing commas", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "banned,,blocked,";
		expect(
			checkContentFilter([{ role: "user", content: "hello world" }]),
		).toBeNull();
	});

	it("returns first matching keyword", () => {
		process.env.LLM_CONTENT_FILTER_KEYWORDS = "alpha,beta,gamma";
		expect(
			checkContentFilter([
				{ role: "user", content: "this has beta and gamma" },
			]),
		).toBe("beta");
	});
});

describe("getContentFilterMode", () => {
	const originalEnv = process.env.LLM_CONTENT_FILTER_MODE;
	const originalMethodEnv = process.env.LLM_CONTENT_FILTER_METHOD;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODE;
		} else {
			process.env.LLM_CONTENT_FILTER_MODE = originalEnv;
		}

		if (originalMethodEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_METHOD;
		} else {
			process.env.LLM_CONTENT_FILTER_METHOD = originalMethodEnv;
		}
	});

	it("returns disabled by default when env var is not set", () => {
		delete process.env.LLM_CONTENT_FILTER_MODE;
		expect(getContentFilterMode()).toBe("disabled");
	});

	it("returns disabled for empty string", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "";
		expect(getContentFilterMode()).toBe("disabled");
	});

	it("returns disabled for unknown values", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "something";
		expect(getContentFilterMode()).toBe("disabled");
	});

	it("returns monitor when set to monitor", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "monitor";
		expect(getContentFilterMode()).toBe("monitor");
	});

	it("returns enabled when set to enabled", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "enabled";
		expect(getContentFilterMode()).toBe("enabled");
	});

	it("returns enabled for legacy openai mode", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "openai";
		expect(getContentFilterMode()).toBe("enabled");
	});
});

describe("getContentFilterMethod", () => {
	const originalModeEnv = process.env.LLM_CONTENT_FILTER_MODE;
	const originalMethodEnv = process.env.LLM_CONTENT_FILTER_METHOD;

	afterEach(() => {
		if (originalModeEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODE;
		} else {
			process.env.LLM_CONTENT_FILTER_MODE = originalModeEnv;
		}

		if (originalMethodEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_METHOD;
		} else {
			process.env.LLM_CONTENT_FILTER_METHOD = originalMethodEnv;
		}
	});

	it("returns keywords by default when env var is not set", () => {
		delete process.env.LLM_CONTENT_FILTER_MODE;
		delete process.env.LLM_CONTENT_FILTER_METHOD;
		expect(getContentFilterMethod()).toBe("keywords");
	});

	it("returns keywords for unknown values", () => {
		process.env.LLM_CONTENT_FILTER_METHOD = "something";
		expect(getContentFilterMethod()).toBe("keywords");
	});

	it("returns openai when method is set to openai", () => {
		process.env.LLM_CONTENT_FILTER_METHOD = "openai";
		expect(getContentFilterMethod()).toBe("openai");
	});

	it("returns openai for legacy openai mode", () => {
		process.env.LLM_CONTENT_FILTER_MODE = "openai";
		delete process.env.LLM_CONTENT_FILTER_METHOD;
		expect(getContentFilterMethod()).toBe("openai");
	});
});

describe("getContentFilterModels", () => {
	const originalEnv = process.env.LLM_CONTENT_FILTER_MODELS;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODELS;
		} else {
			process.env.LLM_CONTENT_FILTER_MODELS = originalEnv;
		}
	});

	it("returns null by default when env var is not set", () => {
		delete process.env.LLM_CONTENT_FILTER_MODELS;
		expect(getContentFilterModels()).toBeNull();
	});

	it("keeps returning null on repeated calls when env var is not set", () => {
		delete process.env.LLM_CONTENT_FILTER_MODELS;
		expect(getContentFilterModels()).toBeNull();
		expect(getContentFilterModels()).toBeNull();
	});

	it("returns null for empty string", () => {
		process.env.LLM_CONTENT_FILTER_MODELS = "";
		expect(getContentFilterModels()).toBeNull();
	});

	it("returns normalized model ids when configured", () => {
		process.env.LLM_CONTENT_FILTER_MODELS =
			" gemini-3-pro-image-preview, gemini-3.1-flash-image-preview ";
		expect(getContentFilterModels()).toEqual([
			"gemini-3-pro-image-preview",
			"gemini-3.1-flash-image-preview",
		]);
	});

	it("returns null for all-empty configured model lists", () => {
		process.env.LLM_CONTENT_FILTER_MODELS = " , , ";
		expect(getContentFilterModels()).toBeNull();
		expect(getContentFilterModels()).toBeNull();
	});
});

describe("shouldApplyContentFilterToModel", () => {
	const originalEnv = process.env.LLM_CONTENT_FILTER_MODELS;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODELS;
		} else {
			process.env.LLM_CONTENT_FILTER_MODELS = originalEnv;
		}
	});

	it("returns true when no model filter is configured", () => {
		delete process.env.LLM_CONTENT_FILTER_MODELS;
		expect(shouldApplyContentFilterToModel("gpt-4o-mini")).toBe(true);
	});

	it("returns true for configured canonical model names", () => {
		process.env.LLM_CONTENT_FILTER_MODELS =
			"gemini-3-pro-image-preview,gemini-3.1-flash-image-preview";
		expect(shouldApplyContentFilterToModel("gemini-3-pro-image-preview")).toBe(
			true,
		);
		expect(
			shouldApplyContentFilterToModel("gemini-3.1-flash-image-preview"),
		).toBe(true);
	});

	it("returns false for models outside the configured list", () => {
		process.env.LLM_CONTENT_FILTER_MODELS =
			"gemini-3-pro-image-preview,gemini-3.1-flash-image-preview";
		expect(shouldApplyContentFilterToModel("gpt-4o-mini")).toBe(false);
	});

	it("returns true for all models when configured list only contains empties", () => {
		process.env.LLM_CONTENT_FILTER_MODELS = " , , ";
		expect(shouldApplyContentFilterToModel("gpt-4o-mini")).toBe(true);
		expect(shouldApplyContentFilterToModel("custom")).toBe(true);
	});
});
