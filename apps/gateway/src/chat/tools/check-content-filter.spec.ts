import { describe, it, expect, afterEach } from "vitest";

import {
	checkContentFilter,
	getContentFilterMode,
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

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODE;
		} else {
			process.env.LLM_CONTENT_FILTER_MODE = originalEnv;
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
});
