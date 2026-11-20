import { describe, expect, it } from "vitest";

import { buildRssResponse } from "./rss";

describe("buildRssResponse", () => {
	it("escapes XML and lists the newest item first", async () => {
		const response = buildRssResponse({
			title: "Feed",
			description: "Posts & notes",
			siteUrl: "https://example.com",
			feedUrl: "https://example.com/rss.xml",
			items: [
				{
					title: "Old <post>",
					url: "https://example.com/old",
					description: "A & B",
					date: "2026-01-01",
				},
				{
					title: "New",
					url: "https://example.com/new",
					description: "C",
					date: "2026-02-01",
				},
			],
		});
		const xml = await response.text();
		expect(response.headers.get("Content-Type")).toContain("rss+xml");
		expect(xml).toContain("Old &lt;post&gt;");
		expect(xml).toContain("A &amp; B");
		expect(xml.indexOf("example.com/new")).toBeLessThan(
			xml.indexOf("example.com/old"),
		);
	});
});
