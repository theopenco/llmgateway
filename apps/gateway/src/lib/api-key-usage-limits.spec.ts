import { describe, expect, it } from "vitest";

import { assertApiKeyWithinUsageLimits } from "./api-key-usage-limits.js";

const baseApiKey = {
	id: "key-1",
	createdAt: new Date("2026-03-29T00:00:00.000Z"),
	updatedAt: new Date("2026-03-29T00:00:00.000Z"),
	token: "token",
	description: "Test key",
	status: "active" as const,
	usageLimit: null,
	usage: "0",
	periodUsageLimit: null,
	periodUsageDurationValue: null,
	periodUsageDurationUnit: null,
	currentPeriodUsage: "0",
	currentPeriodStartedAt: null,
	projectId: "project-1",
	createdBy: "user-1",
};

describe("assertApiKeyWithinUsageLimits", () => {
	it("allows keys without any configured limits", () => {
		expect(() => assertApiKeyWithinUsageLimits(baseApiKey)).not.toThrow();
	});

	it("blocks when the lifetime usage limit is reached", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits({
				...baseApiKey,
				usageLimit: "5",
				usage: "5",
			}),
		).toThrowError(/reached its usage limit/);
	});

	it("blocks when the current period usage limit is reached", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					periodUsageLimit: "3",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
					currentPeriodUsage: "3",
					currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T12:00:00.000Z"),
			),
		).toThrowError(/current period usage limit/);
	});

	it("treats expired periods as reset", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					periodUsageLimit: "3",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "hour",
					currentPeriodUsage: "3",
					currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T10:00:00.000Z"),
			),
		).not.toThrow();
	});
});
