import { describe, expect, test } from "vitest";

import {
	buildDigest,
	buildSubject,
	formatContext,
	formatPerMillion,
	fromCatalogue,
	selectChangelog,
	selectNewModels,
	type DigestModelInput,
} from "./new-models-digest-lib.js";

// Ways the weekly issue can go wrong: a release outside the window or dated in
// the future gets in, a model nobody can call gets in, a price or context
// reads wrong, markup in a name breaks the email, an empty week still produces
// an issue, the subject mangles the count, or a model the site hides (inactive,
// or a paused provider listing) is announced.

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

describe("which models make the issue", () => {
	test("keeps releases inside the window, newest first", () => {
		const selected = selectNewModels(
			[
				model({ id: "old", releasedAt: new Date("2026-11-03T12:00:00Z") }),
				model({ id: "edge", releasedAt: new Date("2026-11-03T12:00:01Z") }),
				model({ id: "new", releasedAt: new Date("2026-11-09T00:00:00Z") }),
				model({ id: "future", releasedAt: new Date("2026-11-11T00:00:00Z") }),
				model({ id: "undated", releasedAt: undefined }),
			],
			providerNames,
			now,
			7,
		);

		expect(selected.map((m) => m.id)).toEqual(["new", "edge"]);
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

test("the live catalogue is read the way the site shows it", () => {
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
		releasedAt: "2026-11-08T00:00:00.000Z",
		status: "active" as const,
		mappings: [mapping],
	};

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
			{ ...listed, id: "undated", releasedAt: null },
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

test("prices and context sizes read the way the site prints them", () => {
	expect(formatPerMillion("4e-6")).toBe("$4");
	expect(formatPerMillion("1.25e-6")).toBe("$1.25");
	expect(formatPerMillion("0.2e-6")).toBe("$0.20");
	expect(formatPerMillion("0.075e-6")).toBe("$0.075");
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

test("changelog entries follow the same window and skip drafts", () => {
	const entries = selectChangelog(
		[
			{ slug: "old", title: "Old", summary: "s", date: "2026-11-03" },
			{ slug: "kept", title: "Kept", summary: "s", date: "2026-11-05" },
			{
				slug: "draft",
				title: "Draft",
				summary: "s",
				date: "2026-11-06",
				draft: true,
			},
			{ slug: "future", title: "Future", summary: "s", date: "2026-11-12" },
		],
		now,
		7,
	);

	expect(entries.map((entry) => entry.title)).toEqual(["Kept"]);
	expect(entries[0].url).toContain("/changelog/kept?utm_source=newsletter");
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
				models: [model({ releasedAt: new Date("2026-10-01T00:00:00Z") })],
			}),
		).toBeNull();
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
});
