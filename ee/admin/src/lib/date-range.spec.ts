import { format, startOfWeek, subDays } from "date-fns";
import { describe, expect, test } from "vitest";

import {
	ALL_TIME_RANGE,
	ORGANIZATIONS_DEFAULT_RANGE,
	resolveDateRange,
} from "./date-range";

const day = (date: Date) => format(date, "yyyy-MM-dd");

describe("resolveDateRange", () => {
	test("treats an empty query as all time when no default is given", () => {
		expect(resolveDateRange({})).toEqual({});
	});

	test("falls back to the page default when the query is empty", () => {
		const resolved = resolveDateRange({}, ORGANIZATIONS_DEFAULT_RANGE);
		const today = new Date();
		expect(resolved).toEqual({
			from: day(startOfWeek(today, { weekStartsOn: 1 })),
			to: day(today),
		});
	});

	test("lets an explicit all_time override the default", () => {
		expect(
			resolveDateRange({ range: ALL_TIME_RANGE }, ORGANIZATIONS_DEFAULT_RANGE),
		).toEqual({});
	});

	test("lets an explicit preset override the default", () => {
		const resolved = resolveDateRange(
			{ range: "last_90_days" },
			ORGANIZATIONS_DEFAULT_RANGE,
		);
		const today = new Date();
		expect(resolved).toEqual({
			from: day(subDays(today, 89)),
			to: day(today),
		});
	});

	test("lets a custom span override the default", () => {
		expect(
			resolveDateRange(
				{ from: "2026-01-01", to: "2026-01-31" },
				ORGANIZATIONS_DEFAULT_RANGE,
			),
		).toEqual({ from: "2026-01-01", to: "2026-01-31" });
	});

	test("ignores a half-open custom span and uses the default", () => {
		const resolved = resolveDateRange(
			{ from: "2026-01-01" },
			ORGANIZATIONS_DEFAULT_RANGE,
		);
		const today = new Date();
		expect(resolved).toEqual({
			from: day(startOfWeek(today, { weekStartsOn: 1 })),
			to: day(today),
		});
	});

	test("falls back to all time when the default is not a known preset", () => {
		expect(resolveDateRange({}, "not_a_preset")).toEqual({});
	});
});
