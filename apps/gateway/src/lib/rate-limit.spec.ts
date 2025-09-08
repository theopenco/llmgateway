import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkFreeModelRateLimit, isFreeModel } from "./rate-limit";

// Mock dependencies
vi.mock("./cache", () => ({
	getOrganization: vi.fn(),
}));

vi.mock("./redis", () => ({
	default: {
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrange: vi.fn(),
		zadd: vi.fn(),
		expire: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

const mockRedis = await import("./redis");
const mockCache = await import("./cache");
const redis = mockRedis.default;

describe("Rate Limiting", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("isFreeModel", () => {
		it("should return true for free models", () => {
			const freeModel = { free: true };
			expect(isFreeModel(freeModel)).toBe(true);
		});

		it("should return false for non-free models", () => {
			const paidModel = { free: false };
			expect(isFreeModel(paidModel)).toBe(false);
		});

		it("should return false for models without free property", () => {
			const model = {};
			expect(isFreeModel(model)).toBe(false);
		});
	});

	describe("checkFreeModelRateLimit", () => {
		const organizationId = "test-org-id";
		const model = "test-model";

		it("should allow non-free models without rate limiting", async () => {
			const modelDefinition = { free: false };

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(true);
			expect(result.retryAfter).toBeUndefined();
		});

		it("should apply base rate limits for orgs with 0 credits", async () => {
			const modelDefinition = { free: true };

			vi.mocked(mockCache.getOrganization).mockResolvedValue({
				credits: "0",
			});

			vi.mocked(redis.zcard).mockResolvedValue(0);

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(true);
			expect(redis.zremrangebyscore).toHaveBeenCalled();
			expect(redis.zadd).toHaveBeenCalled();
			expect(redis.expire).toHaveBeenCalled();
		});

		it("should apply elevated rate limits for orgs with credits > 0", async () => {
			const modelDefinition = { free: true };

			vi.mocked(mockCache.getOrganization).mockResolvedValue({
				credits: "10.50",
			});

			vi.mocked(redis.zcard).mockResolvedValue(5); // Under elevated limit (20)

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(true);
		});

		it("should block requests when base rate limit is exceeded", async () => {
			const modelDefinition = { free: true };

			vi.mocked(mockCache.getOrganization).mockResolvedValue({
				credits: "0",
			});

			vi.mocked(redis.zcard).mockResolvedValue(5); // At limit (5)
			const futureTimestamp = Date.now() + 30000; // 30 seconds in future
			vi.mocked(redis.zrange).mockResolvedValue([
				"123",
				futureTimestamp.toString(),
			]);

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
			expect(result.remaining).toBe(0);
			expect(result.limit).toBe(5);
		});

		it("should block requests when elevated rate limit is exceeded", async () => {
			const modelDefinition = { free: true };

			vi.mocked(mockCache.getOrganization).mockResolvedValue({
				credits: "10.50",
			});

			vi.mocked(redis.zcard).mockResolvedValue(20); // At elevated limit (20)
			const futureTimestamp = Date.now() + 30000; // 30 seconds in future
			vi.mocked(redis.zrange).mockResolvedValue([
				"123",
				futureTimestamp.toString(),
			]);

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
			expect(result.remaining).toBe(0);
			expect(result.limit).toBe(20);
		});

		it("should allow requests on Redis errors", async () => {
			const modelDefinition = { free: true };

			vi.mocked(mockCache.getOrganization).mockResolvedValue({
				credits: "0",
			});
			vi.mocked(redis.zremrangebyscore).mockRejectedValue(
				new Error("Redis error"),
			);

			const result = await checkFreeModelRateLimit(
				organizationId,
				model,
				modelDefinition,
			);

			expect(result.allowed).toBe(true);
		});
	});
});
