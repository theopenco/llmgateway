import { describe, expect, it } from "vitest";

import {
	describeApiKeyUnusedInsight,
	getApiKeyUnusedInsight,
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
