import { afterEach, expect, test, vi } from "vitest";

import { getArenaBenchmarks } from "./arena-benchmarks.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function page(category: string) {
	const payload = `1c:${JSON.stringify(["$", "$L40", null, { leaderboard: { arenaSlug: category, leaderboardSlug: "overall", entries: [{ rank: 1, modelDisplayName: "fixture-model", rating: 1523.5 }] } }])}\n`;
	return [payload.slice(0, 80), payload.slice(80)]
		.map(
			(chunk) =>
				`<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`,
		)
		.join("");
}

test("reports unavailable live data without inventing a historical leaderboard", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("unavailable", { status: 503 }),
	);
	await expect(getArenaBenchmarks()).rejects.toThrow("HTTP 503");
});

test("reads split Flight leaderboard records and preserves the last successful snapshot on failure", async () => {
	vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (url) =>
			new Response(page(String(url).endsWith("/code") ? "code" : "text")),
	);
	const current = await getArenaBenchmarks();
	expect(current.text).toEqual([
		{ rank: 1, model: "fixture-model", score: 1523.5 },
	]);
	expect(current.code).toEqual(current.text);
	vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
	vi.mocked(fetch).mockResolvedValue(
		new Response("<html>changed markup</html>"),
	);
	expect(await getArenaBenchmarks()).toEqual(current);
});
