import { describe, expect, it } from "vitest";

import {
	formatMonthLabel,
	monthKeyOf,
	normalizeSearchText,
	scoreModelSearchEntry,
	searchMatchRanges,
	searchModelEntries,
	searchModelProviders,
	searchWords,
	withinOneEdit,
	type ModelSearchEntry,
} from "./model-search";

function entry(
	id: string,
	addedAt: string | null,
	overrides: Partial<ModelSearchEntry> = {},
): ModelSearchEntry {
	return {
		id,
		name: id,
		family: "test",
		aliases: [],
		addedAt,
		free: false,
		providerIds: ["acme"],
		providerNames: ["Acme"],
		...overrides,
	};
}

const sonnet = entry("claude-sonnet-4-5", "2026-08-10T00:00:00.000Z", {
	name: "Claude Sonnet 4.5",
	family: "claude",
	aliases: ["claude-sonnet-4.5"],
	providerIds: ["anthropic"],
	providerNames: ["Anthropic"],
});
const gpt5 = entry("gpt-5", "2026-07-01T00:00:00.000Z", {
	name: "GPT-5",
	family: "gpt",
	providerIds: ["openai"],
	providerNames: ["OpenAI"],
});
const gpt5Mini = entry("gpt-5-mini", "2026-07-02T00:00:00.000Z", {
	name: "GPT-5 Mini",
	family: "gpt",
	providerIds: ["openai"],
	providerNames: ["OpenAI"],
});
const gemini = entry("gemini-3-pro", "2026-06-15T00:00:00.000Z", {
	name: "Gemini 3 Pro",
	family: "gemini",
	providerIds: ["google-vertex"],
	providerNames: ["Google Vertex AI"],
});

describe("normalizeSearchText / searchWords", () => {
	it("drops case, accents and separators", () => {
		expect(normalizeSearchText("Mistral Médium-3.1")).toBe("mistralmedium31");
		expect(searchWords("openai/gpt-5.1_mini (preview)")).toEqual([
			"openai",
			"gpt",
			"5",
			"1",
			"mini",
			"preview",
		]);
	});
});

describe("withinOneEdit", () => {
	it("accepts a single insertion, deletion, substitution or transposition", () => {
		expect(withinOneEdit("sonnet", "sonnet")).toBe(true);
		expect(withinOneEdit("sonnet", "sonet")).toBe(true);
		expect(withinOneEdit("sonnet", "sonnnet")).toBe(true);
		expect(withinOneEdit("claude", "clause")).toBe(true);
		expect(withinOneEdit("claude", "calude")).toBe(true);
	});

	it("rejects two edits", () => {
		expect(withinOneEdit("sonnet", "sonn")).toBe(false);
		expect(withinOneEdit("claude", "clavdi")).toBe(false);
	});
});

describe("monthKeyOf / formatMonthLabel", () => {
	it("keys by UTC month and labels it", () => {
		expect(monthKeyOf("2026-09-01T00:30:00.000Z")).toBe("2026-09");
		expect(monthKeyOf(null)).toBe("unknown");
		expect(monthKeyOf("not a date")).toBe("unknown");
		expect(formatMonthLabel("2026-09")).toBe("September 2026");
		expect(formatMonthLabel("2026-09", "short")).toBe("Sep 2026");
		expect(formatMonthLabel("unknown")).toBe("Unknown date");
	});
});

describe("scoreModelSearchEntry", () => {
	it("ranks exact, prefix and substring label hits in that order", () => {
		const exact = scoreModelSearchEntry(gpt5, "gpt-5");
		const prefix = scoreModelSearchEntry(gpt5Mini, "gpt-5");
		const substring = scoreModelSearchEntry(
			entry("openai-gpt-5-chat", "2026-01-01T00:00:00.000Z"),
			"gpt-5",
		);
		expect(exact).toBeGreaterThan(prefix);
		expect(prefix).toBeGreaterThan(substring);
		expect(substring).toBeGreaterThan(0);
	});

	it("matches every token across name, id, aliases, family and providers", () => {
		expect(scoreModelSearchEntry(sonnet, "anthropic sonnet")).toBeGreaterThan(
			0,
		);
		expect(scoreModelSearchEntry(sonnet, "claude-sonnet-4.5")).toBeGreaterThan(
			scoreModelSearchEntry(sonnet, "sonnet"),
		);
		expect(scoreModelSearchEntry(gemini, "vertex gemini")).toBeGreaterThan(0);
		expect(scoreModelSearchEntry(gemini, "anthropic gemini")).toBe(0);
	});

	it("tolerates one typo per token but not short or double typos", () => {
		expect(scoreModelSearchEntry(sonnet, "sonet")).toBeGreaterThan(0);
		expect(scoreModelSearchEntry(sonnet, "clade sonnet")).toBeGreaterThan(0);
		expect(scoreModelSearchEntry(sonnet, "sonnt")).toBeGreaterThan(0);
		expect(scoreModelSearchEntry(sonnet, "snt")).toBe(0);
		expect(scoreModelSearchEntry(sonnet, "sonnttt")).toBe(0);
	});

	it("scores fuzzy hits below real hits and empty queries as no match", () => {
		expect(scoreModelSearchEntry(sonnet, "sonet")).toBeLessThan(
			scoreModelSearchEntry(sonnet, "sonnet"),
		);
		expect(scoreModelSearchEntry(sonnet, "")).toBe(0);
		expect(scoreModelSearchEntry(sonnet, " - ")).toBe(0);
	});
});

describe("searchModelEntries without a query", () => {
	const july = [
		entry("july-a", "2026-07-20T00:00:00.000Z"),
		entry("july-b", "2026-07-05T00:00:00.000Z"),
	];
	const june = [entry("june-a", "2026-06-01T00:00:00.000Z")];
	const may = [entry("may-a", "2026-05-09T00:00:00.000Z")];
	const undated = [entry("undated", null)];
	const entries = [...undated, ...may, ...june, ...july];

	it("walks whole months newest first and batches small months to the limit", () => {
		const first = searchModelEntries(entries, { limit: 2 });
		expect(first.groupedByMonth).toBe(true);
		expect(first.total).toBe(5);
		expect(first.items.map((hit) => hit.entry.id)).toEqual([
			"july-a",
			"july-b",
		]);
		expect(first.items.map((hit) => hit.monthKey)).toEqual([
			"2026-07",
			"2026-07",
		]);
		expect(first.nextCursor).toBe("m:2026-06:0");

		const second = searchModelEntries(entries, {
			limit: 2,
			cursor: first.nextCursor,
		});
		expect(second.items.map((hit) => hit.entry.id)).toEqual([
			"june-a",
			"may-a",
		]);
		expect(second.nextCursor).toBe("m:unknown:0");

		const third = searchModelEntries(entries, {
			limit: 2,
			cursor: second.nextCursor,
		});
		expect(third.items.map((hit) => hit.entry.id)).toEqual(["undated"]);
		expect(third.items[0].monthKey).toBe("unknown");
		expect(third.nextCursor).toBeNull();
	});

	it("splits a month larger than the hard cap with an in-month offset", () => {
		const big = Array.from({ length: 60 }, (_, i) =>
			entry(`big-${String(i).padStart(2, "0")}`, "2026-08-15T00:00:00.000Z"),
		);
		const all = [...big, ...june];
		const first = searchModelEntries(all, { limit: 20 });
		expect(first.items).toHaveLength(50);
		expect(first.nextCursor).toBe("m:2026-08:50");

		const second = searchModelEntries(all, {
			limit: 20,
			cursor: first.nextCursor,
		});
		expect(second.items).toHaveLength(11);
		expect(second.items.map((hit) => hit.monthKey)).toEqual([
			...Array.from({ length: 10 }, () => "2026-08"),
			"2026-06",
		]);
		expect(second.nextCursor).toBeNull();
	});

	it("falls through to the next older month when the cursor month vanished", () => {
		const page = searchModelEntries(entries, {
			limit: 2,
			cursor: "m:2026-06:0",
		});
		expect(page.items[0].entry.id).toBe("june-a");
		const gone = searchModelEntries(entries, {
			limit: 2,
			cursor: "m:2026-05:7",
		});
		expect(gone.items.map((hit) => hit.entry.id)).toEqual(["undated"]);
		expect(
			searchModelEntries([...july], { limit: 2, cursor: "m:2025-01:0" }).items,
		).toEqual([]);
	});

	it("clamps the limit and ignores malformed cursors", () => {
		expect(searchModelEntries(entries, { limit: 0 }).items).toHaveLength(5);
		expect(searchModelEntries(entries, { limit: 999 }).items).toHaveLength(5);
		expect(
			searchModelEntries(entries, { cursor: "garbage" }).items[0].entry.id,
		).toBe("july-a");
	});
});

describe("searchModelEntries with a query", () => {
	const entries = [gemini, gpt5Mini, gpt5, sonnet];

	it("ranks by relevance, then recency, and pages by offset", () => {
		const first = searchModelEntries(entries, { query: "gpt", limit: 1 });
		expect(first.groupedByMonth).toBe(false);
		expect(first.total).toBe(2);
		expect(first.items[0].entry.id).toBe("gpt-5-mini");
		expect(first.items[0].score).toBeGreaterThan(0);
		expect(first.nextCursor).toBe("o:1");

		const second = searchModelEntries(entries, {
			query: "gpt",
			limit: 1,
			cursor: first.nextCursor,
		});
		expect(second.items[0].entry.id).toBe("gpt-5");
		expect(second.nextCursor).toBeNull();
	});

	it("puts the exact id first and keeps month keys on hits", () => {
		const page = searchModelEntries(entries, { query: "gpt-5" });
		expect(page.items.map((hit) => hit.entry.id)).toEqual([
			"gpt-5",
			"gpt-5-mini",
		]);
		expect(page.items[0].monthKey).toBe("2026-07");
	});

	it("ignores provider tokens when ranking provider/model queries", () => {
		const gptImage = entry("gpt-image-2.5", "2026-09-01T00:00:00.000Z", {
			name: "GPT Image 2.5",
			family: "gpt",
			providerIds: ["openai"],
			providerNames: ["OpenAI"],
		});
		const page = searchModelEntries([...entries, gptImage], {
			query: "openai/gpt-5",
		});
		expect(page.items.map((hit) => hit.entry.id)).toEqual([
			"gpt-5",
			"gpt-5-mini",
			"gpt-image-2.5",
		]);
	});

	it("returns nothing for unmatched queries and treats blanks as no query", () => {
		expect(searchModelEntries(entries, { query: "llama" }).items).toEqual([]);
		expect(searchModelEntries(entries, { query: "   " }).groupedByMonth).toBe(
			true,
		);
	});
});

describe("searchModelProviders", () => {
	const providers = [
		{ id: "openai", name: "OpenAI" },
		{ id: "google-vertex", name: "Google Vertex AI" },
	];

	it("matches every token against name and id", () => {
		expect(searchModelProviders(providers, "vertex")).toEqual([providers[1]]);
		expect(searchModelProviders(providers, "google-vertex")).toEqual([
			providers[1],
		]);
		expect(searchModelProviders(providers, "open ai")).toEqual([providers[0]]);
		expect(searchModelProviders(providers, "open vertex")).toEqual([]);
		expect(searchModelProviders(providers, "")).toEqual([]);
	});
});

describe("searchMatchRanges", () => {
	it("maps normalized hits back onto the raw label", () => {
		expect(searchMatchRanges("GPT-5 Mini", "gpt5")).toEqual([[0, 5]]);
		expect(searchMatchRanges("Claude Sonnet 4.5", "sonnet 4.5")).toEqual([
			[7, 17],
		]);
		expect(searchMatchRanges("claude-sonnet-4-5", "claude sonnet")).toEqual([
			[0, 13],
		]);
		expect(
			searchMatchRanges("Claude Sonnet 4.5 (2025-09-29)", "sonnet 4.5"),
		).toEqual([[7, 17]]);
	});

	it("returns nothing for empty inputs or misses", () => {
		expect(searchMatchRanges("GPT-5", "")).toEqual([]);
		expect(searchMatchRanges("", "gpt")).toEqual([]);
		expect(searchMatchRanges("GPT-5", "llama")).toEqual([]);
	});
});
