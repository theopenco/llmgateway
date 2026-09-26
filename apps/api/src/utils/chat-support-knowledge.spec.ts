import { describe, expect, test } from "vitest";

import {
	KNOWLEDGE_LLMS_TXT,
	KNOWLEDGE_REFERENCE_DOCS,
	KNOWLEDGE_SITEMAPS,
	isAllowedKnowledgeUrl,
	selectKnowledgeUrls,
	summarizeCatalogue,
	toDocsMarkdownUrl,
} from "./chat-support-knowledge.js";

test("indexes every public product", () => {
	expect(KNOWLEDGE_SITEMAPS).toEqual([
		"https://llmgateway.io/sitemap.xml",
		"https://devpass.llmgateway.io/sitemap.xml",
		"https://docs.llmgateway.io/sitemap.xml",
		"https://lounge.llmgateway.io/sitemap.xml",
		"https://airside.llmgateway.io/sitemap.xml",
	]);
	expect(KNOWLEDGE_LLMS_TXT).toEqual([
		"https://llmgateway.io/llms.txt",
		"https://devpass.llmgateway.io/llms.txt",
		"https://lounge.llmgateway.io/llms.txt",
		"https://airside.llmgateway.io/llms.txt",
	]);
});

describe("isAllowedKnowledgeUrl", () => {
	test("allows the product domains over https", () => {
		expect(isAllowedKnowledgeUrl("https://llmgateway.io/quick-start")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://docs.llmgateway.io/v1_models")).toBe(
			true,
		);
		expect(isAllowedKnowledgeUrl("https://devpass.llmgateway.io/")).toBe(true);
		expect(isAllowedKnowledgeUrl("https://lounge.llmgateway.io/")).toBe(true);
		expect(isAllowedKnowledgeUrl("https://airside.llmgateway.io/")).toBe(true);
		// Kept allowed after the move: the old host still 301s to lounge.
		expect(isAllowedKnowledgeUrl("https://chat.llmgateway.io/")).toBe(true);
	});

	test("rejects user-generated Lounge shares", () => {
		expect(
			isAllowedKnowledgeUrl("https://lounge.llmgateway.io/share/public-chat"),
		).toBe(false);
		expect(
			isAllowedKnowledgeUrl("https://chat.llmgateway.io/share/public-chat"),
		).toBe(false);
		expect(isAllowedKnowledgeUrl("https://lounge.llmgateway.io/group")).toBe(
			true,
		);
	});

	test("rejects other hosts", () => {
		expect(isAllowedKnowledgeUrl("https://evil.com/")).toBe(false);
		expect(isAllowedKnowledgeUrl("https://llmgateway.io.evil.com/")).toBe(
			false,
		);
		expect(isAllowedKnowledgeUrl("https://notllmgateway.io/")).toBe(false);
		expect(isAllowedKnowledgeUrl("https://preview.llmgateway.io/")).toBe(false);
		expect(
			isAllowedKnowledgeUrl(
				"https://internal.llmgateway.io/public/chats/share/public-chat",
			),
		).toBe(false);
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

describe("selectKnowledgeUrls", () => {
	test("keeps every product represented when one sitemap exceeds the limit", () => {
		const priorityUrls = [
			"https://llmgateway.io/llms.txt",
			"https://airside.llmgateway.io/llms.txt",
		];
		const mainUrls = Array.from(
			{ length: 700 },
			(_, index) => `https://llmgateway.io/models/model-${index}`,
		);
		const groups = [
			mainUrls,
			["https://devpass.llmgateway.io/guides"],
			["https://docs.llmgateway.io/quick-start"],
			["https://lounge.llmgateway.io/group"],
			["https://airside.llmgateway.io/legal/terms"],
		];

		const selected = selectKnowledgeUrls(priorityUrls, groups, 600);

		expect(selected).toHaveLength(600);
		expect(selected.slice(0, 7)).toEqual([
			...priorityUrls,
			groups[1]![0],
			mainUrls[0],
			groups[2]![0],
			groups[3]![0],
			groups[4]![0],
		]);
		expect(selected).toEqual(selectKnowledgeUrls(priorityUrls, groups, 600));
	});

	test("deduplicates URLs and drops excluded pages", () => {
		const selected = selectKnowledgeUrls(
			["https://llmgateway.io/llms.txt"],
			[
				[
					"https://llmgateway.io/llms.txt",
					"https://lounge.llmgateway.io/share/public-chat",
				],
				["https://docs.llmgateway.io/quick-start"],
			],
		);

		expect(selected).toEqual([
			"https://llmgateway.io/llms.txt",
			"https://docs.llmgateway.io/quick-start",
		]);
	});

	test("keeps guides that follow a large catalogue section", () => {
		const catalogueUrls = Array.from(
			{ length: 700 },
			(_, index) => `https://llmgateway.io/models/model-${index}`,
		);
		const guideUrls = [
			"https://llmgateway.io/guides/devpass-code",
			"https://llmgateway.io/guides/codex-cli",
		];

		const selected = selectKnowledgeUrls(
			[],
			[[...catalogueUrls, ...guideUrls]],
			600,
		);

		expect(selected).toHaveLength(600);
		expect(selected.slice(0, guideUrls.length)).toEqual(guideUrls);
	});

	test("keeps later products when the first sitemap has 600 guides", () => {
		const mainGuides = Array.from(
			{ length: 600 },
			(_, index) => `https://llmgateway.io/guides/guide-${index}`,
		);
		const laterProducts = [
			"https://devpass.llmgateway.io/guides/getting-started",
			"https://docs.llmgateway.io/quick-start",
			"https://lounge.llmgateway.io/group",
			"https://airside.llmgateway.io/legal/terms",
		];

		const selected = selectKnowledgeUrls(
			[],
			[mainGuides, ...laterProducts.map((url) => [url])],
			600,
		);

		expect(selected).toHaveLength(600);
		expect(selected.slice(0, laterProducts.length + 1)).toEqual([
			mainGuides[0],
			...laterProducts,
		]);
	});
});

describe("billing reference docs", () => {
	test("covers billing, invoices, and refunds on the docs host", () => {
		expect(KNOWLEDGE_REFERENCE_DOCS).toEqual(
			expect.arrayContaining([
				"https://docs.llmgateway.io/learn/billing",
				"https://docs.llmgateway.io/learn/transactions",
				"https://docs.llmgateway.io/learn/invoices",
				"https://docs.llmgateway.io/learn/refunds",
			]),
		);
		for (const url of KNOWLEDGE_REFERENCE_DOCS) {
			expect(isAllowedKnowledgeUrl(url)).toBe(true);
		}
	});

	test("maps a docs page to its markdown mirror", () => {
		expect(toDocsMarkdownUrl("https://docs.llmgateway.io/learn/refunds")).toBe(
			"https://docs.llmgateway.io/llms.mdx/learn/refunds",
		);
	});
});

describe("summarizeCatalogue", () => {
	const now = new Date("2026-09-26T12:00:00Z");
	const past = new Date("2026-09-01T00:00:00Z");
	const future = new Date("2026-12-01T00:00:00Z");

	test("counts only models routable on an active provider", () => {
		const summary = summarizeCatalogue(
			{
				models: [
					{ id: "gpt", free: false, output: ["text"] },
					{ id: "flux", free: false, output: ["image"] },
					{ id: "free-chat", free: true, output: ["text", "text"] },
					{ id: "retired", free: false, output: ["text"] },
					{ id: "orphan", free: false, output: ["text"] },
					{ id: "no-mapping", free: false, output: ["text"] },
				],
				mappings: [
					{ modelId: "gpt", providerId: "openai", deactivatedAt: null },
					{ modelId: "gpt", providerId: "azure", deactivatedAt: future },
					{ modelId: "flux", providerId: "bfl", deactivatedAt: null },
					{ modelId: "free-chat", providerId: "openai", deactivatedAt: null },
					{ modelId: "retired", providerId: "openai", deactivatedAt: past },
					{ modelId: "orphan", providerId: "disabled", deactivatedAt: null },
					{ modelId: "unknown", providerId: "openai", deactivatedAt: null },
				],
				providers: [
					{ id: "openai", name: "OpenAI" },
					{ id: "azure", name: "Azure" },
					{ id: "bfl", name: "Black Forest Labs" },
					{ id: "unused", name: "Unused" },
				],
			},
			now,
		);

		expect(summary).toEqual({
			modelCount: 3,
			providerCount: 3,
			freeModelCount: 1,
			outputCounts: { text: 2, image: 1 },
			providers: ["Azure", "Black Forest Labs", "OpenAI"],
			generatedAt: now.toISOString(),
		});
	});
});
