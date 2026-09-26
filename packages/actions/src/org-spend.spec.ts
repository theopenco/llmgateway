import { afterEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { spendDailyKey, spendMonthlyKey } from "@llmgateway/shared";

import { adjustOrgSpend, recordOrgSpend } from "./org-spend.js";

const keys = new Set<string>();
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (keys.size) {
		await redisClient.del(...keys);
	}
	keys.clear();
});

describe("video spend settlement", () => {
	it.each([0, 3, 8])(
		"moves a reservation across midnight and month end, settling %s",
		async (actual) => {
			vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "true");
			const id = `video-spend-${crypto.randomUUID()}`;
			const createdAt = new Date("2026-08-31T23:59:59Z");
			const now = new Date("2026-09-01T00:00:01Z").getTime();
			vi.spyOn(Date, "now").mockReturnValue(now);
			await recordOrgSpend(id, 5, createdAt.getTime());
			await recordOrgSpend(id, 2, now);
			await adjustOrgSpend(id, actual - 5, { amount: 5, createdAt });
			for (const keyFor of [spendDailyKey, spendMonthlyKey]) {
				const previous = keyFor(id, createdAt.getTime());
				const current = keyFor(id, now);
				keys.add(previous);
				keys.add(current);
				expect(Number(await redisClient.get(previous))).toBe(0);
				expect(Number(await redisClient.get(current))).toBe(2 + actual);
				expect(await redisClient.ttl(current)).toBeGreaterThan(0);
			}
		},
	);
});
