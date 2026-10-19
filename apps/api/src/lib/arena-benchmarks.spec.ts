import { parquetWriteBuffer } from "hyparquet-writer";
import { afterEach, expect, test, vi } from "vitest";

import {
	getArenaBenchmarks,
	parseArenaRows,
	findArenaMatch,
} from "./arena-benchmarks.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function snapshot(rows: Record<string, unknown>[]): ArrayBuffer {
	return parquetWriteBuffer({
		columnData: [
			{
				name: "model_name",
				data: rows.map((row) => row.model_name),
				type: "STRING",
			},
			{ name: "rating", data: rows.map((row) => row.rating), type: "DOUBLE" },
			{ name: "rank", data: rows.map((row) => row.rank), type: "INT64" },
			{
				name: "category",
				data: rows.map((row) => row.category),
				type: "STRING",
			},
			{
				name: "leaderboard_publish_date",
				data: rows.map((row) => row.leaderboard_publish_date),
				type: "STRING",
			},
		],
	});
}

// Shaped like the published dataset: several categories and publish dates.
const rows = [
	{
		model_name: "stale-model",
		rating: 1600,
		rank: 1n,
		category: "overall",
		leaderboard_publish_date: "2026-09-01",
	},
	{
		model_name: "fixture-model",
		rating: 1523.5,
		rank: 1n,
		category: "overall",
		leaderboard_publish_date: "2026-09-26",
	},
	{
		model_name: "fixture-model (High)",
		rating: 1499.4,
		rank: 2n,
		category: "overall",
		leaderboard_publish_date: "2026-09-26",
	},
	{
		model_name: "coding-only-model",
		rating: 1900,
		rank: 1n,
		category: "coding",
		leaderboard_publish_date: "2026-09-26",
	},
];

test("uses the newest published overall ranking and skips other categories", () => {
	expect(parseArenaRows(rows, "text_style_control")).toEqual({
		entries: [
			{ rank: 1, model: "fixture-model", score: 1524 },
			{ rank: 2, model: "fixture-model (High)", score: 1499 },
		],
		publishedAt: "2026-09-26",
	});
});

test("reports a snapshot without an overall ranking as empty", () => {
	expect(parseArenaRows([], "webdev")).toEqual({
		entries: [],
		publishedAt: null,
	});
});

test("stays unavailable and backs off while the dataset cannot be reached", async () => {
	vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response("unavailable", { status: 503 }));
	expect(await getArenaBenchmarks()).toBeNull();
	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(await getArenaBenchmarks()).toBeNull();
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("reads the published parquet snapshots and keeps the last good one on failure", async () => {
	vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
	// Two fetches per subset: the directory listing, then the parquet download.
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = String(input);
		if (url.includes("/tree/main/")) {
			const subset = url.endsWith("/webdev") ? "webdev" : "text_style_control";
			return Response.json([
				{ type: "file", path: `${subset}/full-00000-of-00001.parquet` },
				{ type: "file", path: `${subset}/latest-00000-of-00001.parquet` },
			]);
		}
		return new Response(snapshot(rows));
	});
	const current = await getArenaBenchmarks();
	expect(current?.text).toEqual([
		{ rank: 1, model: "fixture-model", score: 1524 },
		{ rank: 2, model: "fixture-model (High)", score: 1499 },
	]);
	expect(current?.code).toEqual(current?.text);
	expect(current?.fetchedAt).toBe("2026-09-26");

	vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
	vi.mocked(fetch).mockResolvedValue(new Response("gone", { status: 404 }));
	expect(await getArenaBenchmarks()).toEqual(current);
});

test("matches Arena display names to our model ids", () => {
	const entries = [
		{ rank: 1, model: "Gemini 4 Argon (High)", score: 1524 },
		{ rank: 2, model: "Claude Opus 4.6", score: 1497 },
		{ rank: 3, model: "Claude Opus 4.6 (High)", score: 1503 },
		{ rank: 4, model: "gpt-5.4", score: 1465 },
		{ rank: 5, model: "gpt-5-high", score: 1435 },
		{ rank: 6, model: "deepseek-v4.1-flash-max", score: 1475 },
		{ rank: 7, model: "claude-haiku-4-5-20251001", score: 1414 },
		{ rank: 8, model: "Claude Sonnet 5.5 (xHigh)", score: 1768 },
	];

	// Same words, preferring the entry without an effort qualifier.
	expect(findArenaMatch("gemini-4-argon", entries)?.model).toBe(
		"Gemini 4 Argon (High)",
	);
	expect(findArenaMatch("claude-opus-4-6", entries)?.model).toBe(
		"Claude Opus 4.6",
	);
	// A trailing version or model word names a different model.
	expect(findArenaMatch("gpt-5.4", entries)?.rank).toBe(4);
	expect(findArenaMatch("gpt-5", entries)?.model).toBe("gpt-5-high");
	// Effort and rollout words are discounted on either side.
	expect(findArenaMatch("deepseek-v4.1-flash-1017", entries)?.rank).toBe(6);
	expect(findArenaMatch("claude-haiku-4-5", entries)?.rank).toBe(7);
	expect(findArenaMatch("claude-sonnet-5-5", entries)?.rank).toBe(8);
	expect(findArenaMatch("claude-3-opus-20240229", entries)).toBeNull();
});
