import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { DEV_PLAN_PRICES } from "@llmgateway/shared";

import type { ComponentType } from "react";

// The DevPass terms render their plan figures from the shared billing
// constants. Changing any of these values changes a legal document: update
// the terms (and their "Last Updated" date), the comparison content in
// src/content/comparisons, and this spec together.
const PINNED_LAST_UPDATED = "November 10, 2026";
const PINNED_ROWS: Record<string, string[]> = {
	"Standard monthly allowance (provider-rate usage)": ["$58", "$158", "$358"],
	"Maximum carry-over at renewal (50%)": ["$29", "$79", "$179"],
	"Daily cap across all models (rolling 24 hours)": ["8%", "9%", "10%"],
	"Premium weekly cap": ["10%", "12%", "15%"],
	"Price per Reset Pass": ["$5", "$15", "$45"],
	"Included Reset Passes per billing cycle": ["0", "0", "2"],
};

const originalMultiplier = process.env.DEV_PLAN_CREDITS_MULTIPLIER;
let TermsPage: ComponentType;

beforeAll(async () => {
	vi.stubGlobal("React", React);
	delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
	TermsPage = (await import("./page")).default;
});

afterAll(() => {
	vi.unstubAllGlobals();
	if (originalMultiplier === undefined) {
		delete process.env.DEV_PLAN_CREDITS_MULTIPLIER;
	} else {
		process.env.DEV_PLAN_CREDITS_MULTIPLIER = originalMultiplier;
	}
});

function decode(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

function renderedRows(html: string): Record<string, string[]> {
	const rows: Record<string, string[]> = {};
	const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
	for (const row of tbody.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
		const label = row.match(/<th scope="row">([\s\S]*?)<\/th>/)?.[1] ?? "";
		const values = (row.match(/<td>[\s\S]*?<\/td>/g) ?? []).map(decode);
		rows[decode(label)] = values;
	}
	return rows;
}

describe("DevPass supplemental terms", () => {
	const html = () => renderToStaticMarkup(createElement(TermsPage));

	test("plan prices match the published legal and comparison copy", () => {
		expect(DEV_PLAN_PRICES).toEqual({ lite: 29, pro: 79, max: 179 });
	});

	test("allowance table renders the pinned legal values", () => {
		expect(renderedRows(html())).toEqual(PINNED_ROWS);
	});

	test("refund terms render the pinned window and usage limit", () => {
		const text = decode(html());
		expect(text).toContain(`Last Updated: ${PINNED_LAST_UPDATED}`);
		expect(text).toContain(
			"from your billing dashboard within 14 days of purchase and have used less than 10% of the monthly allowance",
		);
		expect(text).toContain(
			"Usage must remain below 10%; usage at or above 10% is ineligible.",
		);
		expect(text).toContain(
			"unused allowance carries into the next cycle, up to 50% of the plan’s monthly allowance at renewal",
		);
		expect(text).toContain(
			"an eligible payment may be refunded within 14 days as goodwill while usage remains below 10% of the monthly allowance",
		);
	});
});
