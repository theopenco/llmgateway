import { describe, expect, it } from "vitest";

import { nextMemberSort, sortMembers } from "./member-sort";

import type { SortableMember, SortableMemberUsage } from "./member-sort";

function member(
	userId: string,
	name: string | null,
	role: string,
	team: string | null = null,
): SortableMember {
	return {
		userId,
		role,
		user: { name, email: `${userId}@example.com` },
		team: team ? { name: team } : null,
	};
}

function usage(cost: number, requestCount = 0): SortableMemberUsage {
	return { cost, totalTokens: 0, requestCount, apiKeyCount: 0 };
}

const members = [
	member("a", "bob", "developer", "Platform"),
	member("b", null, "owner"),
	member("c", "Alice", "admin", "Data"),
];

const usageByUserId = new Map([
	["a", usage(5, 10)],
	["c", usage(12.5, 3)],
]);

const ids = (list: SortableMember[]) => list.map((m) => m.userId);

describe("nextMemberSort", () => {
	it("starts usage columns descending and text columns ascending", () => {
		expect(nextMemberSort(null, "cost")).toEqual({
			column: "cost",
			direction: "desc",
		});
		expect(nextMemberSort(null, "name")).toEqual({
			column: "name",
			direction: "asc",
		});
	});

	it("toggles the direction when the same column is clicked again", () => {
		expect(
			nextMemberSort({ column: "cost", direction: "desc" }, "cost"),
		).toEqual({ column: "cost", direction: "asc" });
	});

	it("resets the direction when switching columns", () => {
		expect(
			nextMemberSort({ column: "cost", direction: "asc" }, "requestCount"),
		).toEqual({ column: "requestCount", direction: "desc" });
	});
});

describe("sortMembers", () => {
	it("keeps the original order without a sort", () => {
		expect(ids(sortMembers(members, null, usageByUserId))).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("sorts by cost, treating members without usage as zero", () => {
		expect(
			ids(
				sortMembers(
					members,
					{ column: "cost", direction: "desc" },
					usageByUserId,
				),
			),
		).toEqual(["c", "a", "b"]);
		expect(
			ids(
				sortMembers(
					members,
					{ column: "cost", direction: "asc" },
					usageByUserId,
				),
			),
		).toEqual(["b", "a", "c"]);
	});

	it("sorts names case-insensitively with missing names last", () => {
		expect(
			ids(
				sortMembers(
					members,
					{ column: "name", direction: "asc" },
					usageByUserId,
				),
			),
		).toEqual(["c", "a", "b"]);
		expect(
			ids(
				sortMembers(
					members,
					{ column: "name", direction: "desc" },
					usageByUserId,
				),
			),
		).toEqual(["a", "c", "b"]);
	});

	it("sorts roles by rank", () => {
		expect(
			ids(
				sortMembers(
					members,
					{ column: "role", direction: "asc" },
					usageByUserId,
				),
			),
		).toEqual(["b", "c", "a"]);
	});

	it("sorts teams with members without a team last", () => {
		expect(
			ids(
				sortMembers(
					members,
					{ column: "team", direction: "desc" },
					usageByUserId,
				),
			),
		).toEqual(["a", "c", "b"]);
	});
});
