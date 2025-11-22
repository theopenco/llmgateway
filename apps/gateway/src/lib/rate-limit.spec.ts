import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkFreeModelRateLimit, isFreeModel } from "./rate-limit.js";

// Mock dependencies
vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrange: vi.fn(),
		zadd: vi.fn(),
		expire: vi.fn(),
	},
}));

vi.mock("@llmgateway/db", () => ({
	cdb: {
		query: {
			organization: {
				findFirst: vi.fn(),
			},
		},
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

const mockCache = await import("@llmgateway/cache");
const mockDb = await import("@llmgateway/db");
const redis = mockCache.redisClient;
const { cdb } = mockDb;

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

			vi.mocked(cdb.query.organization.findFirst).mockResolvedValue({
				id: "org-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				name: "Test Org",
				billingEmail: "test@example.com",
				billingCompany: null,
				billingAddress: null,
				billingTaxId: null,
				billingNotes: null,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				credits: "0",
				autoTopUpEnabled: false,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				plan: "free" as const,
				planExpiresAt: null,
				subscriptionCancelled: false,
				trialStartDate: null,
				trialEndDate: null,
				isTrialActive: false,
				retentionLevel: "retain" as const,
				status: "active" as const,
				referralEarnings: "0",
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

			vi.mocked(cdb.query.organization.findFirst).mockResolvedValue({
				id: "org-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				name: "Test Org",
				billingEmail: "test@example.com",
				billingCompany: null,
				billingAddress: null,
				billingTaxId: null,
				billingNotes: null,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				credits: "10.50",
				autoTopUpEnabled: false,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				plan: "free" as const,
				planExpiresAt: null,
				subscriptionCancelled: false,
				trialStartDate: null,
				trialEndDate: null,
				isTrialActive: false,
				retentionLevel: "retain" as const,
				status: "active" as const,
				referralEarnings: "0",
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

			vi.mocked(cdb.query.organization.findFirst).mockResolvedValue({
				id: "org-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				name: "Test Org",
				billingEmail: "test@example.com",
				billingCompany: null,
				billingAddress: null,
				billingTaxId: null,
				billingNotes: null,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				credits: "0",
				autoTopUpEnabled: false,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				plan: "free" as const,
				planExpiresAt: null,
				subscriptionCancelled: false,
				trialStartDate: null,
				trialEndDate: null,
				isTrialActive: false,
				retentionLevel: "retain" as const,
				status: "active" as const,
				referralEarnings: "0",
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

			vi.mocked(cdb.query.organization.findFirst).mockResolvedValue({
				id: "org-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				name: "Test Org",
				billingEmail: "test@example.com",
				billingCompany: null,
				billingAddress: null,
				billingTaxId: null,
				billingNotes: null,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				credits: "10.50",
				autoTopUpEnabled: false,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				plan: "free" as const,
				planExpiresAt: null,
				subscriptionCancelled: false,
				trialStartDate: null,
				trialEndDate: null,
				isTrialActive: false,
				retentionLevel: "retain" as const,
				status: "active" as const,
				referralEarnings: "0",
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

			vi.mocked(cdb.query.organization.findFirst).mockResolvedValue({
				id: "org-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				name: "Test Org",
				billingEmail: "test@example.com",
				billingCompany: null,
				billingAddress: null,
				billingTaxId: null,
				billingNotes: null,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				credits: "0",
				autoTopUpEnabled: false,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				plan: "free" as const,
				planExpiresAt: null,
				subscriptionCancelled: false,
				trialStartDate: null,
				trialEndDate: null,
				isTrialActive: false,
				retentionLevel: "retain" as const,
				status: "active" as const,
				referralEarnings: "0",
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
