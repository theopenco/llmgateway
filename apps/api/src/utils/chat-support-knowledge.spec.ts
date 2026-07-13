import { describe, expect, test } from "vitest";

import { isAllowedKnowledgeUrl } from "./chat-support-knowledge.js";

describe("isAllowedKnowledgeUrl", () => {
	test("allows the product domains over https", () => {
		expect(isAllowedKnowledgeUrl("https://llmgateway.io/quick-start")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://docs.llmgateway.io/v1_models")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://devpass.llmgateway.io/")).toBe(true);
		expect(isAllowedKnowledgeUrl("https://chat.llmgateway.io/")).toBe(true);
	});

	test("rejects other hosts", () => {
		expect(isAllowedKnowledgeUrl("https://evil.com/")).toBe(false);
		expect(isAllowedKnowledgeUrl("https://llmgateway.io.evil.com/")).toBe(
			false,
		);
		expect(isAllowedKnowledgeUrl("https://notllmgateway.io/")).toBe(false);
	});

	test("rejects non-https schemes", () => {
		expect(isAllowedKnowledgeUrl("http://llmgateway.io/")).toBe(false);
		expect(isAllowedKnowledgeUrl("file:///etc/passwd@llmgateway.io")).toBe(
			false,
		);
	});

	test("rejects malformed urls", () => {
		expect(isAllowedKnowledgeUrl("not a url")).toBe(false);
		expect(isAllowedKnowledgeUrl("")).toBe(false);
	});
});
