import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	afterEach,
	describe,
	expect,
	test,
	vi,
	beforeAll,
	afterAll,
} from "vitest";

import UsageSummaryCard from "./UsageSummaryCard";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

vi.mock("@llmgateway/shared", () => ({
	useDisplayTimeZone: () => ({ timeZone: "UTC" }),
	formatDateTime: (date: string) => date,
}));

const props = {
	planName: "PRO",
	creditsUsed: 100,
	creditsLimit: 237,
	dailyCreditsUsed: 21.33,
	dailyLimit: 21.33,
	dayResetsAt: "2030-01-02T12:00:00.000Z",
	paygEnabled: true,
	regularCredits: 10,
};

afterEach(() => vi.useRealTimers());

describe("dashboard daily cap", () => {
	test("explains PAYG billing before the monthly or weekly allowance runs out", () => {
		const html = renderToStaticMarkup(createElement(UsageSummaryCard, props));
		expect(html).toContain("Daily usage cap reached");
		expect(html).toContain(
			"Requests are now billed to your pay-as-you-go credits",
		);
		expect(html).toContain(
			"does not increase your monthly or weekly premium usage meters",
		);
		expect(html).toContain(props.dayResetsAt);
	});

	test("asks for a top-up when overflow cannot cover the daily cap", () => {
		const html = renderToStaticMarkup(
			createElement(UsageSummaryCard, { ...props, regularCredits: 0 }),
		);
		expect(html).toContain("Daily usage cap reached");
		expect(html).toContain("pay-as-you-go credits balance is empty");
		expect(html).toContain("Top up credits");
	});

	test("offers enabling overflow when it is disabled", () => {
		const html = renderToStaticMarkup(
			createElement(UsageSummaryCard, { ...props, paygEnabled: false }),
		);
		expect(html).toContain("Daily usage cap reached");
		expect(html).toContain("Enable pay-as-you-go overflow");
	});

	test("shows the daily allowance without an exhausted alert below the cap", () => {
		const html = renderToStaticMarkup(
			createElement(UsageSummaryCard, { ...props, dailyCreditsUsed: 10 }),
		);
		expect(html).toContain("Daily usage cap");
		expect(html).not.toContain("Daily usage cap reached");
	});

	test("does not show an exhausted alert after the daily window expires", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2030-01-02T12:00:01.000Z"));
		const html = renderToStaticMarkup(createElement(UsageSummaryCard, props));
		expect(html).not.toContain("Daily usage cap reached");
	});
});
