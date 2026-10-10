import { citationSources, mergeSources, readSources } from "@/api/sources";

test("restores web citations and merges repeated streaming annotations by URL", () => {
	const source = {
		type: "source-url",
		sourceId: "citation-1",
		url: "https://example.com/guide",
		title: "Guide",
	};
	const saved = readSources(JSON.stringify([source]));
	const incoming = citationSources([
		{
			type: "url_citation",
			url_citation: {
				url: source.url,
				title: "Updated guide",
				start_index: 0,
				end_index: 4,
			},
		},
	]);
	expect(mergeSources(saved, incoming)).toEqual([
		{
			type: "source-url",
			sourceId: source.url,
			url: source.url,
			title: "Updated guide",
		},
	]);
});

test("does not interpret unrelated annotations as source links", () => {
	expect(citationSources([{ type: "file_citation", file_id: "file" }])).toEqual(
		[],
	);
	expect(citationSources(undefined)).toEqual([]);
});

test("reports malformed saved citations", () => {
	expect(() => readSources("broken")).toThrow();
	expect(() => readSources('[{"type":"source-url"}]')).toThrow();
});
