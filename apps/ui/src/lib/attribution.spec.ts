import { describe, expect, it } from "vitest";

import { classifyChannel } from "./attribution";

const HOST = "llmgateway.io";

describe("classifyChannel", () => {
	it("treats a missing referrer as direct", () => {
		expect(classifyChannel("", "", HOST)).toBe("direct");
	});

	it("classifies search engines", () => {
		expect(classifyChannel("https://www.google.com/", "", HOST)).toBe(
			"organic_search",
		);
		expect(classifyChannel("https://www.google.com.hk/", "", HOST)).toBe(
			"organic_search",
		);
		expect(classifyChannel("https://duckduckgo.com/", "", HOST)).toBe(
			"organic_search",
		);
	});

	it("separates AI assistants from generic referrals", () => {
		expect(classifyChannel("https://chatgpt.com/", "", HOST)).toBe(
			"ai_assistant",
		);
		expect(classifyChannel("https://www.perplexity.ai/", "", HOST)).toBe(
			"ai_assistant",
		);
		expect(classifyChannel("https://gemini.google.com/app", "", HOST)).toBe(
			"ai_assistant",
		);
		expect(classifyChannel("https://example.dev/post", "", HOST)).toBe(
			"referral",
		);
	});

	it("classifies social sources", () => {
		expect(classifyChannel("https://t.co/abc", "", HOST)).toBe("social");
		expect(classifyChannel("https://www.reddit.com/r/x", "", HOST)).toBe(
			"social",
		);
	});

	// Ads commonly arrive with a search-engine referrer, so the click id has to
	// win or every paid click is miscounted as organic.
	it("prefers a click identifier over the referrer", () => {
		expect(
			classifyChannel("https://www.google.com/", "?gclid=abc123", HOST),
		).toBe("paid");
		expect(classifyChannel("", "?utm_medium=cpc", HOST)).toBe("paid");
		expect(classifyChannel("https://www.bing.com/", "?msclkid=xyz", HOST)).toBe(
			"paid",
		);
	});

	// Meta appends fbclid to organic shares as well as ads, so it cannot stand
	// alone as a paid signal without booking organic social as ad traffic.
	it("does not treat fbclid alone as paid", () => {
		expect(
			classifyChannel("https://www.facebook.com/", "?fbclid=abc123", HOST),
		).toBe("social");
		expect(
			classifyChannel(
				"https://www.facebook.com/",
				"?fbclid=abc123&utm_medium=cpc",
				HOST,
			),
		).toBe("paid");
	});

	it("marks same-site and sibling hosts as internal", () => {
		expect(classifyChannel("https://llmgateway.io/blog", "", HOST)).toBe(
			"internal",
		);
		expect(classifyChannel("https://devpass.llmgateway.io/", "", HOST)).toBe(
			"internal",
		);
	});

	it("falls back to direct on an unparseable referrer", () => {
		expect(classifyChannel("not a url", "", HOST)).toBe("direct");
	});
});
