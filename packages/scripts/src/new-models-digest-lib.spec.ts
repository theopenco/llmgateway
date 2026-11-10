import { describe, expect, test } from "vitest";

import {
	buildBroadcastDraft,
	buildDigest,
	buildSubject,
	describeWindow,
	formatContext,
	formatPerMillion,
	fromCatalogue,
	parseChangelogEntry,
	parseUntil,
	readCatalogueList,
	selectChangelog,
	selectNewModels,
	type DigestModelInput,
} from "./new-models-digest-lib.js";

// Ways the weekly issue can go wrong: a model that landed is never announced
// (added after its release date, or between two runs), or is announced twice;
// a model nobody can call or that the site hides gets in; a price or context
// reads wrong; markup in a name breaks the email; an empty week or a failed
// catalogue read still produces an issue; the subject mangles the count; or
// the broadcast is created as anything but a draft.

// A Tuesday. The issue covers the seven UTC days before it: Nov 3 to Nov 9.
const now = new Date("2026-11-10T12:00:00Z");
const providerNames = new Map([
	["alpha", "Alpha Cloud"],
	["beta", "Beta AI"],
]);

function model(overrides: Partial<DigestModelInput>): DigestModelInput {
	return {
		id: "model-a",
		name: "Model A",
		description: "A model.",
		releasedAt: new Date("2026-11-08T00:00:00Z"),
		addedAt: new Date("2026-11-08T09:00:00Z"),
		providers: [
			{
				providerId: "alpha",
				inputPrice: "4e-6",
				outputPrice: "20e-6",
				contextSize: 1_048_576,
			},
		],
		...overrides,
	};
}

function landed(id: string, addedAt: string, releasedAt?: string) {
	return model({
		id,
		addedAt: new Date(addedAt),
		releasedAt: releasedAt ? new Date(releasedAt) : undefined,
	});
}

function ids(models: DigestModelInput[], at: Date, days = 7): string[] {
	return selectNewModels(models, providerNames, at, days).map((m) => m.id);
}

describe("which models make the issue", () => {
	test("covers the whole days before the run, newest first", () => {
		const selected = ids(
			[
				landed("before", "2026-11-02T23:59:59Z"),
				landed("first", "2026-11-03T00:00:00Z"),
				landed("last", "2026-11-09T23:59:59Z"),
				landed("today", "2026-11-10T00:00:00Z"),
				model({ id: "undated", addedAt: undefined, releasedAt: undefined }),
			],
			now,
		);

		expect(selected).toEqual(["last", "first"]);
	});

	test("goes by when a model landed here, not only its release date", () => {
		const selected = ids(
			[
				landed("older-release", "2026-11-05T19:56:00Z", "2026-08-04T00:00:00Z"),
				landed("added-ahead", "2026-10-20T10:00:00Z", "2026-11-06T00:00:00Z"),
				landed("not-out-yet", "2026-11-05T10:00:00Z", "2026-11-12T00:00:00Z"),
				landed("long-here", "2026-09-01T10:00:00Z", "2026-08-30T00:00:00Z"),
			],
			now,
		);

		expect(selected).toEqual(["added-ahead", "older-release"]);
	});

	test("weekly runs announce every model once, whatever time they start", () => {
		const models = [
			landed("monday-early", "2026-11-09T05:39:00Z"),
			landed("monday-late", "2026-11-09T18:19:00Z"),
			landed("sunday", "2026-11-15T23:59:59Z"),
			landed("next-monday", "2026-11-16T00:00:00Z"),
		];

		const first = ids(models, new Date("2026-11-09T07:00:00Z"));
		const second = ids(models, new Date("2026-11-16T07:12:00Z"));
		const third = ids(models, new Date("2026-11-23T23:50:00Z"));

		expect(first).toEqual([]);
		expect(second).toEqual(["sunday", "monday-late", "monday-early"]);
		expect(third).toEqual(["next-monday"]);
		expect(ids(models, new Date("2026-11-16T22:00:00Z"))).toEqual(second);
	});

	test("a late run can cover the week it missed", () => {
		const models = [
			landed("last-week", "2026-11-12T10:00:00Z"),
			landed("this-monday", "2026-11-16T09:00:00Z"),
		];
		const tuesday = new Date("2026-11-17T08:00:00Z");
		const until = new Date("2026-11-16T00:00:00Z");

		expect(ids(models, tuesday)).toEqual(["this-monday", "last-week"]);
		expect(
			selectNewModels(models, providerNames, tuesday, 7, until).map((m) => m.id),
		).toEqual(["last-week"]);
		expect(
			buildDigest({
				models,
				providerNames,
				changelog: [
					{ slug: "a", title: "Late", summary: "s", date: "2026-11-16" },
					{ slug: "b", title: "On time", summary: "s", date: "2026-11-15" },
				],
				now: tuesday,
				days: 7,
				until,
				postalAddress: "1 Example Street",
			})?.changelog.map((entry) => entry.title),
		).toEqual(["On time"]);
	});

	test("the end day must exist and not lie ahead", () => {
		expect(parseUntil(undefined, now)).toBe(now);
		expect(parseUntil("2026-11-09", now)).toEqual(
			new Date("2026-11-09T00:00:00Z"),
		);
		for (const value of ["2026-02-30", "16/11/2026", "2026-11-9", "soon"]) {
			expect(() => parseUntil(value, now)).toThrow(
				"--until must be a real date like 2026-11-16",
			);
		}
		expect(() => parseUntil("2026-11-11", now)).toThrow(
			"--until cannot be in the future",
		);
		expect(describeWindow(now, 7)).toBe("2026-11-03 to 2026-11-09 (UTC)");
		expect(describeWindow(new Date("2026-03-02T00:00:00Z"), 2)).toBe(
			"2026-02-28 to 2026-03-01 (UTC)",
		);
	});

	test("a longer window reaches further back", () => {
		const models = [landed("two-weeks-ago", "2026-10-28T10:00:00Z")];

		expect(ids(models, now)).toEqual([]);
		expect(ids(models, now, 14)).toEqual(["two-weeks-ago"]);
	});

	test("drops a model whose every provider is deactivated", () => {
		const selected = selectNewModels(
			[
				model({
					id: "gone",
					providers: [
						{
							providerId: "alpha",
							deactivatedAt: new Date("2026-11-09T00:00:00Z"),
						},
					],
				}),
				model({
					id: "half",
					providers: [
						{
							providerId: "alpha",
							inputPrice: "1e-6",
							outputPrice: "2e-6",
							deactivatedAt: new Date("2026-11-09T00:00:00Z"),
						},
						{ providerId: "beta", inputPrice: "3e-6", outputPrice: "9e-6" },
					],
				}),
			],
			providerNames,
			now,
			7,
		);

		expect(selected.map((m) => m.id)).toEqual(["half"]);
		expect(selected[0].providers).toEqual(["Beta AI"]);
		expect(selected[0].price).toBe("from $3 in / $9 out per 1M tokens");
	});

	test("quotes the cheapest active provider and the largest context", () => {
		const [selected] = selectNewModels(
			[
				model({
					providers: [
						{
							providerId: "alpha",
							inputPrice: "4e-6",
							outputPrice: "20e-6",
							contextSize: 200_000,
						},
						{
							providerId: "beta",
							inputPrice: "0.2e-6",
							outputPrice: "0.075e-6",
							contextSize: 1_048_576,
						},
					],
				}),
			],
			providerNames,
			now,
			7,
		);

		expect(selected.providers).toEqual(["Alpha Cloud", "Beta AI"]);
		expect(selected.price).toBe("from $0.20 in / $0.075 out per 1M tokens");
		expect(selected.context).toBe("1M context");
	});

	test("leaves the price out for a model without token prices", () => {
		const [unpriced, zeroOutput] = selectNewModels(
			[
				model({ id: "a", name: "A", providers: [{ providerId: "alpha" }] }),
				model({
					id: "b",
					name: "B",
					providers: [
						{ providerId: "alpha", inputPrice: "5e-6", outputPrice: "0" },
					],
				}),
			],
			providerNames,
			now,
			7,
		);

		expect(unpriced.price).toBeNull();
		expect(unpriced.context).toBeNull();
		expect(zeroOutput.price).toBeNull();
	});
});

describe("the live catalogue", () => {
	const mapping = {
		providerId: "alpha",
		inputPrice: "4e-6",
		outputPrice: "20e-6",
		contextSize: 200_000,
		deactivatedAt: null,
		status: "active" as const,
	};
	const listed = {
		id: "listed",
		name: "Listed",
		description: null,
		createdAt: "2026-11-08T09:00:00.000Z",
		releasedAt: "2026-04-02T00:00:00.000Z",
		status: "active" as const,
		mappings: [mapping],
	};

	test("is read the way the site shows it", () => {
		const selected = selectNewModels(
			fromCatalogue([
				listed,
				{ ...listed, id: "inactive-model", status: "inactive" },
				{
					...listed,
					id: "inactive-mapping",
					mappings: [{ ...mapping, status: "inactive" }],
				},
				{ ...listed, id: "paused-listing", unlistedProviderIds: ["alpha"] },
				{
					...listed,
					id: "one-listing-paused",
					unlistedProviderIds: ["alpha"],
					mappings: [mapping, { ...mapping, providerId: "beta" }],
				},
				{ ...listed, id: "added-long-ago", createdAt: "2026-04-03T10:00:00Z" },
			]),
			providerNames,
			now,
			7,
		);

		expect(selected.map((m) => [m.id, m.providers])).toEqual([
			["listed", ["Alpha Cloud"]],
			["one-listing-paused", ["Beta AI"]],
		]);
		expect(selected[0].price).toBe("from $4 in / $20 out per 1M tokens");
		expect(selected[0].description).toBe("");
	});

	test("an empty or malformed read is an error, not a quiet week", () => {
		expect(readCatalogueList({ models: [listed] }, "models")).toEqual([listed]);
		for (const body of [{ models: [] }, { providers: [listed] }, {}, null]) {
			expect(() => readCatalogueList(body, "models")).toThrow(
				"The API returned no models",
			);
		}
	});
});

test("prices and context sizes read the way the site prints them", () => {
	expect(formatPerMillion("4e-6")).toBe("$4");
	expect(formatPerMillion("1.25e-6")).toBe("$1.25");
	expect(formatPerMillion("0.2e-6")).toBe("$0.20");
	expect(formatPerMillion("0.075e-6")).toBe("$0.075");
	expect(formatPerMillion("0.0375e-6")).toBe("$0.0375");
	expect(formatPerMillion("1e-10")).toBe("$0.0001");
	expect(formatContext(1_048_576)).toBe("1M context");
	expect(formatContext(2_000_000)).toBe("2M context");
	expect(formatContext(200_000)).toBe("200K context");
});

test("the subject names up to two models and counts the rest", () => {
	const [a, b, c, d] = ["A", "B", "C", "D"].map(
		(name) =>
			selectNewModels(
				[model({ id: name, name })],
				providerNames,
				now,
				7,
			)[0],
	);

	expect(buildSubject([a])).toBe("New on LLM Gateway: A");
	expect(buildSubject([a, b])).toBe("New on LLM Gateway: A and B");
	expect(buildSubject([a, b, c, d])).toBe(
		"New on LLM Gateway: A, B and 2 more",
	);
});

describe("changelog entries", () => {
	test("follow the same days and skip drafts", () => {
		const entry = (slug: string, date: string, draft = false) => ({
			slug,
			title: slug,
			summary: "s",
			date,
			draft,
		});

		const entries = selectChangelog(
			[
				entry("before", "2026-11-02"),
				entry("first-day", "2026-11-03"),
				entry("last-day", "2026-11-09"),
				entry("draft", "2026-11-06", true),
				entry("today", "2026-11-10"),
			],
			now,
			7,
		);

		expect(entries.map((e) => e.title)).toEqual(["last-day", "first-day"]);
		expect(entries[0].url).toContain("/changelog/last-day?utm_source=");
	});

	test("are read from the file's frontmatter", () => {
		const source = [
			"---",
			'id: "9"',
			'slug: "batch-api"',
			'date: "2026-11-09"',
			'title: "Batch API: now \\"live\\""',
			'summary: "Upload a file, get results."',
			"draft: true",
			"---",
			"",
			'title: "not the frontmatter"',
		].join("\n");

		expect(parseChangelogEntry(source, "a.md")).toEqual({
			slug: "batch-api",
			date: "2026-11-09",
			title: 'Batch API: now "live"',
			summary: "Upload a file, get results.",
			draft: true,
		});
		expect(
			parseChangelogEntry(source.replace("draft: true\n", ""), "a.md").draft,
		).toBe(false);
		expect(() =>
			parseChangelogEntry(source.replace(/^summary:.*\n/m, ""), "a.md"),
		).toThrow("Changelog entry a.md is missing frontmatter");
	});
});

describe("the issue", () => {
	const input = {
		providerNames,
		changelog: [],
		now,
		days: 7,
		postalAddress: "1 Example Street",
	};

	test("an empty week produces no issue", () => {
		expect(
			buildDigest({
				...input,
				models: [landed("old", "2026-10-01T00:00:00Z")],
			}),
		).toBeNull();
	});

	test("says which period it covers", () => {
		const models = [model({})];

		expect(buildDigest({ ...input, models })?.text).toContain(
			"One new model landed on LLM Gateway in the past week.",
		);
		expect(
			buildDigest({
				...input,
				days: 14,
				models: [...models, model({ id: "b" })],
			})?.text,
		).toContain("2 new models landed on LLM Gateway in the past 14 days.");
	});

	test("escapes markup and carries the unsubscribe link and address", () => {
		const digest = buildDigest({
			...input,
			models: [
				model({
					id: "x/y z",
					name: 'Model <b>"X"</b>',
					description: "Fast & cheap <script>alert(1)</script>",
				}),
			],
		});

		expect(digest?.html).toContain("Model &lt;b&gt;&quot;X&quot;&lt;/b&gt;");
		expect(digest?.html).toContain("Fast &amp; cheap &lt;script&gt;");
		expect(digest?.html).not.toContain("<script>");
		expect(digest?.html).toContain("/models/x%2Fy%20z?utm_source=newsletter");
		for (const body of [digest?.html, digest?.text]) {
			expect(body).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
			expect(body).toContain("1 Example Street");
		}
	});

	test("is saved as a draft for one segment and topic", () => {
		const digest = buildDigest({ ...input, models: [model({})] });
		if (!digest) {
			throw new Error("expected an issue");
		}

		const draft = buildBroadcastDraft(digest, {
			segmentId: "segment-1",
			topicId: "topic-1",
		});

		expect(Object.keys(draft).sort()).toEqual([
			"from",
			"html",
			"name",
			"preview_text",
			"reply_to",
			"segment_id",
			"subject",
			"text",
			"topic_id",
		]);
		expect(draft).toMatchObject({
			segment_id: "segment-1",
			topic_id: "topic-1",
			subject: "New on LLM Gateway: Model A",
		});
	});
});
