import { parquetWriteBuffer } from "hyparquet-writer";
import { afterEach, expect, test, vi } from "vitest";

import { getArenaBenchmarks, parseArenaRows } from "./arena-benchmarks.js";

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
