import { describe, expect, it } from "vitest";

import {
	describeApiKeyUnusedInsight,
	formatApiKeyLimitSuggestion,
	getApiKeyLimitSuggestion,
	getApiKeyUnusedInsight,
	recurringLimitDiffersFrom,
} from "./api-key-insights";

const now = new Date("2026-06-01T12:00:00Z");
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => {
	const offsetMs = days * DAY_MS;
	return new Date(now.getTime() - offsetMs).toISOString();
};

const activeKey = (overrides: {
	createdAt?: string;
	lastUsedAt?: string | null;
	status?: "active" | "inactive" | "deleted";
	kind?: "regular" | "playground";
}) => ({
	status: "active" as const,
	kind: "regular" as const,
	createdAt: daysAgo(365),
	lastUsedAt: null,
	...overrides,
});

describe("getApiKeyUnusedInsight", () => {
	it("ignores keys used within the warning window", () => {
		expect(
			getApiKeyUnusedInsight(activeKey({ lastUsedAt: daysAgo(29) }), now),
		).toBeNull();
	});

	it("warns at 30 days and turns critical at 90", () => {
		expect(
			getApiKeyUnusedInsight(activeKey({ lastUsedAt: daysAgo(30) }), now),
		).toEqual({ level: "warning", daysUnused: 30, neverUsed: false });
		expect(
			getApiKeyUnusedInsight(activeKey({ lastUsedAt: daysAgo(90) }), now),
		).toEqual({ level: "critical", daysUnused: 90, neverUsed: false });
	});

	it("counts never-used keys from creation", () => {
		expect(
			getApiKeyUnusedInsight(activeKey({ createdAt: daysAgo(10) }), now),
		).toBeNull();
		expect(
			getApiKeyUnusedInsight(activeKey({ createdAt: daysAgo(45) }), now),
		).toEqual({ level: "warning", daysUnused: 45, neverUsed: true });
	});

	it("skips inactive and playground keys", () => {
		expect(
			getApiKeyUnusedInsight(activeKey({ status: "inactive" }), now),
		).toBeNull();
		expect(
			getApiKeyUnusedInsight(activeKey({ kind: "playground" }), now),
		).toBeNull();
	});
});

describe("describeApiKeyUnusedInsight", () => {
	it("words warnings and critical insights differently", () => {
		expect(
			describeApiKeyUnusedInsight({
				level: "warning",
				daysUnused: 31,
				neverUsed: false,
			}),
		).toBe("Not used in the last 31 days. Consider deactivating it.");
		expect(
			describeApiKeyUnusedInsight({
				level: "critical",
				daysUnused: 120,
				neverUsed: true,
			}),
		).toBe(
			"Never used since it was created 120 days ago. Deactivate it unless you still need it.",
		);
	});
});

const uncappedKey = (overrides: {
	usage?: string;
	usageLimit?: string | null;
	periodUsageLimit?: string | null;
	status?: "active" | "inactive" | "deleted";
	kind?: "regular" | "playground";
	expiresAt?: string | null;
	ownerBudget?: {
		usageLimit: string | null;
		periodUsageLimit: string | null;
	} | null;
}) => ({
	status: "active" as const,
	kind: "regular" as const,
	usage: "0",
	usageLimit: null,
	periodUsageLimit: null,
	ownerBudget: null,
	...overrides,
});

const suggestionFor = (usage: string) => {
	const suggestion = getApiKeyLimitSuggestion(uncappedKey({ usage }));
	return suggestion ? formatApiKeyLimitSuggestion(suggestion) : null;
};

describe("getApiKeyLimitSuggestion", () => {
	it("scales the suggested cap with all-time spend", () => {
		expect(suggestionFor("0")).toBe("$10/week");
		expect(suggestionFor("0.42")).toBe("$10/week");
		expect(suggestionFor("1")).toBe("$25/week");
		expect(suggestionFor("9.99")).toBe("$25/week");
		expect(suggestionFor("10")).toBe("$100/week");
		expect(suggestionFor("49.99")).toBe("$100/week");
		expect(suggestionFor("50")).toBe("$500/month");
		expect(suggestionFor("249.99")).toBe("$500/month");
	});

	it("leaves high-spend keys alone", () => {
		expect(suggestionFor("250")).toBeNull();
	});

	it("skips keys that already have a cap", () => {
		expect(
			getApiKeyLimitSuggestion(uncappedKey({ usageLimit: "100" })),
		).toBeNull();
		expect(
			getApiKeyLimitSuggestion(uncappedKey({ periodUsageLimit: "5" })),
		).toBeNull();
		expect(
			getApiKeyLimitSuggestion(
				uncappedKey({
					ownerBudget: { usageLimit: null, periodUsageLimit: "50" },
				}),
			),
		).toBeNull();
		expect(
			getApiKeyLimitSuggestion(
				uncappedKey({
					ownerBudget: { usageLimit: "100", periodUsageLimit: null },
				}),
			),
		).toBeNull();
	});

	it("suggests a cap when the owner budget sets none", () => {
		expect(
			getApiKeyLimitSuggestion(
				uncappedKey({
					ownerBudget: { usageLimit: null, periodUsageLimit: null },
				}),
			),
		).not.toBeNull();
	});

	it("skips inactive and playground keys", () => {
		expect(
			getApiKeyLimitSuggestion(uncappedKey({ status: "inactive" })),
		).toBeNull();
		expect(
			getApiKeyLimitSuggestion(uncappedKey({ kind: "playground" })),
		).toBeNull();
	});
});

describe("getApiKeyLimitSuggestion edge cases", () => {
	it("skips keys whose expiration has passed", () => {
		expect(
			getApiKeyLimitSuggestion(uncappedKey({ expiresAt: daysAgo(1) }), now),
		).toBeNull();
		expect(
			getApiKeyLimitSuggestion(
				uncappedKey({
					expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
				}),
				now,
			),
		).not.toBeNull();
	});

	it("skips non-numeric usage", () => {
		expect(getApiKeyLimitSuggestion(uncappedKey({ usage: "abc" }))).toBeNull();
	});
});

describe("recurringLimitDiffersFrom", () => {
	const suggestion = {
		periodUsageLimit: "10",
		periodUsageDurationValue: 1,
		periodUsageDurationUnit: "week" as const,
	};
	const limit = (
		periodUsageLimit: string | null,
		periodUsageDurationUnit: "day" | "week" | null = "week",
	) => ({
		periodUsageLimit,
		periodUsageDurationValue: periodUsageLimit === null ? null : 1,
		periodUsageDurationUnit:
			periodUsageLimit === null ? null : periodUsageDurationUnit,
	});

	it("treats the applied suggestion or a pending refetch as unchanged", () => {
		expect(recurringLimitDiffersFrom(limit("10.00"), suggestion)).toBe(false);
		expect(recurringLimitDiffersFrom(limit(null), suggestion)).toBe(false);
	});

	it("detects a limit saved after the suggestion", () => {
		expect(recurringLimitDiffersFrom(limit("40"), suggestion)).toBe(true);
		expect(recurringLimitDiffersFrom(limit("10", "day"), suggestion)).toBe(
			true,
		);
	});
});
