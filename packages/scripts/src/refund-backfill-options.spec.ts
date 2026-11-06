import { describe, expect, it } from "vitest";

import { parseRefundBackfillOptions } from "./refund-backfill-options.js";

describe("refund backfill options", () => {
	it("defaults to a dry run", () => {
		expect(parseRefundBackfillOptions([])).toMatchObject({
			commit: false,
			scopeOrg: undefined,
			limit: undefined,
		});
	});
	it("accepts an explicit scoped commit", () => {
		expect(
			parseRefundBackfillOptions([
				"--commit",
				"--org=test-org",
				"--limit=50",
				"--json",
				"--out=report.json",
			]),
		).toEqual({
			commit: true,
			asJson: true,
			scopeOrg: "test-org",
			limit: 50,
			outPath: "report.json",
		});
	});
	it.each([
		["--org"],
		["--org="],
		["--org= "],
		["--org", "test-org"],
		["--org=a", "--org=b"],
		["--limit"],
		["--limit="],
		["--limit=0"],
		["--limit=-1"],
		["--limit=1.5"],
		["--limit=50rows"],
		["--limit=Infinity"],
		["--limit=9007199254740992"],
		["--out="],
		["--comit"],
		["--commit=false"],
	])("rejects unsafe arguments %j", (...args) => {
		expect(() => parseRefundBackfillOptions(args)).toThrow();
	});
});
