import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
	centsToDollars,
	parseBackfillArgs,
	refundDescription,
} from "./devpass-refund-backfill.js";

describe("refund backfill exact money", () => {
	it.each([
		[1, "0.01"],
		[101, "1.01"],
		[2020, "20.2"],
		[99999999, "999999.99"],
	])("converts %s minor units exactly", (cents, dollars) => {
		expect(centsToDollars(Number(cents)).toString()).toBe(dollars);
	});
	it("formats an exact partial-refund ratio", () => {
		expect(refundDescription(new Decimal("1.01"), new Decimal("20.2"))).toBe(
			"Credit refund: $1.01 (5.0% of original purchase) [backfilled]",
		);
	});
});

describe("strict backfill arguments", () => {
	it("defaults to dry-run and preserves explicit scopes", () => {
		expect(parseBackfillArgs([])).toEqual({ commit: false });
		expect(
			parseBackfillArgs([
				"--commit",
				"--org=fixture-org",
				"--payment-intent=pi_fixture",
			]),
		).toEqual({
			commit: true,
			org: "fixture-org",
			"payment-intent": "pi_fixture",
		});
	});
	it.each(
		[
			["--commmit"],
			["--commit", "--org="],
			["--org"],
			["--org=a", "--org=b"],
			["--payment-intent="],
			["--commit=true"],
			["unexpected"],
			["--org=   "],
			["--commit", "--commit"],
		].map((args) => ({ args })),
	)("rejects $args", ({ args }) => {
		expect(() => parseBackfillArgs(args)).toThrow();
	});
});
