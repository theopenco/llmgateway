import { describe, expect, it } from "vitest";

import { getApiKeyLimitStatus } from "./api-key-limit-status";

import type { ApiKey } from "@/lib/types";

const now = new Date("2026-08-22T12:00:00.000Z");

function key(overrides: Partial<ApiKey> = {}): ApiKey {
	return {
		currentPeriodResetAt: null,
		currentPeriodUsage: "0",
		periodUsageDurationUnit: null,
		periodUsageDurationValue: null,
		periodUsageLimit: null,
		usage: "0",
		usageLimit: null,
		...overrides,
	} as ApiKey;
}

describe("getApiKeyLimitStatus", () => {
	it("reports no state when no limit is configured", () => {
		const status = getApiKeyLimitStatus(key({ usage: "42" }), now);

		expect(status).toEqual({ period: null, state: null, total: null });
	});

	it("flags an all-time limit that has been reached", () => {
		const status = getApiKeyLimitStatus(
			key({ usage: "10", usageLimit: "10" }),
			now,
		);

		expect(status.state).toBe("reached");
		expect(status.total).toEqual({
			limit: 10,
			ratio: 1,
			state: "reached",
			usage: 10,
		});
	});

	it("flags an all-time limit that is close to being reached", () => {
		const status = getApiKeyLimitStatus(
			key({ usage: "8", usageLimit: "10" }),
			now,
		);

		expect(status.state).toBe("approaching");
	});

	it("stays ok below the warning ratio", () => {
		const status = getApiKeyLimitStatus(
			key({ usage: "7.99", usageLimit: "10" }),
			now,
		);

		expect(status.state).toBe("ok");
	});

	it("treats a zero limit as reached", () => {
		const status = getApiKeyLimitStatus(
			key({ usage: "0", usageLimit: "0" }),
			now,
		);

		expect(status.total).toMatchObject({ ratio: 1, state: "reached" });
	});

	it("flags a recurring limit that has been reached", () => {
		const status = getApiKeyLimitStatus(
			key({
				currentPeriodResetAt: "2026-08-27T12:00:00.000Z",
				currentPeriodUsage: "5.38",
				periodUsageDurationUnit: "week",
				periodUsageDurationValue: 1,
				periodUsageLimit: "5",
			}),
			now,
		);

		expect(status.state).toBe("reached");
		expect(status.period).toMatchObject({ limit: 5, state: "reached" });
		expect(status.total).toBeNull();
	});

	it("clears a recurring limit once its reset date has passed", () => {
		const status = getApiKeyLimitStatus(
			key({
				currentPeriodResetAt: "2026-08-20T12:00:00.000Z",
				currentPeriodUsage: "5.38",
				periodUsageDurationUnit: "week",
				periodUsageDurationValue: 1,
				periodUsageLimit: "5",
			}),
			now,
		);

		expect(status.state).toBe("ok");
		expect(status.period).toMatchObject({ state: "ok", usage: 0 });
	});

	it("ignores a recurring limit with an incomplete window", () => {
		const status = getApiKeyLimitStatus(
			key({ currentPeriodUsage: "9", periodUsageLimit: "5" }),
			now,
		);

		expect(status).toEqual({ period: null, state: null, total: null });
	});

	it("reports the worst state across both limits", () => {
		const status = getApiKeyLimitStatus(
			key({
				currentPeriodResetAt: "2026-08-27T12:00:00.000Z",
				currentPeriodUsage: "1",
				periodUsageDurationUnit: "week",
				periodUsageDurationValue: 1,
				periodUsageLimit: "5",
				usage: "20",
				usageLimit: "20",
			}),
			now,
		);

		expect(status.period?.state).toBe("ok");
		expect(status.total?.state).toBe("reached");
		expect(status.state).toBe("reached");
	});
});
