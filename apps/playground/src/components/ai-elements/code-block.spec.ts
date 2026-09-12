import { beforeEach, describe, expect, it, vi } from "vitest";

import { highlightCode } from "./code-block";

const { codeToTokens } = vi.hoisted(() => ({
	codeToTokens: vi.fn((code: string) => ({
		tokens: [[{ content: code, offset: 0 }]],
	})),
}));

vi.mock("shiki", () => ({
	createHighlighter: async () => ({
		getLoadedLanguages: () => ["javascript", "typescript"],
		codeToTokens,
	}),
}));

type HighlightedCode = NonNullable<ReturnType<typeof highlightCode>>;

function highlight(code: string) {
	return new Promise<HighlightedCode>((resolve) => {
		const cached = highlightCode(code, "javascript", resolve);
		if (cached) {
			resolve(cached);
		}
	});
}

describe("highlightCode", () => {
	beforeEach(() => {
		codeToTokens.mockClear();
	});

	it.each([
		["short snippets", 'console.log("ab");', 'console.log("bA");'],
		[
			"matching prefixes and suffixes",
			`${"// prefix\n".repeat(15)}const value = "Aa";${"\n// suffix".repeat(15)}`,
			`${"// prefix\n".repeat(15)}const value = "B@";${"\n// suffix".repeat(15)}`,
		],
	])("preserves distinct source text for %s", async (_label, first, second) => {
		const results = await Promise.all([highlight(first), highlight(second)]);
		expect(results.map((result) => result.tokens[0][0].content)).toEqual([
			first,
			second,
		]);
		expect(codeToTokens).toHaveBeenCalledTimes(2);
		expect(highlightCode(first, "javascript")).toEqual(results[0]);
		expect(highlightCode(second, "javascript")).toEqual(results[1]);
	});

	it("shares one tokenization across concurrent subscribers", async () => {
		const code = "const shared = true;";
		expect(highlightCode(code, "javascript")).toBeNull();
		const results = await Promise.all([highlight(code), highlight(code)]);
		expect(results[0]).toBe(results[1]);
		expect(codeToTokens).toHaveBeenCalledTimes(1);
	});

	it("keeps different languages separate", async () => {
		const code = "const language = 1;";
		await highlight(code);
		expect(highlightCode(code, "typescript")).toBeNull();
		await vi.waitFor(() => expect(codeToTokens).toHaveBeenCalledTimes(2));
		expect(codeToTokens).toHaveBeenLastCalledWith(
			code,
			expect.objectContaining({ lang: "typescript" }),
		);
	});

	it("allows a failed tokenization to be retried", async () => {
		const code = "const retry = true;";
		const failure = new Error("Temporary tokenization failure");
		codeToTokens.mockImplementationOnce(() => {
			throw failure;
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			highlightCode(code, "javascript");
			await vi.waitFor(() =>
				expect(log).toHaveBeenCalledWith("Failed to highlight code:", failure),
			);
			expect((await highlight(code)).tokens[0][0].content).toBe(code);
			expect(codeToTokens).toHaveBeenCalledTimes(2);
		} finally {
			log.mockRestore();
		}
	});
});
