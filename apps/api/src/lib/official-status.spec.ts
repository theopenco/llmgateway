import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchOfficialStatus, statusPageApiBase } from "./official-status.js";

const NOW = new Date("2026-11-07T12:00:00Z");

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

const summary = {
	status: { indicator: "minor", description: "Partially Degraded Service" },
	components: [
		{ name: "API", status: "degraded_performance", group_id: null },
		{ name: "API / Europe", status: "operational", group_id: "grp" },
		{
			name: "Legacy",
			status: "operational",
			group_id: null,
			only_show_if_degraded: true,
		},
		{ name: "Console", status: "operational" },
	],
};

const incidents = {
	incidents: [
		{
			id: "recent",
			name: "Elevated errors",
			status: "resolved",
			impact: "major",
			created_at: "2026-11-01T10:00:00Z",
			resolved_at: "2026-11-01T11:00:00Z",
			shortlink: "https://stspg.io/abc",
		},
		{
			id: "no-shortlink",
			name: "Slow responses",
			status: "investigating",
			impact: "unknown-impact",
			created_at: "2026-10-20T10:00:00Z",
			resolved_at: "not a date",
		},
		{
			id: "old",
			name: "Ancient outage",
			status: "resolved",
			impact: "critical",
			created_at: "2026-07-01T10:00:00Z",
			resolved_at: "2026-07-01T12:00:00Z",
		},
	],
};

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
	const fetchMock = vi.fn(
		async (input: string | URL | Request) =>
			await handler(String(input instanceof Request ? input.url : input)),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("statusPageApiBase", () => {
	test.each([
		["https://status.claude.com", "https://status.claude.com/api/v2"],
		["https://status.openai.com/", "https://status.openai.com/api/v2"],
		["https://aistudio.google.com/status", null],
		["http://status.example.com", null],
		["not a url", null],
	])("%s", (input, expected) => {
		expect(statusPageApiBase(input)).toBe(expected);
	});
});

describe("fetchOfficialStatus", () => {
	test("parses the summary and recent incidents", async () => {
		const fetchMock = stubFetch((url) =>
			url.endsWith("/summary.json") ? json(summary) : json(incidents),
		);

		const status = await fetchOfficialStatus("https://status.example.com", NOW);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://status.example.com/api/v2/summary.json",
			expect.objectContaining({ redirect: "manual" }),
		);
		expect(status).toEqual({
			indicator: "minor",
			description: "Partially Degraded Service",
			components: [
				{ name: "API", status: "degraded_performance" },
				{ name: "Console", status: "operational" },
			],
			incidents: [
				{
					id: "recent",
					name: "Elevated errors",
					status: "resolved",
					impact: "major",
					createdAt: "2026-11-01T10:00:00.000Z",
					resolvedAt: "2026-11-01T11:00:00.000Z",
					url: "https://stspg.io/abc",
				},
				{
					id: "no-shortlink",
					name: "Slow responses",
					status: "investigating",
					impact: "none",
					createdAt: "2026-10-20T10:00:00.000Z",
					resolvedAt: null,
					url: "https://status.example.com/incidents/no-shortlink",
				},
			],
		});
	});

	test("rejects when incidents fail transiently", async () => {
		stubFetch((url) =>
			url.endsWith("/summary.json") ? json(summary) : json({}, 503),
		);

		await expect(
			fetchOfficialStatus("https://status.example.com", NOW),
		).rejects.toThrow();
	});

	test("keeps the summary when the page has no incidents feed", async () => {
		stubFetch((url) =>
			url.endsWith("/summary.json") ? json(summary) : json({}, 404),
		);

		const status = await fetchOfficialStatus("https://status.example.com", NOW);

		expect(status?.indicator).toBe("minor");
		expect(status?.incidents).toEqual([]);
	});

	test.each([
		["a 404", () => json({ error: "not found" }, 404)],
		[
			"an HTML page",
			() =>
				new Response("<html></html>", {
					headers: { "content-type": "text/html" },
				}),
		],
		["an unexpected shape", () => json({ hello: "world" })],
		[
			"a redirect",
			() =>
				new Response(null, {
					status: 301,
					headers: { location: "https://elsewhere.example.com/" },
				}),
		],
	])("returns null on %s", async (_label, handler) => {
		stubFetch(handler);

		expect(
			await fetchOfficialStatus("https://status.example.com", NOW),
		).toBeNull();
	});

	test.each([
		["a 503", () => json({}, 503)],
		["a 429", () => json({}, 429)],
		[
			"a network error",
			() => {
				throw new TypeError("fetch failed");
			},
		],
	])("rejects on %s so it is not cached", async (_label, handler) => {
		stubFetch(handler);

		await expect(
			fetchOfficialStatus("https://status.example.com", NOW),
		).rejects.toThrow();
	});

	test("does not fetch pages without a Statuspage API", async () => {
		const fetchMock = stubFetch(() => json(summary));

		expect(
			await fetchOfficialStatus("https://aistudio.google.com/status", NOW),
		).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
