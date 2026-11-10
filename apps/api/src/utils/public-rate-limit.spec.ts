import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeRateLimit } from "./public-rate-limit.js";

const mocks = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock("@/auth/config.js", () => ({ redisClient: { eval: mocks.eval } }));
describe("rate limit failure policy", () => {
	beforeEach(() => {
		mocks.eval.mockReset();
	});
	it("preserves fail-open behavior for existing public callers", async () => {
		mocks.eval.mockRejectedValue(new Error("Synthetic outage"));
		expect(await consumeRateLimit("test", 5, 3600)).toBe(true);
	});
	it("rejects an expensive private action on store failure", async () => {
		mocks.eval.mockRejectedValue(new Error("Synthetic outage"));
		await expect(
			consumeRateLimit("test", 5, 3600, { failOpen: false }),
		).rejects.toThrow("Synthetic outage");
	});
});
